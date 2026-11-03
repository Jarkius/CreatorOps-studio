import type { Db } from '../../db/client.js';
import type { Storage } from '../../storage/storage.js';
import { createMediaSigner } from './media-urls.js';
import type { AssetDeps } from './service.js';
import { createUploadSigner } from './upload-signing.js';

/** Builds the asset service dependencies. The app and the maintenance loop share one recipe. */
export function createAssetDeps(options: {
  readonly db: Db;
  readonly storage: Storage;
  readonly sessionSecret: string;
  readonly now?: () => Date;
  readonly uploadIdleMs?: number;
}): AssetDeps {
  return {
    db: options.db,
    storage: options.storage,
    uploads: createUploadSigner(options.sessionSecret),
    media: createMediaSigner(options.sessionSecret),
    ...(options.now ? { now: options.now } : {}),
    ...(options.uploadIdleMs === undefined ? {} : { uploadIdleMs: options.uploadIdleMs }),
  };
}
