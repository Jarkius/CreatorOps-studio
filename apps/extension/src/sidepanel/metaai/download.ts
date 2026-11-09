import { UPLOAD_MIME_VALUES, type UploadMime } from '@creatorops/contracts';

import type { StashInfo } from './page.js';

/** Which part of a download from the owner's tab went wrong (for messages and diagnostics). */
export type DownloadStep = 'fetch' | 'type' | 'size' | 'read';

export class TabDownloadError extends Error {
  readonly step: DownloadStep;
  /** What the page said about the file, when it got that far. */
  readonly info: StashInfo | null;
  constructor(step: DownloadStep, info: StashInfo | null = null) {
    super(`download failed at ${step}`);
    this.name = 'TabDownloadError';
    this.step = step;
    this.info = info;
  }
}

/** The page functions that fetch a file inside the tab and hand it over in base64 chunks. */
export interface TabDownloadPage {
  readonly stashMedia: (url: string) => Promise<StashInfo>;
  readonly readStash: (offset: number, length: number) => Promise<string>;
  readonly clearStash: () => boolean;
}

export interface TabDownloadOptions {
  /** Runs one page function in the owner's tab. */
  readonly run: <Args extends unknown[], Result>(
    func: (...args: Args) => Result | Promise<Result>,
    args: Args,
  ) => Promise<Result>;
  readonly page: TabDownloadPage;
  readonly url: string;
  readonly chunkBytes: number;
  readonly maxBytes: number;
  /** Throws to stop between chunks (cancel). */
  readonly checkAborted?: () => void;
  /** Called once the page knows the file's size and type. */
  readonly onInfo?: (info: StashInfo) => void;
}

export function isUploadMime(value: string): value is UploadMime {
  return (UPLOAD_MIME_VALUES as readonly string[]).includes(value);
}

export function fromBase64(text: string): Uint8Array {
  const raw = atob(text);
  const out = new Uint8Array(raw.length);
  for (let index = 0; index < raw.length; index += 1) out[index] = raw.charCodeAt(index);
  return out;
}

/**
 * Downloads one file inside the owner's tab (so the owner's own access applies) and copies it out
 * in chunks. Only types the upload path accepts, and only up to `maxBytes`. The page's copy is
 * always cleared afterwards. Errors from `run` other than the download itself (a cancel) pass
 * through unchanged.
 */
export async function downloadFromTab(
  options: TabDownloadOptions,
): Promise<{ bytes: Uint8Array; mimeType: UploadMime }> {
  const { run, page } = options;
  let stashed = false;
  try {
    let info: StashInfo;
    try {
      info = await run(page.stashMedia, [options.url]);
      stashed = true;
    } catch {
      throw new TabDownloadError('fetch');
    }
    options.onInfo?.(info);
    if (!isUploadMime(info.type)) throw new TabDownloadError('type', info);
    if (info.size < 1 || info.size > options.maxBytes) throw new TabDownloadError('size', info);
    const bytes = new Uint8Array(info.size);
    for (let offset = 0; offset < info.size; offset += options.chunkBytes) {
      options.checkAborted?.();
      const chunk = fromBase64(await run(page.readStash, [offset, options.chunkBytes]));
      if (offset + chunk.length > info.size) throw new TabDownloadError('read', info);
      bytes.set(chunk, offset);
    }
    return { bytes, mimeType: info.type };
  } finally {
    if (stashed) await run(page.clearStash, []).catch(() => false);
  }
}
