import type {
  Export,
  ExportDownload,
  ExportListQueryParsed,
  ExportListResponse,
  ExportStatus,
} from '@creatorops/contracts';

import type { Db } from '../../db/client.js';
import { decodeCursor, encodeCursor } from '../../platform/cursor.js';
import { AppError } from '../../platform/errors.js';
import { parseExpiry } from '../../platform/signing.js';
import type { Storage } from '../../storage/storage.js';
import { recordAuditEvent } from '../audit/repo.js';
import type { RequestContext } from '../identity/context.js';
import { exportStorageKey } from '../jobs/export-package.js';
import type { ExportSigner } from './export-urls.js';
import {
  findExport,
  findExportForSignedRead,
  isMember,
  listExports as listExportRows,
  listFinishedJobsWithoutPackage,
  markExpired,
  type ExportRow,
} from './repo.js';

export interface ExportDeps {
  readonly db: Db;
  readonly storage: Storage;
  readonly exports: ExportSigner;
  /** Injectable clock for tests. */
  readonly now?: () => Date;
}

const clock = (deps: ExportDeps): Date => (deps.now ? deps.now() : new Date());
const seconds = (date: Date): number => Math.floor(date.getTime() / 1000);
const notFound = () => new AppError('NOT_FOUND', 'Export not found.');

function toExport(row: ExportRow, now: Date): Export {
  // A row past its expiry reads as expired even before the sweeper has marked it.
  const expired = row.status === 'expired' || row.expiresAt.getTime() <= now.getTime();
  const status: ExportStatus = expired ? 'expired' : 'ready';
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    draftId: row.draftId,
    jobId: row.jobId,
    status,
    draftVersion: row.draftVersion,
    fileCount: row.fileCount,
    sizeBytes: row.sizeBytes,
    sha256: row.sha256,
    filename: row.filename,
    createdAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
  };
}

/** Any member of the workspace may list packages. */
export async function listExports(
  deps: ExportDeps,
  ctx: RequestContext,
  query: ExportListQueryParsed,
): Promise<ExportListResponse> {
  const rows = await listExportRows(deps.db, ctx, {
    draftId: query.draftId,
    limit: query.limit + 1,
    after: query.cursor === undefined ? undefined : decodeCursor(query.cursor),
  });
  const page = rows.slice(0, query.limit);
  const last = page[page.length - 1];
  const now = clock(deps);
  return {
    items: page.map((row) => toExport(row, now)),
    nextCursor: rows.length > query.limit && last !== undefined ? encodeCursor(last) : null,
  };
}

export async function getExport(
  deps: ExportDeps,
  ctx: RequestContext,
  exportId: string,
): Promise<Export> {
  const row = await findExport(deps.db, ctx, exportId);
  if (row === null) throw notFound();
  return toExport(row, clock(deps));
}

/** A short-lived signed link. Any member may download; an expired package gets 410-like 404. */
export async function createDownloadUrl(
  deps: ExportDeps,
  ctx: RequestContext,
  exportId: string,
): Promise<ExportDownload> {
  const row = await findExport(deps.db, ctx, exportId);
  if (row === null) throw notFound();
  const now = clock(deps);
  if (toExport(row, now).status !== 'ready') {
    throw new AppError('NOT_FOUND', 'This package has expired. Export the draft again.');
  }
  const link = deps.exports.url(
    { exportId: row.id, workspaceId: row.workspaceId, userId: ctx.userId },
    seconds(now),
  );
  // The audit record names the export, never the signed URL.
  await recordAuditEvent(deps.db, ctx, {
    action: 'export.download_link',
    resourceType: 'export',
    resourceId: row.id,
  });
  return {
    url: link.url,
    expiresAt: new Date(link.exp * 1000).toISOString(),
    filename: row.filename,
  };
}

export interface DownloadRequest {
  readonly exportId: string;
  readonly userId: string;
  readonly exp: string;
  readonly sig: string;
}

export interface DownloadResponse {
  readonly headers: Record<string, string>;
  readonly stream: NodeJS.ReadableStream;
}

/**
 * The signed GET. A bad signature, an expired link, an expired or missing package, a member who
 * has left the workspace, and a file that is gone all look the same: 404.
 */
export async function readExport(
  deps: ExportDeps,
  input: DownloadRequest,
): Promise<DownloadResponse> {
  const now = clock(deps);
  const row = await findExportForSignedRead(deps.db, input.exportId);
  const exp = parseExpiry(input.exp);
  if (
    row === null ||
    exp === null ||
    !deps.exports.check(
      { exportId: row.id, workspaceId: row.workspaceId, userId: input.userId },
      exp,
      input.sig,
      seconds(now),
    ) ||
    toExport(row, now).status !== 'ready' ||
    !(await isMember(deps.db, row.workspaceId, input.userId))
  ) {
    throw notFound();
  }
  const stored = await deps.storage.stat(row.storageKey);
  if (stored === null) throw notFound();
  return {
    headers: {
      'content-type': 'application/zip',
      'content-length': String(stored.size),
      // The name is ASCII by construction (D-074); Thai text lives only inside the files.
      'content-disposition': `attachment; filename="${row.filename}"; filename*=UTF-8''${encodeURIComponent(row.filename)}`,
      'cache-control': 'no-store',
      'cross-origin-resource-policy': 'cross-origin',
    },
    stream: await deps.storage.read(row.storageKey).catch(() => {
      throw notFound();
    }),
  };
}

/**
 * Maintenance. Marks packages past their expiry as expired and deletes their files (the row is
 * updated first, so a download in progress never meets a half-deleted package). Then removes
 * files left by export jobs that failed, were cancelled, or crashed after writing the file.
 * Returns how many files were removed.
 */
export async function sweepExports(deps: ExportDeps): Promise<number> {
  let removed = 0;
  const expired = await markExpired(deps.db, 200);
  for (const row of expired) {
    await deps.storage.delete(row.storageKey);
    removed += 1;
  }
  const now = clock(deps);
  // Only jobs that ended 10 minutes to 2 days ago: a recent settle may still be deleting its own file.
  const orphans = await listFinishedJobsWithoutPackage(
    deps.db,
    new Date(now.getTime() - 2 * 24 * 3600 * 1000),
    new Date(now.getTime() - 10 * 60 * 1000),
    200,
  );
  for (const job of orphans) {
    const key = exportStorageKey(job.workspaceId, job.id);
    if ((await deps.storage.stat(key)) !== null) {
      await deps.storage.delete(key);
      removed += 1;
    }
  }
  return removed;
}
