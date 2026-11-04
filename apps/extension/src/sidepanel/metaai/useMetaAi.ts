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

export type HelperState =
  | { readonly phase: 'idle' }
  | {
      readonly phase: 'running';
      readonly scene: DraftScene;
      readonly step: StepId;
      readonly waitingForSignIn: boolean;
      readonly diagnostics: string;
    }
  | { readonly phase: 'done'; readonly scene: DraftScene; readonly diagnostics: string }
  | {
      readonly phase: 'failed';
      readonly scene: DraftScene;
      readonly code: MetaAiErrorCode | 'UNKNOWN';
      readonly message: string;
      readonly diagnostics: string;
    };

/**
 * Runs the Meta AI helper for one scene at a time and saves the result on the server (D-071).
 * The run lives in the panel page; if the panel closes mid-run nothing was lost that was
 * already saved, and a finished scene is on the server before the run reports success.
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

  const start = useCallback(
    async (scene: DraftScene, prompt: string) => {
      if (controllerRef.current !== null) return;
      const controller = new AbortController();
      controllerRef.current = controller;
      const lines: DiagnosticLine[] = [];
      const log = (line: DiagnosticLine) => lines.push(line);
      const report = (code: MetaAiErrorCode | 'OK' | 'UNKNOWN') =>
        formatDiagnostics(lines, { code, scene }, new Date());
      const step = (next: StepId) =>
        setState({
          phase: 'running',
          scene,
          step: next,
          waitingForSignIn: false,
          diagnostics: report('OK'),
        });
      const signIn = (waiting: boolean) =>
        setState((previous) =>
          previous.phase === 'running' ? { ...previous, waitingForSignIn: waiting } : previous,
        );
      step('opening');
      try {
        const helper = deps ?? defaultHelperDeps();
        // The prompt comes from the click: Chrome shows its own permission prompt here, once.
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
          log,
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
        setState({ phase: 'done', scene, diagnostics: report('OK') });
      } catch (error) {
        const known = error instanceof MetaAiError ? error : null;
        setState({
          phase: 'failed',
          scene,
          code: known?.code ?? 'UNKNOWN',
          message:
            known?.message ?? 'Something went wrong. Use Copy diagnostics and send it for a fix.',
          diagnostics: report(known?.code ?? 'UNKNOWN'),
        });
      } finally {
        controllerRef.current = null;
        void queryClient.invalidateQueries({ queryKey: sceneKeys.assets(workspaceId, draft.id) });
      }
    },
    [api, deps, draft.id, draft.productId, queryClient, workspaceId],
  );

  const cancel = useCallback(() => controllerRef.current?.abort(), []);
  const dismiss = useCallback(() => {
    if (controllerRef.current === null) setState({ phase: 'idle' });
  }, []);

  return { state, start, cancel, dismiss };
}
