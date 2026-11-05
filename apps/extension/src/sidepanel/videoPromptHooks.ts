import {
  ApiError,
  isTerminalJobStatus,
  pollDelayMs,
  VideoPromptsOutputSchema,
  type ApiClient,
  type DraftScene,
  type Job,
} from '@creatorops/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';

import { newExtensionIdempotencyKey } from './campaigns.js';

export const videoPromptKeys = {
  latest: (workspaceId: string, draftId: string) =>
    ['panel', 'videoPrompts', 'latest', workspaceId, draftId] as const,
  job: (workspaceId: string, jobId: string) =>
    ['panel', 'videoPrompts', 'job', workspaceId, jobId] as const,
};

export interface SavedVideoPrompts {
  readonly jobId: string;
  readonly draftVersion: number;
  readonly model: string;
  readonly scenes: ReadonlyMap<DraftScene, { prompt: string; voiceover: string }>;
}

/**
 * The newest finished video-prompt job of a draft, read back from the server, so the prompts are
 * still there after the panel is closed and opened again. The panel stores nothing itself.
 */
export function useSavedVideoPrompts(api: ApiClient, workspaceId: string, draftId: string) {
  return useQuery({
    queryKey: videoPromptKeys.latest(workspaceId, draftId),
    queryFn: async (): Promise<SavedVideoPrompts | null> => {
      const page = await api.jobs.list(workspaceId, {
        type: 'generate_video_prompts',
        draftId,
        status: 'succeeded',
        limit: 1,
      });
      const job = page.items[0];
      if (job === undefined) return null;
      const parsed = VideoPromptsOutputSchema.safeParse(job.output);
      if (!parsed.success) return null;
      return {
        jobId: job.id,
        draftVersion: parsed.data.draftVersion,
        model: parsed.data.model,
        scenes: new Map(
          parsed.data.scenes.map((scene) => [
            scene.scene,
            { prompt: scene.prompt, voiceover: scene.voiceover },
          ]),
        ),
      };
    },
  });
}

/**
 * Starts a video-prompt job and follows it with the D-053 poll steps until it ends. The
 * idempotency key is made once per click and reused only when the last request got no answer
 * (network error or timeout), the same rule as for generation.
 */
export function useVideoPromptsRun(
  api: ApiClient,
  workspaceId: string,
  draft: { readonly id: string; readonly version: number },
) {
  const queryClient = useQueryClient();
  const [jobId, setJobId] = useState<string | null>(null);
  const pendingKey = useRef<string | null>(null);

  const start = useMutation({
    mutationFn: async () => {
      const key = pendingKey.current ?? newExtensionIdempotencyKey();
      pendingKey.current = key;
      try {
        const job = await api.jobs.generateVideoPrompts(
          workspaceId,
          { draftId: draft.id, draftVersion: draft.version },
          key,
        );
        pendingKey.current = null;
        return job;
      } catch (error) {
        const noResponse =
          error instanceof ApiError && (error.code === 'NETWORK_ERROR' || error.code === 'TIMEOUT');
        if (!noResponse) pendingKey.current = null;
        throw error;
      }
    },
    onSuccess: (job) => setJobId(job.id),
  });

  const job = useQuery({
    queryKey: videoPromptKeys.job(workspaceId, jobId ?? ''),
    enabled: jobId !== null,
    queryFn: async (): Promise<Job> => {
      const current = await api.jobs.get(workspaceId, jobId ?? '');
      if (current.status === 'succeeded') {
        await queryClient.invalidateQueries({
          queryKey: videoPromptKeys.latest(workspaceId, draft.id),
        });
      }
      return current;
    },
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      if (status !== undefined && isTerminalJobStatus(status)) return false;
      return pollDelayMs(query.state.dataUpdateCount - 1);
    },
  });

  const cancel = useMutation({
    mutationFn: () => api.jobs.cancel(workspaceId, jobId ?? ''),
    onSuccess: () => void job.refetch(),
  });

  const status = job.data?.status;
  const running =
    start.isPending || (jobId !== null && (status === undefined || !isTerminalJobStatus(status)));
  return {
    start: () => {
      setJobId(null);
      start.mutate();
    },
    cancel: () => cancel.mutate(),
    cancelling: cancel.isPending,
    running,
    startError: start.isError ? start.error : null,
    job: job.data ?? null,
    jobError: job.isError ? job.error : null,
  };
}
