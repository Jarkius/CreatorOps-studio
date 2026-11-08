import { randomUUID, createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { buffer as readAll } from 'node:stream/consumers';
import { Readable } from 'node:stream';

import { ASSET_LIMITS, DraftSceneSchema } from '@creatorops/contracts';
import { and, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';

import type { DbOrTx } from '../../db/client.js';
import { assets } from '../../db/schema.js';
import type { Storage } from '../../storage/storage.js';
import { originalKey } from '../assets/service.js';
import { listLinked } from '../draft-assets/repo.js';
import {
  assembleArgs,
  probe,
  runTool,
  VideoToolFailed,
  VideoToolMissing,
  type VideoTools,
} from '../video/ffmpeg.js';
import { buildAss, buildSrt, cuesFor } from '../video/subtitles.js';
import { PermanentJobFailure } from './generate-brief.js';
import { FAILURE_MESSAGES } from './retry.js';
import type { JobRow } from './repo.js';

/** The generator label of the assembled video on the draft; a new run replaces the old one. */
export const ASSEMBLED_GENERATOR = 'CreatorOps';

/**
 * What an assemble_video job carries (D-086): taken when the job is created, because attaching a
 * file does not change the draft version. The worker checks every clip is still the same file and
 * still attached to the draft.
 */
export const AssembleInputSchema = z.object({
  draftId: z.string().min(1),
  draftVersion: z.number().int().min(1),
  clips: z
    .array(
      z.object({
        scene: DraftSceneSchema,
        assetId: z.string().min(1),
        sha256: z.string().regex(/^[0-9a-f]{64}$/),
        sizeBytes: z.number().int().min(1),
        voiceover: z.string().max(400).nullable(),
      }),
    )
    .min(1)
    .max(4),
  skippedScenes: z.array(DraftSceneSchema),
  subtitles: z.boolean(),
});
export type AssembleInput = z.infer<typeof AssembleInputSchema>;

export interface AssembleResult {
  readonly draftId: string;
  readonly assetId: string;
  readonly storageKey: string;
  readonly sha256: string;
  readonly sizeBytes: number;
  readonly durationMs: number;
  readonly clipCount: number;
  readonly subtitles: boolean;
  readonly skippedScenes: readonly string[];
  readonly srt: string;
}

const unavailable = () =>
  new PermanentJobFailure('ASSET_UNAVAILABLE', FAILURE_MESSAGES.ASSET_UNAVAILABLE);
const failed = () => new PermanentJobFailure('VIDEO_FAILED', FAILURE_MESSAGES.VIDEO_FAILED);

export interface AssembleDeps {
  readonly storage: Storage;
  readonly tools: VideoTools;
  readonly log?: { warn(object: Record<string, unknown>, message: string): void };
}

/**
 * Joins the snapshot's clips into one MP4 with burned-in Thai subtitles and writes it to storage
 * under a new asset id. Nothing is recorded in the database here: the caller creates the asset row
 * and attaches it in the transaction that settles the job, and deletes the file if it cannot.
 */
export async function buildAssembledVideo(
  db: DbOrTx,
  deps: AssembleDeps,
  job: JobRow,
  signal: AbortSignal,
): Promise<AssembleResult> {
  const parsed = AssembleInputSchema.safeParse(job.input);
  if (!parsed.success || job.draftId === null || parsed.data.draftId !== job.draftId) {
    throw new PermanentJobFailure('INTERNAL', 'The job settings are not valid.');
  }
  const input = parsed.data;

  // Each clip must still be a ready file of this workspace, with the same bytes, on this draft.
  const ids = input.clips.map((clip) => clip.assetId);
  const rows = await db
    .select()
    .from(assets)
    .where(
      and(
        eq(assets.workspaceId, job.workspaceId),
        eq(assets.status, 'ready'),
        inArray(assets.id, ids),
      ),
    );
  const byId = new Map(rows.map((row) => [row.id, row]));
  const attached = new Set(
    (await listLinked(db, job.workspaceId, input.draftId)).map((item) => item.asset.id),
  );

  const dir = await mkdtemp(path.join(os.tmpdir(), 'creatorops-video-'));
  try {
    const clips: {
      file: string;
      durationMs: number;
      hasAudio: boolean;
      voiceover: string | null;
    }[] = [];
    for (const [index, clip] of input.clips.entries()) {
      signal.throwIfAborted();
      const row = byId.get(clip.assetId);
      if (
        row === undefined ||
        !attached.has(clip.assetId) ||
        row.sha256 !== clip.sha256 ||
        row.mimeType !== 'video/mp4'
      ) {
        throw unavailable();
      }
      let data: Buffer;
      try {
        data = await readAll(await deps.storage.read(row.storageKey));
      } catch {
        throw unavailable();
      }
      if (createHash('sha256').update(data).digest('hex') !== clip.sha256) throw unavailable();
      const file = `clip${index}.mp4`;
      await writeFile(path.join(dir, file), data);
      const info = await probe(deps.tools, file, { cwd: dir, signal });
      if (!info.hasVideo || info.durationMs <= 0) throw failed();
      clips.push({
        file,
        durationMs: info.durationMs,
        hasAudio: info.hasAudio,
        voiceover: input.subtitles ? clip.voiceover : null,
      });
    }

    const cues = cuesFor(clips);
    const withSubtitles = input.subtitles && cues.length > 0;
    if (withSubtitles) {
      await writeFile(path.join(dir, 'subs.ass'), buildAss(cues, deps.tools.subtitleFont));
    }
    await runTool(
      deps.tools.ffmpeg,
      assembleArgs(clips, { subtitleFile: withSubtitles ? 'subs.ass' : null, output: 'final.mp4' }),
      { cwd: dir, signal },
    );
    const out = await probe(deps.tools, 'final.mp4', { cwd: dir, signal });
    const bytes = await readFile(path.join(dir, 'final.mp4'));
    if (bytes.length === 0 || bytes.length > ASSET_LIMITS.videoBytes) throw failed();

    signal.throwIfAborted();
    const assetId = randomUUID();
    const storageKey = originalKey(job.workspaceId, assetId, 'video/mp4');
    await deps.storage.put(storageKey, Readable.from([bytes]));
    return {
      draftId: input.draftId,
      assetId,
      storageKey,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      sizeBytes: bytes.length,
      durationMs: out.durationMs,
      clipCount: clips.length,
      subtitles: withSubtitles,
      skippedScenes: input.skippedScenes,
      srt: withSubtitles ? buildSrt(cues) : '',
    };
  } catch (error) {
    if (error instanceof VideoToolMissing) {
      throw new PermanentJobFailure('VIDEO_TOOL_MISSING', FAILURE_MESSAGES.VIDEO_TOOL_MISSING);
    }
    if (error instanceof VideoToolFailed) {
      // The end of ffmpeg's own output goes to the log only, never to the job row.
      deps.log?.warn(
        {
          event: 'video.tool_failed',
          jobId: job.id,
          tool: path.basename(error.tool),
          detail: error.detail.slice(-800),
        },
        'video tool failed',
      );
      throw failed();
    }
    throw error;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
