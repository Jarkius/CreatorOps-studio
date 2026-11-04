import { ApiError, type ApiClient, type Draft } from '@creatorops/contracts';
import { Button, EmptyState, ErrorState, LoadingState } from '@creatorops/ui';
import { useState } from 'react';

import { useCampaignDraft, useDraftAssets } from './sceneHooks.js';
import { attachedByScene, scenesFromSections, type SceneItem } from './scenes.js';

export interface ScenesPanelProps {
  readonly api: ApiClient;
  readonly workspaceId: string;
  readonly campaignId: string;
}

/** The scenes of a campaign's finished draft: name, editable prompt, copy, and file status. */
export function ScenesPanel({ api, workspaceId, campaignId }: ScenesPanelProps) {
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
  return <SceneList api={api} workspaceId={workspaceId} draft={draft.data} />;
}

function SceneList({
  api,
  workspaceId,
  draft,
}: {
  api: ApiClient;
  workspaceId: string;
  draft: Draft;
}) {
  const assets = useDraftAssets(api, workspaceId, draft.id);
  const attached = attachedByScene(assets.data?.items ?? []);
  const scenes = scenesFromSections(draft.sections);
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
      <ol className="space-y-3">
        {scenes.map((scene, index) => (
          <SceneRow
            key={`${draft.id}:${scene.scene}:${draft.version}`}
            index={index + 1}
            scene={scene}
            fileName={attached.get(scene.scene)?.asset.originalFilename ?? null}
            fileKnown={assets.isSuccess}
          />
        ))}
      </ol>
    </div>
  );
}

function SceneRow({
  index,
  scene,
  fileName,
  fileKnown,
}: {
  index: number;
  scene: SceneItem;
  fileName: string | null;
  fileKnown: boolean;
}) {
  const [prompt, setPrompt] = useState(scene.prompt);
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
      </div>
      <textarea
        id={id}
        value={prompt}
        rows={4}
        onChange={(event) => {
          setPrompt(event.target.value);
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
        <Button
          variant="secondary"
          aria-label={`Reset prompt for ${scene.label}`}
          disabled={prompt === scene.prompt}
          onClick={() => {
            setPrompt(scene.prompt);
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
