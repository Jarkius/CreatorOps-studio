import type { ApiClient, Draft, DraftScene } from '@creatorops/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useRef, useState } from 'react';

import { sceneKeys } from '../sceneHooks.js';
import { uploadAndAttach } from './attach.js';
import { createChromeBrowser } from './browser.js';
import { formatDiagnostics } from './diagnostics.js';
import * as pageFunctions from './page.js';
import {
  MetaAiError,
  runMetaAiScene,
  type DiagnosticLine,
  type MetaAiBrowser,
  type MetaAiErrorCode,
  type PageFunctions,
  type StepId,
} from './runner.js';

/** The browser and page functions the helper uses. Tests pass fakes; the panel uses the real ones. */
export interface HelperDeps {
  readonly browser: MetaAiBrowser;
  readonly page: PageFunctions;
  /** Tests only: a faster wait and a fake network. */
  readonly sleep?: (ms: number) => Promise<void>;
  readonly fetchImpl?: typeof fetch;
}

export function defaultHelperDeps(): HelperDeps {
  return { browser: createChromeBrowser(), page: pageFunctions };
}

/** Where a scene is in a run of several (Full Auto); null for a single scene. */
export interface RunPosition {
  readonly index: number;
  readonly total: number;
}

export type HelperState =
  | { readonly phase: 'idle' }
  | {
      readonly phase: 'running';
      readonly scene: DraftScene;
      readonly step: StepId;
      readonly waitingForSignIn: boolean;
      readonly position: RunPosition | null;
      readonly diagnostics: string;
    }
  | {
      readonly phase: 'done';
      readonly scene: DraftScene;
      /** How many scene images this run saved. */
      readonly saved: number;
      readonly diagnostics: string;
    }
  | {
      readonly phase: 'failed';
      readonly scene: DraftScene;
      readonly code: MetaAiErrorCode | 'UNKNOWN';
      readonly message: string;
      /** Scenes of this run that were saved before it stopped. */
      readonly saved: number;
      readonly diagnostics: string;
    };

export interface SceneJob {
  readonly scene: DraftScene;
  readonly prompt: string;
}

/**
 * Runs the Meta AI helper and saves each result on the server (D-071, D-073). `start` makes one
 * scene; `startAll` makes several in order, one at a time, and stops at the first failure or
 * Cancel. The run lives in the panel page; every finished scene is on the server before the next
 * begins, so closing the panel loses at most the scene in progress.
 */
export function useMetaAiHelper(
  api: ApiClient,
  workspaceId: string,
  draft: Pick<Draft, 'id' | 'productId'>,
  deps?: HelperDeps,
) {
  const queryClient = useQueryClient();
  const [state, setState] = useState<HelperState>({ phase: 'idle' });
  const controllerRef = useRef<AbortController | null>(null);

  const runScenes = useCallback(
    async (jobs: readonly SceneJob[]) => {
      if (controllerRef.current !== null || jobs.length === 0) return;
      const controller = new AbortController();
      controllerRef.current = controller;
      const helper = deps ?? defaultHelperDeps();
      let saved = 0;
      let lastScene: DraftScene = jobs[0]?.scene ?? 'product_hero';
      let lines: DiagnosticLine[] = [];
      try {
        for (const [offset, job] of jobs.entries()) {
          const { scene, prompt } = job;
          lastScene = scene;
          lines = [];
          const position = jobs.length > 1 ? { index: offset + 1, total: jobs.length } : null;
          const label =
            position === null ? scene : `${scene} (${position.index} of ${position.total})`;
          const report = (code: MetaAiErrorCode | 'OK' | 'UNKNOWN') =>
            formatDiagnostics(lines, { code, scene: label }, new Date());
          const step = (next: StepId) =>
            setState({
              phase: 'running',
              scene,
              step: next,
              waitingForSignIn: false,
              position,
              diagnostics: report('OK'),
            });
          const signIn = (waiting: boolean) =>
            setState((previous) =>
              previous.phase === 'running' ? { ...previous, waitingForSignIn: waiting } : previous,
            );
          step('opening');
          try {
            // A click or the Create button asked for this: Chrome shows its prompt only here, once.
            if (!(await helper.browser.hasPermission())) {
              if (!(await helper.browser.requestPermission())) {
                throw new MetaAiError(
                  'PERMISSION_DENIED',
                  'Meta AI was not allowed. The helper only works on meta.ai and only after you allow it.',
                );
              }
            }
            const result = await runMetaAiScene({
              browser: helper.browser,
              page: helper.page,
              prompt,
              signal: controller.signal,
              onStep: step,
              onWaitingForSignIn: signIn,
              log: (line) => lines.push(line),
              ...(helper.sleep === undefined ? {} : { sleep: helper.sleep }),
            });
            step('uploading');
            await uploadAndAttach({
              api,
              workspaceId,
              draftId: draft.id,
              productId: draft.productId,
              scene,
              bytes: result.bytes,
              mimeType: result.mimeType,
              signal: controller.signal,
              ...(helper.fetchImpl === undefined ? {} : { fetchImpl: helper.fetchImpl }),
            });
            saved += 1;
            void queryClient.invalidateQueries({
              queryKey: sceneKeys.assets(workspaceId, draft.id),
            });
          } catch (error) {
            const known = error instanceof MetaAiError ? error : null;
            setState({
              phase: 'failed',
              scene,
              code: known?.code ?? 'UNKNOWN',
              message:
                known?.message ??
                'Something went wrong. Use Copy diagnostics and send it for a fix.',
              saved,
              diagnostics: report(known?.code ?? 'UNKNOWN'),
            });
            return;
          }
        }
        setState({
          phase: 'done',
          scene: lastScene,
          saved,
          diagnostics: formatDiagnostics(lines, { code: 'OK', scene: lastScene }, new Date()),
        });
      } finally {
        controllerRef.current = null;
        void queryClient.invalidateQueries({ queryKey: sceneKeys.assets(workspaceId, draft.id) });
      }
    },
    [api, deps, draft.id, draft.productId, queryClient, workspaceId],
  );

  const start = useCallback(
    (scene: DraftScene, prompt: string) => runScenes([{ scene, prompt }]),
    [runScenes],
  );
  const startAll = useCallback((jobs: readonly SceneJob[]) => runScenes(jobs), [runScenes]);

  const cancel = useCallback(() => controllerRef.current?.abort(), []);
  const dismiss = useCallback(() => {
    if (controllerRef.current === null) setState({ phase: 'idle' });
  }, []);

  return { state, start, startAll, cancel, dismiss };
}
