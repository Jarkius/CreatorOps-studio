import { ApiError, type ApiClient, type Draft, type DraftScene } from '@creatorops/contracts';
import { Button, EmptyState, ErrorState, LoadingState } from '@creatorops/ui';
import { useEffect, useRef, useState } from 'react';

import { useCampaignDraft, useDraftAssets } from './sceneHooks.js';
import { ExportPanel, type OpenUrl } from './ExportPanel.js';
import { HelperRunPanel } from './metaai/HelperRunPanel.js';
import { useFlowHelper, useMetaAiHelper, type HelperDeps } from './metaai/useMetaAi.js';
import { attachedByScene, scenesFromSections, type SceneItem } from './scenes.js';
import { useSavedVideoPrompts, useVideoPromptsRun } from './videoPromptHooks.js';
import { VideoPromptsSection } from './VideoPromptsSection.js';
import { withSpokenLine } from './flowSpeech.js';

export interface ScenesPanelProps {
  readonly api: ApiClient;
  readonly workspaceId: string;
  readonly campaignId: string;
  /** Owner, admin and editor only; the API still enforces it. */
  readonly canStart: boolean;
  /** Replaced in tests; the panel uses the real browser. */
  readonly helper?: HelperDeps;
  /** Full Auto: start the scenes that have no file as soon as the draft is loaded, once. */
  readonly autoRun?: boolean;
  /** Replaced in tests; the panel opens the signed download link in a new tab. */
  readonly openUrl?: OpenUrl;
}

/** The scenes of a campaign's finished draft: name, editable prompt, copy, and file status. */
export function ScenesPanel({
  api,
  workspaceId,
  campaignId,
  canStart,
  helper,
  autoRun = false,
  openUrl,
}: ScenesPanelProps) {
  const draft = useCampaignDraft(api, workspaceId, campaignId);
  const error = draft.error instanceof ApiError ? draft.error : null;

  if (draft.isPending) return <LoadingState label="Loading scenes…" />;
  if (draft.isError) {
    return (
      <ErrorState
        message={error?.message ?? 'Something went wrong. Please try again.'}
        {...(error?.requestId ? { requestId: error.requestId } : {})}
        onRetry={() => void draft.refetch()}
        retrying={draft.isFetching}
      />
    );
  }
  if (draft.data === null) {
    return (
      <EmptyState
        title="No draft yet"
        description="Scenes appear here once generation has finished."
      />
    );
  }
  return (
    <SceneList
      api={api}
      workspaceId={workspaceId}
      draft={draft.data}
      canStart={canStart}
      autoRun={autoRun}
      {...(helper === undefined ? {} : { helper })}
      {...(openUrl === undefined ? {} : { openUrl })}
    />
  );
}

function SceneList({
  api,
  workspaceId,
  draft,
  canStart,
  helper,
  autoRun,
  openUrl,
}: {
  api: ApiClient;
  workspaceId: string;
  draft: Draft;
  canStart: boolean;
  helper?: HelperDeps;
  autoRun: boolean;
  openUrl?: OpenUrl;
}) {
  const run = useMetaAiHelper(api, workspaceId, draft, helper);
  const flow = useFlowHelper(api, workspaceId, draft, helper);
  // One helper at a time: both write to the same draft and use the owner's browser.
  const running = run.state.phase === 'running' || flow.state.phase === 'running';
  const assets = useDraftAssets(api, workspaceId, draft.id);
  const attached = attachedByScene(assets.data?.items ?? []);
  const attachedVideos = attachedByScene(assets.data?.items ?? [], 'video');
  const scenes = scenesFromSections(draft.sections);
  // The owner's edits live here (not saved to the draft) so "Generate all" uses them too.
  const [edits, setEdits] = useState<Partial<Record<DraftScene, string>>>({});
  const promptOf = (item: SceneItem) => edits[item.scene] ?? item.prompt;
  const videoRun = useVideoPromptsRun(api, workspaceId, draft);
  const savedVideo = useSavedVideoPrompts(api, workspaceId, draft.id);
  const [videoEdits, setVideoEdits] = useState<Partial<Record<DraftScene, string>>>({});
  // A newly written set replaces the edits made to the old one.
  const savedJobId = savedVideo.data?.jobId ?? null;
  const [editsFor, setEditsFor] = useState<string | null>(savedJobId);
  if (editsFor !== savedJobId) {
    setEditsFor(savedJobId);
    setVideoEdits({});
  }
  const generatedVideoPrompt = (scene: DraftScene): string | null =>
    savedVideo.data?.scenes.get(scene)?.prompt ?? null;
  const videoPromptOf = (scene: DraftScene): string | null =>
    videoEdits[scene] ?? generatedVideoPrompt(scene);
  // Flow gets the video prompt of a scene when there is one, else the scene text; with "speak the
  // voiceover" on, the scene's Thai line is added as speech so the clip carries the voice.
  const [speakVoiceover, setSpeakVoiceover] = useState(true);
  const flowPromptOf = (item: SceneItem): string => {
    const prompt = videoPromptOf(item.scene) ?? promptOf(item);
    return speakVoiceover
      ? withSpokenLine(prompt, savedVideo.data?.scenes.get(item.scene)?.voiceover)
      : prompt;
  };
  const missing = scenes.filter(
    (item) => !attached.has(item.scene) && promptOf(item).trim() !== '',
  );
  const missingJobs = () => missing.map((item) => ({ scene: item.scene, prompt: promptOf(item) }));
  const missingVideos = scenes.filter(
    (item) => !attachedVideos.has(item.scene) && promptOf(item).trim() !== '',
  );
  // Full Auto starts once, after the file list is known, so scenes that already have a file are
  // skipped; a failure or Cancel stops it and nothing restarts it until the owner presses again.
  const autoStarted = useRef(false);
  useEffect(() => {
    if (!autoRun || !canStart || autoStarted.current || !assets.isSuccess) return;
    autoStarted.current = true;
    void run.startAll(missingJobs());
  });
  return (
    <div className="space-y-3">
      <p className="text-sm text-[var(--co-text-muted)]">
        Edit a prompt before you use it. Edits stay in this panel and are not saved to the draft.
      </p>
      {assets.isError ? (
        <p role="alert" className="text-sm text-[var(--co-danger)]">
          Could not check which scenes have a file.{' '}
          <button type="button" className="underline" onClick={() => void assets.refetch()}>
            Try again
          </button>
        </p>
      ) : null}
      {canStart ? (
        <p className="text-sm text-[var(--co-text-muted)]">
          Generate in Meta AI uses your own signed-in meta.ai tab. Chrome asks once to allow
          meta.ai; the helper never signs in for you and stops if Meta asks for a check.
        </p>
      ) : null}
      {canStart && missing.length > 0 ? (
        <Button disabled={running} onClick={() => void run.startAll(missingJobs())}>
          {missing.length === scenes.length
            ? 'Generate all scenes in Meta AI'
            : `Generate the ${missing.length} missing scene${missing.length === 1 ? '' : 's'} in Meta AI`}
        </Button>
      ) : null}
      <HelperRunPanel state={run.state} onCancel={run.cancel} onDismiss={run.dismiss} />
      {canStart ? (
        <div className="space-y-2">
          <p className="text-sm text-[var(--co-text-muted)]">
            Make video in Flow uses your own signed-in Google Flow tab. Set the model and the 9:16
            shape in that tab first: the helper uses what is selected there and changes none of
            Flow's settings. Chrome asks once to allow Flow.
          </p>
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              className="mt-1"
              checked={speakVoiceover}
              onChange={(event) => setSpeakVoiceover(event.target.checked)}
            />
            <span>
              Flow speaks the Thai voiceover in each clip (uses the lines from Write video prompts;
              choose a Flow model that makes sound)
            </span>
          </label>
          {missingVideos.length > 0 ? (
            <Button
              variant="secondary"
              disabled={running}
              onClick={() =>
                void flow.startAll(
                  missingVideos.map((item) => ({ scene: item.scene, prompt: flowPromptOf(item) })),
                )
              }
            >
              {missingVideos.length === scenes.length
                ? 'Make all videos in Flow'
                : `Make the ${missingVideos.length} missing video${missingVideos.length === 1 ? '' : 's'} in Flow`}
            </Button>
          ) : null}
        </div>
      ) : null}
      <HelperRunPanel state={flow.state} onCancel={flow.cancel} onDismiss={flow.dismiss} />
      <VideoPromptsSection
        canStart={canStart}
        run={videoRun}
        saved={savedVideo.data ?? null}
        savedLoading={savedVideo.isPending}
        promptOf={(scene) => videoPromptOf(scene) ?? ''}
        onEdit={(scene, text) => setVideoEdits((previous) => ({ ...previous, [scene]: text }))}
        onReset={(scene) =>
          setVideoEdits((previous) => {
            const next = { ...previous };
            delete next[scene];
            return next;
          })
        }
        isEdited={(scene) => videoEdits[scene] !== undefined}
      />
      <ol className="space-y-3">
        {scenes.map((scene, index) => (
          <SceneRow
            key={`${draft.id}:${scene.scene}:${draft.version}`}
            index={index + 1}
            scene={scene}
            prompt={promptOf(scene)}
            onPromptChange={(text) =>
              setEdits((previous) => ({ ...previous, [scene.scene]: text }))
            }
            fileName={attached.get(scene.scene)?.asset.originalFilename ?? null}
            videoName={attachedVideos.get(scene.scene)?.asset.originalFilename ?? null}
            fileKnown={assets.isSuccess}
            {...(canStart
              ? {
                  onGenerate: (text: string) => void run.start(scene.scene, text),
                  onGenerateVideo: () => void flow.start(scene.scene, flowPromptOf(scene)),
                  generateDisabled: running,
                }
              : {})}
          />
        ))}
      </ol>
      <ExportPanel
        api={api}
        workspaceId={workspaceId}
        draft={draft}
        canStart={canStart}
        {...(openUrl === undefined ? {} : { openUrl })}
      />
    </div>
  );
}

function SceneRow({
  index,
  scene,
  prompt,
  onPromptChange,
  fileName,
  videoName,
  fileKnown,
  onGenerate,
  onGenerateVideo,
  generateDisabled = false,
}: {
  index: number;
  scene: SceneItem;
  prompt: string;
  onPromptChange: (prompt: string) => void;
  fileName: string | null;
  videoName: string | null;
  fileKnown: boolean;
  onGenerate?: (prompt: string) => void;
  onGenerateVideo?: (prompt: string) => void;
  generateDisabled?: boolean;
}) {
  const [copy, setCopy] = useState<'idle' | 'copied' | 'failed'>('idle');
  const id = `scene-${scene.scene}`;
  return (
    <li className="min-w-0 rounded-md border border-[var(--co-border)] p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label htmlFor={id} className="text-sm font-medium">
          {`${index}. ${scene.label}`}
        </label>
        {fileKnown ? (
          <span className="text-sm text-[var(--co-text-muted)] [overflow-wrap:anywhere]">
            {fileName === null ? 'No file yet' : `File: ${fileName}`}
          </span>
        ) : null}
        {fileKnown && videoName !== null ? (
          <span className="w-full text-sm text-[var(--co-text-muted)] [overflow-wrap:anywhere]">
            {`Video: ${videoName}`}
          </span>
        ) : null}
      </div>
      <textarea
        id={id}
        value={prompt}
        rows={4}
        onChange={(event) => {
          onPromptChange(event.target.value);
          setCopy('idle');
        }}
        className="mt-2 w-full min-w-0 rounded-md border border-[var(--co-border)] bg-[var(--co-bg)] p-2 text-sm"
      />
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Button
          variant="secondary"
          aria-label={`Copy prompt for ${scene.label}`}
          disabled={prompt.trim() === ''}
          onClick={() => {
            navigator.clipboard.writeText(prompt).then(
              () => setCopy('copied'),
              () => setCopy('failed'),
            );
          }}
        >
          Copy prompt
        </Button>
        {onGenerate === undefined ? null : (
          <Button
            aria-label={`Generate ${scene.label} in Meta AI`}
            disabled={generateDisabled || prompt.trim() === ''}
            onClick={() => onGenerate(prompt)}
          >
            Generate in Meta AI
          </Button>
        )}
        {onGenerateVideo === undefined ? null : (
          <Button
            variant="secondary"
            aria-label={`Make video for ${scene.label} in Flow`}
            disabled={generateDisabled || prompt.trim() === ''}
            onClick={() => onGenerateVideo(prompt)}
          >
            Make video in Flow
          </Button>
        )}
        <Button
          variant="secondary"
          aria-label={`Reset prompt for ${scene.label}`}
          disabled={prompt === scene.prompt}
          onClick={() => {
            onPromptChange(scene.prompt);
            setCopy('idle');
          }}
        >
          Reset
        </Button>
        {copy === 'copied' ? (
          <span role="status" className="text-sm">
            Copied
          </span>
        ) : null}
        {copy === 'failed' ? (
          <span role="alert" className="text-sm text-[var(--co-danger)]">
            Could not copy. Select the text and copy it yourself.
          </span>
        ) : null}
      </div>
    </li>
  );
}
