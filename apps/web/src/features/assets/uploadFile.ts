import { ApiError, ASSET_LIMITS, ErrorBodySchema, UPLOAD_MIME_VALUES } from '@creatorops/contracts';
import type { ApiClient, Asset, UploadMime } from '@creatorops/contracts';

/** Value for the file input's `accept` attribute: exactly the types the API takes (D-038). */
export const ACCEPT_ATTRIBUTE = UPLOAD_MIME_VALUES.join(',');

/** Upper bound for one byte upload. A 200 MB video on a slow link can take a long time. */
export const UPLOAD_TIMEOUT_MS = 15 * 60_000;

const SIZE_UNITS = ['B', 'KB', 'MB', 'GB'] as const;

/** "512 B", "1.5 MB": a readable size for a file of any size the app handles. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < SIZE_UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return unit === 0 ? `${bytes} B` : `${value.toFixed(1)} ${SIZE_UNITS[unit]}`;
}

export function isUploadMime(value: string): value is UploadMime {
  return (UPLOAD_MIME_VALUES as readonly string[]).includes(value);
}

/** The byte limit for a media type: videos get the larger cap. */
export function maxBytesFor(mimeType: UploadMime): number {
  return mimeType.startsWith('video/') ? ASSET_LIMITS.videoBytes : ASSET_LIMITS.imageBytes;
}

/**
 * Checks a file before any request is made. Returns the problem as text, or null when the file
 * may be uploaded. The API repeats these checks; this exists so a bad file costs no round trip.
 */
export function validateFile(file: Pick<File, 'name' | 'size' | 'type'>): string | null {
  if (file.name.trim() === '') return 'The file needs a name.';
  if (file.name.length > ASSET_LIMITS.filename) {
    return `File names can be up to ${ASSET_LIMITS.filename} characters.`;
  }
  if (!isUploadMime(file.type)) {
    return 'This file type is not supported. Use JPEG, PNG, WebP, GIF or MP4.';
  }
  if (file.size === 0) return 'This file is empty.';
  const limit = maxBytesFor(file.type);
  if (file.size > limit) {
    const kind = file.type.startsWith('video/') ? 'Videos' : 'Images';
    return `${kind} can be up to ${formatBytes(limit)}. This file is ${formatBytes(file.size)}.`;
  }
  return null;
}

export type UploadStage = 'preparing' | 'uploading' | 'finishing';

export interface UploadProgress {
  readonly stage: UploadStage;
  /** 0 to 100. Meaningful during `uploading`; 0 while preparing and 100 while finishing. */
  readonly percent: number;
}

export interface UploadProgressEvent {
  readonly lengthComputable: boolean;
  readonly loaded: number;
  readonly total: number;
}

/**
 * The part of XMLHttpRequest the byte upload uses. The browser gets a real XHR; tests inject a
 * fake, so progress and failures can be driven without a network.
 */
export interface UploadTransport {
  timeout: number;
  status: number;
  responseText: string;
  upload: { onprogress: ((event: UploadProgressEvent) => void) | null };
  onload: (() => void) | null;
  onerror: (() => void) | null;
  ontimeout: (() => void) | null;
  onabort: (() => void) | null;
  open(method: string, url: string): void;
  setRequestHeader(name: string, value: string): void;
  send(body: Blob): void;
  abort(): void;
}

export type TransportFactory = () => UploadTransport;

const browserTransport: TransportFactory = () =>
  // XMLHttpRequest implements the subset above; its event types are wider than ours.
  new XMLHttpRequest() as unknown as UploadTransport;

export interface UploadFileOptions {
  readonly client: ApiClient;
  readonly workspaceId: string;
  readonly file: File;
  readonly productId?: string;
  readonly onProgress?: (progress: UploadProgress) => void;
  /** Aborts the upload. The promise rejects with an ApiError and the caller sees `signal.aborted`. */
  readonly signal?: AbortSignal;
  readonly createTransport?: TransportFactory;
}

function cancelledError(): ApiError {
  // The API has no code for a local cancel. Callers detect cancellation with `signal.aborted`.
  return new ApiError({ code: 'BAD_REQUEST', message: 'The upload was cancelled.' });
}

function fallbackRejection(status: number): string {
  if (status === 415) return 'The file content does not match its type, so it was refused.';
  if (status === 409) return 'This upload link has expired or was already used. Try again.';
  if (status === 413) return 'The file is larger than allowed.';
  if (status === 400) return 'The upload was not accepted.';
  if (status >= 500) return 'The server had a problem. Please try again.';
  return 'The upload failed. Please try again.';
}

/** Turns a failed PUT into an ApiError, using the server's own message when it sent one. */
function rejectedUpload(status: number, responseText: string): ApiError {
  let parsed: unknown;
  try {
    parsed = JSON.parse(responseText) as unknown;
  } catch {
    parsed = undefined;
  }
  const body = ErrorBodySchema.safeParse(parsed);
  if (body.success) {
    return new ApiError({
      code: body.data.error.code,
      message: body.data.error.message,
      status,
      requestId: body.data.error.requestId,
    });
  }
  return new ApiError({
    code: status >= 500 ? 'INTERNAL_ERROR' : 'BAD_REQUEST',
    message: fallbackRejection(status),
    status,
  });
}

/** Sends the raw bytes to the signed URL. No bearer token: the URL carries its own signature. */
function putBytes(options: {
  client: ApiClient;
  uploadUrl: string;
  contentType: string;
  file: File;
  onProgress: ((progress: UploadProgress) => void) | undefined;
  signal: AbortSignal | undefined;
  createTransport: TransportFactory;
}): Promise<void> {
  const { client, uploadUrl, contentType, file, onProgress, signal, createTransport } = options;
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(cancelledError());
      return;
    }
    const xhr = createTransport();
    const onAbort = () => xhr.abort();
    const finish = () => signal?.removeEventListener('abort', onAbort);

    xhr.timeout = UPLOAD_TIMEOUT_MS;
    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable || event.total <= 0) return;
      const percent = Math.min(100, Math.floor((event.loaded / event.total) * 100));
      onProgress?.({ stage: 'uploading', percent });
    };
    xhr.onload = () => {
      finish();
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(rejectedUpload(xhr.status, xhr.responseText));
    };
    xhr.onerror = () => {
      finish();
      reject(
        new ApiError({
          code: 'NETWORK_ERROR',
          message: 'Could not reach the server. Check your connection and try again.',
        }),
      );
    };
    xhr.ontimeout = () => {
      finish();
      reject(new ApiError({ code: 'TIMEOUT', message: 'The upload took too long. Try again.' }));
    };
    xhr.onabort = () => {
      finish();
      reject(cancelledError());
    };

    signal?.addEventListener('abort', onAbort, { once: true });
    xhr.open('PUT', client.resolveUrl(uploadUrl));
    xhr.setRequestHeader('Content-Type', contentType);
    onProgress?.({ stage: 'uploading', percent: 0 });
    xhr.send(file);
  });
}

/**
 * Uploads one file in three steps: declare it, send the bytes, then complete it into an asset.
 * Resolves with the asset. Rejects with an ApiError whose message is safe to show.
 */
export async function uploadFile(options: UploadFileOptions): Promise<Asset> {
  const {
    client,
    workspaceId,
    file,
    productId,
    onProgress,
    signal,
    createTransport = browserTransport,
  } = options;

  const problem = validateFile(file);
  if (problem !== null) throw new ApiError({ code: 'VALIDATION_ERROR', message: problem });
  if (signal?.aborted) throw cancelledError();

  onProgress?.({ stage: 'preparing', percent: 0 });
  const intent = await client.assets.createUploadIntent(workspaceId, {
    filename: file.name,
    mimeType: file.type as UploadMime,
    sizeBytes: file.size,
    ...(productId === undefined ? {} : { productId }),
  });
  if (signal?.aborted) throw cancelledError();

  await putBytes({
    client,
    uploadUrl: intent.uploadUrl,
    contentType: intent.contentType,
    file,
    onProgress,
    signal,
    createTransport,
  });

  // The bytes are on the server. Completing is quick and safe to repeat, so it is not cancelled.
  onProgress?.({ stage: 'finishing', percent: 100 });
  return client.assets.completeUpload(workspaceId, { intentId: intent.intentId });
}
