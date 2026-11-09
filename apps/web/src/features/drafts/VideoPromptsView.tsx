import { useQuery } from '@tanstack/react-query';

import { VideoPromptsOutputSchema } from '@creatorops/contracts';
import type { Draft } from '@creatorops/contracts';
import { Button, LoadingState } from '@creatorops/ui';

import { useDashboard } from '../../app/dashboard-context.js';
import { describeError } from '../errors.js';
import { copyText } from './copyText.js';

const SCENE_LABELS: Record<string, string> = {
  product_hero: 'Product hero',
  detail: 'Detail',
  usage: 'Usage',
  final_shot: 'Final shot',
};

/**
 * The newest saved video prompts of a draft (written in the side panel), to read and copy for
 * Google Flow or any video tool. Read only; writing them stays in the panel.
 */
export function VideoPromptsView({ workspaceId, draft }: { workspaceId: string; draft: Draft }) {
  const { client } = useDashboard();
  const query = useQuery({
    queryKey: ['video-prompts', workspaceId, draft.id],
    queryFn: async () => {
      const page = await client.jobs.list(workspaceId, {
        type: 'generate_video_prompts',
        draftId: draft.id,
        status: 'succeeded',
        limit: 1,
      });
      const parsed = VideoPromptsOutputSchema.safeParse(page.items[0]?.output);
      return parsed.success ? parsed.data : null;
    },
  });

  return (
    <section aria-labelledby="video-prompts-heading" className="space-y-3">
      <h2 id="video-prompts-heading" className="text-base font-semibold">
        Video prompts
      </h2>
      {query.isPending ? <LoadingState label="Loading video prompts" /> : null}
      {query.isError ? (
        <p role="alert">Could not load the video prompts: {describeError(query.error).message}</p>
      ) : null}
      {query.data === null ? (
        <p className="text-sm">
          No video prompts yet. Open this campaign in the side panel, press Scenes, then Write video
          prompts.
        </p>
      ) : null}
      {query.data ? (
        <>
          {query.data.draftVersion !== draft.version ? (
            <p className="text-sm">
              Written for an earlier version of this draft. Write them again in the side panel if
              the copy changed.
            </p>
          ) : null}
          <ol aria-label="Video prompt scenes" className="grid gap-3">
            {query.data.scenes.map((scene) => (
              <li
                key={scene.scene}
                className="space-y-2 rounded-md border border-[var(--co-border)] p-3"
              >
                <h3 className="text-sm font-medium">{SCENE_LABELS[scene.scene] ?? scene.scene}</h3>
                <p className="whitespace-pre-wrap text-sm">{scene.prompt}</p>
                <p className="whitespace-pre-wrap text-sm">Voiceover: {scene.voiceover}</p>
                <Button
                  variant="secondary"
                  aria-label={`Copy prompt: ${SCENE_LABELS[scene.scene] ?? scene.scene}`}
                  onClick={() => void copyText(scene.prompt)}
                >
                  Copy prompt
                </Button>
              </li>
            ))}
          </ol>
        </>
      ) : null}
    </section>
  );
}
