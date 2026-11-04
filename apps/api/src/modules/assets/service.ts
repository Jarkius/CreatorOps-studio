import { createHash, randomUUID } from 'node:crypto';
import { Readable, Transform, type TransformCallback } from 'node:stream';

import type {
  Asset,
  AssetListQueryParsed,
  AssetListResponse,
  CompleteUploadRequest,
  CreateUploadIntentRequest,
  DeleteAssetResponse,
  UploadIntent,
} from '@creatorops/contracts';

import type { Db } from '../../db/client.js';
import { AppError } from '../../platform/errors.js';
import { parseExpiry } from '../../platform/signing.js';
import type { Storage } from '../../storage/storage.js';
import {
  DETECT_BYTES,
  EXTENSION_BY_TYPE,
  detectMediaType,
  isAllowedMediaType,
  maxBytesFor,
  type AllowedMediaType,
} from '../../media/detect.js';
import { recordAuditEvent } from '../audit/repo.js';
import { detachAsset } from '../draft-assets/repo.js';
import type { RequestContext } from '../identity/context.js';
import { assertCanWrite } from '../identity/permissions.js';
import { findProduct } from '../products/repo.js';
import {
  STALE_INTENT_SECONDS,
  UPLOAD_IDLE_MS,
  UPLOAD_TTL_SECONDS,
  WORKSPACE_QUOTA,
} from './limits.js';
import type { MediaSigner, MediaVariant } from './media-urls.js';
import {
  claimIntentForReceiving,
  clearPrimaryAsset,
  completeIntent,
  deleteStaleIntent,
  findAsset,
  findAssetForSignedRead,
  findIntent,
  findIntentForSignedUpload,
  hardDeleteAsset,
  insertAsset,
  insertIntent,
  listAssets as listAssetRows,
  listPurgeableAssets,
  listStaleIntents,
  lockWorkspace,
  markIntentFailed,
  markIntentReceived,
  markReceivedIntentFailed,
  softDeleteAsset,
  workspaceUsage,
  type AssetRow,
} from './repo.js';
import { readImage } from './thumbnails.js';
import type { UploadSigner } from './upload-signing.js';

export interface AssetDeps {
  readonly db: Db;
  readonly storage: Storage;
  readonly uploads: UploadSigner;
  readonly media: MediaSigner;
  /** Injectable clock for tests. */
  readonly now?: () => Date;
  /** Milliseconds without data before an upload is cancelled. Defaults to 30 seconds. */
  readonly uploadIdleMs?: number;
}

const clock = (deps: AssetDeps): Date => (deps.now ? deps.now() : new Date());
const seconds = (date: Date): number => Math.floor(date.getTime() / 1000);

// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001F\u007F]/g;

/** Display text only: NFC, last path segment, no control characters. Never used in a key. */
export function cleanFilename(value: string): string {
  const base = value.normalize('NFC').split(/[\\/]/).pop() ?? '';
  const cleaned = base.replace(CONTROL_CHARS, '').trim();
  return cleaned === '' ? 'file' : cleaned.slice(0, 255);
}

export function originalKey(workspaceId: string, assetId: string, mime: AllowedMediaType): string {
  return `ws/${workspaceId}/${assetId}/original.${EXTENSION_BY_TYPE[mime]}`;
}

export function thumbnailKey(workspaceId: string, assetId: string): string {
  return `ws/${workspaceId}/${assetId}/thumb.webp`;
}

export function toAsset(row: AssetRow, media: MediaSigner, nowSeconds: number): Asset {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    productId: row.productId,
    type: row.type === 'video' ? 'video' : 'image',
    status: row.status === 'deleted' ? 'deleted' : 'ready',
    mimeType: row.mimeType as Asset['mimeType'],
    sizeBytes: row.sizeBytes,
    width: row.width,
    height: row.height,
    durationMs: row.durationMs,
    originalFilename: row.originalFilename,
    sha256: row.sha256,
    url: media.url(row, 'original', nowSeconds),
    thumbUrl: row.thumbnailKey === null ? null : media.url(row, 'thumb', nowSeconds),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

// ---------------------------------------------------------------------------------------------
// Step 1: declare an upload.
// ---------------------------------------------------------------------------------------------

export async function createUploadIntent(
  deps: AssetDeps,
  ctx: RequestContext,
  input: CreateUploadIntentRequest,
): Promise<UploadIntent> {
  assertCanWrite(ctx);
  const now = clock(deps);

  if (input.productId !== undefined) {
    const product = await findProduct(deps.db, ctx, input.productId);
    if (product === null) throw new AppError('NOT_FOUND', 'Product not found.');
  }
  if (!isAllowedMediaType(input.mimeType) || input.sizeBytes > maxBytesFor(input.mimeType)) {
    throw new AppError('VALIDATION_ERROR', 'The request is not valid.', [
      { path: 'sizeBytes', message: 'file is too large for its type' },
    ]);
  }

  const intent = await deps.db.transaction(async (tx) => {
    await lockWorkspace(tx, ctx);
    const usage = await workspaceUsage(tx, ctx, now);
    if (usage.openIntents >= WORKSPACE_QUOTA.maxOpenIntents) {
      throw new AppError('CONFLICT', 'Too many uploads are in progress. Wait for them to finish.');
    }
    if (usage.assets + 1 > WORKSPACE_QUOTA.maxAssets) {
      throw new AppError('CONFLICT', 'This workspace has reached its file limit.');
    }
    if (usage.bytes + input.sizeBytes > WORKSPACE_QUOTA.maxBytes) {
      throw new AppError('CONFLICT', 'This workspace has reached its storage limit.');
    }
    return insertIntent(tx, ctx, {
      userId: ctx.userId,
      productId: input.productId ?? null,
      assetId: randomUUID(),
      declaredMime: input.mimeType,
      declaredSize: input.sizeBytes,
      originalFilename: cleanFilename(input.filename),
      expiresAt: new Date(now.getTime() + UPLOAD_TTL_SECONDS * 1000),
    });
  });

  const signed = deps.uploads.url(
    {
      id: intent.id,
      workspaceId: intent.workspaceId,
      userId: intent.userId,
      declaredSize: intent.declaredSize,
    },
    seconds(now),
  );
  return {
    intentId: intent.id,
    uploadUrl: signed.path,
    method: 'PUT',
    contentType: input.mimeType,
    expiresAt: new Date(signed.exp * 1000).toISOString(),
  };
}

// ---------------------------------------------------------------------------------------------
// Step 2: receive the bytes. No bearer token: the signed URL is the authority.
// ---------------------------------------------------------------------------------------------

/**
 * Passes bytes through while counting them, hashing them, and checking the first bytes against
 * the declared type. Nothing is released downstream until the type is confirmed, so a disallowed
 * file never reaches storage. Fails as soon as the declared size is exceeded.
 */
export class UploadValidator extends Transform {
  private readonly hash = createHash('sha256');
  private held: Buffer[] = [];
  private heldBytes = 0;
  private verified = false;
  total = 0;

  constructor(
    private readonly declaredMime: AllowedMediaType,
    private readonly declaredSize: number,
  ) {
    super();
  }

  digest(): string {
    return this.hash.digest('hex');
  }

  private verify(): AppError | null {
    const head = Buffer.concat(this.held).subarray(0, DETECT_BYTES);
    const detected = detectMediaType(head);
    if (detected !== this.declaredMime) {
      return new AppError(
        'UNSUPPORTED_MEDIA_TYPE',
        'The file content does not match its declared type.',
      );
    }
    this.verified = true;
    return null;
  }

  override _transform(chunk: Buffer, _encoding: BufferEncoding, callback: TransformCallback): void {
    this.total += chunk.length;
    if (this.total > this.declaredSize) {
      callback(new AppError('PAYLOAD_TOO_LARGE', 'The file is larger than it was declared to be.'));
      return;
    }
    this.hash.update(chunk);

    if (this.verified) {
      callback(null, chunk);
      return;
    }
    this.held.push(chunk);
    this.heldBytes += chunk.length;
    if (this.heldBytes < DETECT_BYTES) {
      callback();
      return;
    }
    const failure = this.verify();
    if (failure) {
      callback(failure);
      return;
    }
    const all = Buffer.concat(this.held);
    this.held = [];
    callback(null, all);
  }

  override _flush(callback: TransformCallback): void {
    if (!this.verified) {
      const failure = this.verify();
      if (failure) {
        callback(failure);
        return;
      }
      this.push(Buffer.concat(this.held));
      this.held = [];
    }
    if (this.total !== this.declaredSize) {
      callback(new AppError('BAD_REQUEST', 'The file size does not match what was declared.'));
      return;
    }
    callback();
  }
}

function baseContentType(value: string | undefined): string {
  return (value ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
}

export interface ReceiveInput {
  readonly intentId: string;
  readonly exp: string;
  readonly sig: string;
  readonly contentType: string | undefined;
  readonly contentLength: number | undefined;
  readonly body: Readable;
}

export async function receiveUpload(deps: AssetDeps, input: ReceiveInput): Promise<void> {
  const now = clock(deps);
  const denied = () => new AppError('FORBIDDEN', 'This upload link is not valid.');

  const intent = await findIntentForSignedUpload(deps.db, input.intentId);
  const exp = parseExpiry(input.exp);
  if (
    intent === null ||
    exp === null ||
    !deps.uploads.check(
      {
        id: intent.id,
        workspaceId: intent.workspaceId,
        userId: intent.userId,
        declaredSize: intent.declaredSize,
      },
      exp,
      input.sig,
      seconds(now),
    )
  ) {
    throw denied();
  }

  // Single use: only one request can move the intent from pending to receiving.
  const claimed = await claimIntentForReceiving(deps.db, intent.id, now);
  if (claimed === null)
    throw new AppError('CONFLICT', 'This upload link was already used or has expired.');

  const mime = claimed.declaredMime as AllowedMediaType;
  const key = originalKey(claimed.workspaceId, claimed.assetId, mime);
  try {
    if (baseContentType(input.contentType) !== mime) {
      throw new AppError(
        'UNSUPPORTED_MEDIA_TYPE',
        'The Content-Type must match the declared type.',
      );
    }
    if (input.contentLength !== undefined && input.contentLength !== claimed.declaredSize) {
      throw new AppError('BAD_REQUEST', 'The file size does not match what was declared.');
    }
    const validator = new UploadValidator(mime, claimed.declaredSize);
    // The validator can reject the very first chunk, before storage.put has attached its own
    // handlers (it prepares the directory first). Without a listener that 'error' event would be
    // an uncaught exception and would crash the process, so an attacker could take the API down
    // with one wrong file. The failure itself still reaches us through the pipeline in put().
    validator.on('error', () => undefined);
    input.body.on('error', (error) => validator.destroy(error));

    // Cancel an upload that stops sending data, so a trickle cannot hold a socket, a file handle
    // and a `receiving` intent forever.
    const idleMs = deps.uploadIdleMs ?? UPLOAD_IDLE_MS;
    let idle: NodeJS.Timeout | undefined;
    const rearm = (): void => {
      clearTimeout(idle);
      idle = setTimeout(
        () =>
          validator.destroy(new AppError('BAD_REQUEST', 'The upload stalled and was cancelled.')),
        idleMs,
      );
    };
    rearm();
    input.body.on('data', rearm);
    let stored;
    try {
      stored = await deps.storage.put(key, input.body.pipe(validator));
    } finally {
      clearTimeout(idle);
    }
    await markIntentReceived(deps.db, claimed.id, {
      detectedMime: mime,
      receivedSize: stored.size,
      sha256: validator.digest(),
      storageKey: key,
    });
  } catch (error) {
    await markIntentFailed(deps.db, claimed.id).catch(() => undefined);
    await deps.storage.delete(key).catch(() => undefined);
    throw error;
  }
}

// ---------------------------------------------------------------------------------------------
// Step 3: turn the received file into an asset.
// ---------------------------------------------------------------------------------------------

async function readAll(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk as Uint8Array));
  return Buffer.concat(chunks);
}

export async function completeUpload(
  deps: AssetDeps,
  ctx: RequestContext,
  input: CompleteUploadRequest,
): Promise<Asset> {
  assertCanWrite(ctx);
  const nowSeconds = seconds(clock(deps));
  const notFound = () => new AppError('NOT_FOUND', 'Upload not found.');

  const intent = await findIntent(deps.db, ctx, input.intentId);
  // Someone else's intent, in this workspace or another, looks exactly like a missing one.
  if (intent === null || intent.userId !== ctx.userId) throw notFound();

  const existing = async (): Promise<Asset> => {
    const row = await findAsset(deps.db, ctx, intent.assetId);
    if (row === null) throw notFound();
    return toAsset(row, deps.media, nowSeconds);
  };

  if (intent.status === 'completed') return existing(); // idempotent
  if (
    intent.status !== 'received' ||
    intent.storageKey === null ||
    intent.sha256 === null ||
    intent.receivedSize === null
  ) {
    throw new AppError('CONFLICT', 'The file has not been uploaded yet.');
  }

  const mime = intent.declaredMime as AllowedMediaType;
  const isImage = mime.startsWith('image/');
  let width: number | null = null;
  let height: number | null = null;
  let thumbKey: string | null = null;

  if (isImage) {
    // Reading the stored file is I/O: if it fails, the upload is not necessarily bad, so the
    // intent is left alone and the caller can simply try again.
    const bytes = await readAll(await deps.storage.read(intent.storageKey));

    let info;
    try {
      info = await readImage(bytes);
    } catch (error) {
      // The file really is not a usable image. Fail the intent and remove the file, but only if
      // this call is the one that moved it from `received`: a request that lost a race with a
      // completing one must never delete the file that the finished asset uses.
      if (await markReceivedIntentFailed(deps.db, ctx, intent.id)) {
        await deps.storage.delete(intent.storageKey).catch(() => undefined);
      }
      throw error;
    }
    width = info.width;
    height = info.height;
    thumbKey = thumbnailKey(ctx.workspaceId, intent.assetId);
    await deps.storage
      .put(thumbKey, Readable.from([info.thumbnail]))
      .catch((error: NodeJS.ErrnoException) => {
        if (error.code !== 'EEXIST') throw error; // a concurrent completion already wrote it
      });
  }

  const row = await deps.db.transaction(async (tx) => {
    await lockWorkspace(tx, ctx);
    // The intent's share is already part of the usage (received intents keep counting), so the
    // totals must still be within the limits. This guards the invariant, whatever happened before.
    const usage = await workspaceUsage(tx, ctx, clock(deps));
    if (usage.bytes > WORKSPACE_QUOTA.maxBytes || usage.assets > WORKSPACE_QUOTA.maxAssets) {
      throw new AppError('CONFLICT', 'This workspace has reached its storage limit.');
    }
    const completed = await completeIntent(tx, ctx, intent.id);
    if (completed === null) return null; // another request completed it first
    const created = await insertAsset(tx, ctx, {
      id: intent.assetId,
      productId: intent.productId,
      type: isImage ? 'image' : 'video',
      mimeType: mime,
      sizeBytes: intent.receivedSize as number,
      width,
      height,
      originalFilename: intent.originalFilename,
      sha256: intent.sha256 as string,
      storageKey: intent.storageKey as string,
      thumbnailKey: thumbKey,
      createdBy: ctx.userId,
    });
    await recordAuditEvent(tx, ctx, {
      action: 'asset.created',
      resourceType: 'asset',
      resourceId: created.id,
      metadata: { type: created.type, sizeBytes: created.sizeBytes, productId: created.productId },
    });
    return created;
  });

  return row === null ? existing() : toAsset(row, deps.media, nowSeconds);
}

// ---------------------------------------------------------------------------------------------
// Library.
// ---------------------------------------------------------------------------------------------

function encodeCursor(row: AssetRow): string {
  return Buffer.from(JSON.stringify({ t: row.createdAt.toISOString(), i: row.id })).toString(
    'base64url',
  );
}

function decodeCursor(cursor: string): { createdAt: Date; id: string } {
  const invalid = () =>
    new AppError('VALIDATION_ERROR', 'The request is not valid.', [
      { path: 'cursor', message: 'is not a valid cursor' },
    ]);
  if (!/^[A-Za-z0-9_-]+$/.test(cursor)) throw invalid();
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as {
      t?: unknown;
      i?: unknown;
    };
    if (typeof parsed.t !== 'string' || typeof parsed.i !== 'string') throw invalid();
    const createdAt = new Date(parsed.t);
    if (Number.isNaN(createdAt.getTime()) || !/^[0-9a-f-]{36}$/i.test(parsed.i)) throw invalid();
    return { createdAt, id: parsed.i };
  } catch (error) {
    throw error instanceof AppError ? error : invalid();
  }
}

export async function listAssets(
  deps: AssetDeps,
  ctx: RequestContext,
  query: AssetListQueryParsed,
): Promise<AssetListResponse> {
  const rows = await listAssetRows(deps.db, ctx, {
    productId: query.productId,
    type: query.type,
    limit: query.limit + 1,
    after: query.cursor === undefined ? undefined : decodeCursor(query.cursor),
  });
  const page = rows.slice(0, query.limit);
  const last = page[page.length - 1];
  const nowSeconds = seconds(clock(deps));
  return {
    items: page.map((row) => toAsset(row, deps.media, nowSeconds)),
    nextCursor: rows.length > query.limit && last !== undefined ? encodeCursor(last) : null,
  };
}

export async function getAsset(
  deps: AssetDeps,
  ctx: RequestContext,
  assetId: string,
): Promise<Asset> {
  const row = await findAsset(deps.db, ctx, assetId);
  if (row === null || row.status !== 'ready') throw new AppError('NOT_FOUND', 'File not found.');
  return toAsset(row, deps.media, seconds(clock(deps)));
}

export async function deleteAsset(
  deps: AssetDeps,
  ctx: RequestContext,
  assetId: string,
): Promise<DeleteAssetResponse> {
  assertCanWrite(ctx);
  const result = await deps.db.transaction(async (tx) => {
    const deleted = await softDeleteAsset(tx, ctx, assetId);
    if (deleted === null) return null;
    const cleared = await clearPrimaryAsset(tx, ctx, deleted.id);
    const detached = await detachAsset(tx, ctx.workspaceId, deleted.id);
    await recordAuditEvent(tx, ctx, {
      action: 'asset.deleted',
      resourceType: 'asset',
      resourceId: deleted.id,
      metadata: { clearedPrimaryFor: cleared, detachedFromDrafts: detached },
    });
    return deleted;
  });
  if (result !== null) return { id: result.id, deleted: true };

  // Missing, or already deleted (harmless to repeat).
  const row = await findAsset(deps.db, ctx, assetId);
  if (row === null) throw new AppError('NOT_FOUND', 'File not found.');
  return { id: row.id, deleted: true };
}

// ---------------------------------------------------------------------------------------------
// Reading media with a signed URL. No bearer token.
// ---------------------------------------------------------------------------------------------

export interface MediaRequest {
  readonly assetId: string;
  readonly variant: MediaVariant;
  readonly exp: string;
  readonly sig: string;
  readonly range: string | undefined;
}

export interface MediaResponse {
  readonly status: 200 | 206 | 416;
  readonly headers: Readonly<Record<string, string>>;
  readonly stream: Readable | null;
}

function parseRange(
  header: string | undefined,
  size: number,
): { start: number; end: number } | 'unsatisfiable' | null {
  if (header === undefined) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return null; // unsupported forms (e.g. several ranges): ignore and send everything
  const [, first = '', last = ''] = match;
  if (first === '' && last === '') return null;
  let start: number;
  let end: number;
  if (first === '') {
    const suffix = Number(last);
    if (suffix === 0) return 'unsatisfiable';
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(first);
    end = last === '' ? size - 1 : Math.min(Number(last), size - 1);
  }
  if (start >= size || start > end) return 'unsatisfiable';
  return { start, end };
}

export async function readMedia(deps: AssetDeps, input: MediaRequest): Promise<MediaResponse> {
  const nowSeconds = seconds(clock(deps));
  const notFound = () => new AppError('NOT_FOUND', 'Not found.');

  const asset = await findAssetForSignedRead(deps.db, input.assetId);
  const exp = parseExpiry(input.exp);
  // A bad signature, an expired link, a deleted asset and a missing asset all look the same.
  if (
    asset === null ||
    exp === null ||
    asset.status !== 'ready' ||
    !deps.media.check(asset, input.variant, exp, input.sig, nowSeconds)
  ) {
    throw notFound();
  }

  const key = input.variant === 'thumb' ? asset.thumbnailKey : asset.storageKey;
  if (key === null) throw notFound();
  const stored = await deps.storage.stat(key);
  if (stored === null) throw notFound();

  const contentType = input.variant === 'thumb' ? 'image/webp' : asset.mimeType;
  const extension =
    input.variant === 'thumb' ? 'webp' : EXTENSION_BY_TYPE[asset.mimeType as AllowedMediaType];
  const remaining = Math.max(0, Math.min(exp - nowSeconds, 15 * 60));
  const common = {
    'content-type': contentType, // from the database row, never sniffed from the file
    'content-disposition': `inline; filename="asset.${extension}"`,
    'accept-ranges': 'bytes',
    'cache-control': `private, max-age=${remaining}`,
    'cross-origin-resource-policy': 'cross-origin',
  };

  const range = parseRange(input.range, stored.size);
  if (range === 'unsatisfiable') {
    return {
      status: 416,
      headers: { ...common, 'content-range': `bytes */${stored.size}` },
      stream: null,
    };
  }
  if (range === null) {
    return {
      status: 200,
      headers: { ...common, 'content-length': String(stored.size) },
      stream: await deps.storage.read(key),
    };
  }
  return {
    status: 206,
    headers: {
      ...common,
      'content-length': String(range.end - range.start + 1),
      'content-range': `bytes ${range.start}-${range.end}/${stored.size}`,
    },
    stream: await deps.storage.read(key, range),
  };
}

// ---------------------------------------------------------------------------------------------
// Maintenance.
// ---------------------------------------------------------------------------------------------

/**
 * Removes uploads that never finished, with their files. The row is deleted first and only if it
 * is still stale and not completed; files are removed only when this call removed the row, so a
 * completion that commits at the same moment keeps its file. Returns how many were removed.
 */
export async function sweepUploads(deps: AssetDeps): Promise<number> {
  const cutoff = new Date(clock(deps).getTime() - STALE_INTENT_SECONDS * 1000);
  const stale = await listStaleIntents(deps.db, cutoff, 200);
  let removed = 0;
  for (const candidate of stale) {
    const intent = await deleteStaleIntent(deps.db, candidate.id, cutoff);
    if (intent === null) continue;
    const key =
      intent.storageKey ??
      originalKey(intent.workspaceId, intent.assetId, intent.declaredMime as AllowedMediaType);
    await deps.storage.delete(key);
    await deps.storage.delete(thumbnailKey(intent.workspaceId, intent.assetId));
    removed += 1;
  }
  return removed;
}

/** Permanently removes assets that were soft-deleted before `deletedBefore`, with their files. */
export async function purgeDeletedAssets(deps: AssetDeps, deletedBefore: Date): Promise<number> {
  const rows = await listPurgeableAssets(deps.db, deletedBefore, 200);
  for (const row of rows) {
    await deps.storage.delete(row.storageKey);
    if (row.thumbnailKey !== null) await deps.storage.delete(row.thumbnailKey);
    await hardDeleteAsset(deps.db, row.id);
  }
  return rows.length;
}
