import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { buffer as readAll } from 'node:stream/consumers';

import { EXPORT_LIMITS } from '@creatorops/contracts';
import { and, eq, inArray } from 'drizzle-orm';

import type { DbOrTx } from '../../db/client.js';
import { assets } from '../../db/schema.js';
import type { Storage } from '../../storage/storage.js';
import { ExportInputSchema } from '../export/input.js';
import { buildPackage, type PackageMedia } from '../export/package.js';
import { ZipError, zipChunks } from '../export/zip.js';
import { PermanentJobFailure } from './generate-brief.js';
import { FAILURE_MESSAGES } from './retry.js';
import type { JobRow } from './repo.js';

export interface ExportResult {
  readonly draftId: string;
  readonly draftVersion: number;
  readonly createdBy: string;
  readonly storageKey: string;
  readonly filename: string;
  readonly fileCount: number;
  readonly sizeBytes: number;
  readonly sha256: string;
  readonly manifest: Record<string, unknown>;
}

/** Where a job's package lives. One key per job: a retry replaces its own earlier attempt. */
export function exportStorageKey(workspaceId: string, jobId: string): string {
  return `exports/${workspaceId.toLowerCase()}/${jobId.toLowerCase()}.zip`;
}

/** ASCII, no path: `creatorops-20261104-1a2b3c4d.zip`. */
export function exportFilename(draftId: string, at: Date): string {
  const day = at.toISOString().slice(0, 10).replaceAll('-', '');
  return `creatorops-${day}-${draftId.replaceAll('-', '').slice(0, 8).toLowerCase()}.zip`;
}

const unavailable = () =>
  new PermanentJobFailure('ASSET_UNAVAILABLE', FAILURE_MESSAGES.ASSET_UNAVAILABLE);
const tooLarge = () =>
  new PermanentJobFailure('EXPORT_TOO_LARGE', FAILURE_MESSAGES.EXPORT_TOO_LARGE);

/**
 * Builds the package of an export job from its snapshot and writes it to storage (D-067). Nothing
 * is recorded in the database here: the caller inserts the `draft_exports` row in the transaction
 * that settles the job, so a row always has a finished job. A file that is gone, deleted or
 * different from the snapshot fails the job for good, because a retry could not change that.
 */
export async function buildExport(
  db: DbOrTx,
  storage: Storage,
  job: JobRow,
  signal: AbortSignal,
): Promise<ExportResult> {
  const parsed = ExportInputSchema.safeParse(job.input);
  if (!parsed.success || job.draftId === null || parsed.data.draftId !== job.draftId) {
    throw new PermanentJobFailure('INTERNAL', 'The job settings are not valid.');
  }
  const input = parsed.data;

  const total = input.media.reduce((sum, item) => sum + item.sizeBytes, 0);
  if (input.media.length > EXPORT_LIMITS.maxMediaFiles || total > EXPORT_LIMITS.maxPackageBytes) {
    throw tooLarge();
  }

  // Every file must still be a ready file of this workspace with the bytes the snapshot recorded.
  const rows =
    input.media.length === 0
      ? []
      : await db
          .select()
          .from(assets)
          .where(
            and(
              eq(assets.workspaceId, job.workspaceId),
              eq(assets.status, 'ready'),
              inArray(
                assets.id,
                input.media.map((item) => item.assetId),
              ),
            ),
          );
  const byId = new Map(rows.map((row) => [row.id, row]));

  const media: PackageMedia[] = [];
  for (const meta of input.media) {
    signal.throwIfAborted();
    const row = byId.get(meta.assetId);
    if (row === undefined || row.sha256 !== meta.sha256 || row.sizeBytes !== meta.sizeBytes) {
      throw unavailable();
    }
    let data: Buffer;
    try {
      data = await readAll(await storage.read(row.storageKey));
    } catch {
      throw unavailable();
    }
    // The stored bytes must be the ones that were checked at upload time.
    if (createHash('sha256').update(data).digest('hex') !== meta.sha256) {
      throw unavailable();
    }
    media.push({ meta, data });
  }

  signal.throwIfAborted();
  const createdAt = job.createdAt;
  const built = buildPackage(input, media, createdAt);

  // Hash and count while the chunks stream out, so the archive is never joined into one buffer.
  const hash = createHash('sha256');
  let size = 0;
  const chunks = (function* () {
    for (const chunk of zipChunks(built.entries, createdAt)) {
      hash.update(chunk);
      size += chunk.length;
      yield chunk;
    }
  })();

  const key = exportStorageKey(job.workspaceId, job.id);
  // A retry of this same job replaces its own earlier file; the key belongs to this job alone.
  await storage.delete(key);
  try {
    await storage.put(key, Readable.from(chunks));
  } catch (error) {
    await storage.delete(key);
    if (error instanceof ZipError) throw tooLarge();
    throw error;
  }

  return {
    draftId: input.draftId,
    draftVersion: input.draftVersion,
    createdBy: job.createdBy,
    storageKey: key,
    filename: exportFilename(input.draftId, createdAt),
    fileCount: built.entries.length,
    sizeBytes: size,
    sha256: hash.digest('hex'),
    manifest: built.manifest,
  };
}
