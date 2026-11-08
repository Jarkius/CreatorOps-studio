import {
  ApiError,
  ASSET_LIMITS,
  type ApiClient,
  type Product,
  type UploadMime,
} from '@creatorops/contracts';

import { downloadFromTab, TabDownloadError, type TabDownloadPage } from '../metaai/download.js';
import { clearStash, readStash, stashMedia } from '../metaai/page.js';
import type { MetaAiBrowser } from '../metaai/runner.js';

/** Where saving the photo stopped, for the message and "Copy diagnostics". */
export type PhotoStep = 'no_tab' | 'fetch' | 'type' | 'size' | 'read' | 'upload' | 'cover';

export class ShopeePhotoError extends Error {
  readonly step: PhotoStep;
  /** Counts, sizes and the image host only: never the address path or the product name. */
  readonly diagnostics: string;
  constructor(step: PhotoStep, diagnostics: string) {
    super(PHOTO_MESSAGES[step]);
    this.name = 'ShopeePhotoError';
    this.step = step;
    this.diagnostics = diagnostics;
  }
}

const PHOTO_MESSAGES: Readonly<Record<PhotoStep, string>> = {
  no_tab: 'the Shopee Affiliate tab is closed',
  fetch: 'Shopee did not let the photo be downloaded',
  type: 'the photo is not a PNG, JPG, WebP or GIF',
  size: 'the photo is empty or too large',
  read: 'the photo could not be read',
  upload: 'the server did not accept the photo',
  cover: 'the photo was saved but could not be set as the cover',
};

const EXTENSION_FOR: Readonly<Record<UploadMime, string>> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'video/mp4': 'mp4',
};

export interface SavePhotoOptions {
  readonly api: ApiClient;
  readonly workspaceId: string;
  /** The product just created (its version is used for the cover update). */
  readonly product: Product;
  readonly imageUrl: string;
  readonly browser: MetaAiBrowser;
  /** Replaced in tests. */
  readonly page?: TabDownloadPage;
  readonly fetchImpl?: typeof fetch;
  readonly chunkBytes?: number;
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return 'unknown';
  }
}

/**
 * Saves the product photo shown on the owner's Shopee Affiliate page (D-085): one download of that
 * photo inside the owner's own tab, then the normal upload path (intent, signed PUT, complete),
 * then it becomes the product's cover. Throws a ShopeePhotoError naming the step that failed; the
 * product itself is never touched except for the cover.
 */
export async function saveShopeePhoto(options: SavePhotoOptions): Promise<Product> {
  const { api, workspaceId, product, browser } = options;
  const lines = [
    'CreatorOps Shopee photo diagnostics',
    `time: ${new Date().toISOString()}`,
    `image host: ${hostOf(options.imageUrl)}`,
  ];
  const fail = (step: PhotoStep): never => {
    lines.push(`stopped at: ${step}`);
    throw new ShopeePhotoError(step, lines.join('\n'));
  };

  const tab = await browser.findTab();
  if (tab === null) fail('no_tab');
  let file: { bytes: Uint8Array; mimeType: UploadMime };
  try {
    file = await downloadFromTab({
      run: (func, args) => browser.run(tab as number, func, args),
      page: options.page ?? { stashMedia, readStash, clearStash },
      url: options.imageUrl,
      chunkBytes: options.chunkBytes ?? 512 * 1024,
      maxBytes: ASSET_LIMITS.imageBytes,
      onInfo: (info) => lines.push(`file: ${info.size} bytes, type ${info.type || 'none'}`),
    });
  } catch (error) {
    return fail(error instanceof TabDownloadError ? error.step : 'fetch');
  }
  if (file.mimeType === 'video/mp4') fail('type');

  let assetId: string;
  try {
    const intent = await api.assets.createUploadIntent(workspaceId, {
      filename: `shopee-${product.id.slice(0, 8)}.${EXTENSION_FOR[file.mimeType]}`,
      mimeType: file.mimeType,
      sizeBytes: file.bytes.byteLength,
      productId: product.id,
    });
    // No bearer token: the upload address carries its own signature.
    const put = await (options.fetchImpl ?? fetch)(api.resolveUrl(intent.uploadUrl), {
      method: 'PUT',
      headers: { 'content-type': intent.contentType },
      body: new Blob([file.bytes as BlobPart], { type: intent.contentType }),
    });
    if (!put.ok) throw new Error(`upload ${put.status}`);
    assetId = (await api.assets.completeUpload(workspaceId, { intentId: intent.intentId })).id;
  } catch (error) {
    if (error instanceof ApiError) lines.push(`server: ${error.code}`);
    return fail('upload');
  }
  try {
    return await api.products.update(workspaceId, product.id, {
      version: product.version,
      primaryAssetId: assetId,
    });
  } catch (error) {
    if (error instanceof ApiError) lines.push(`server: ${error.code}`);
    return fail('cover');
  }
}
