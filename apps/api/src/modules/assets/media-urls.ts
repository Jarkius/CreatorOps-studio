import { deriveKey, sign, verify } from '../../platform/signing.js';
import { MEDIA_EXP_BUCKET_SECONDS, MEDIA_URL_TTL_SECONDS } from './limits.js';

export type MediaVariant = 'original' | 'thumb';

export interface MediaSigner {
  /** API-relative signed URL for one variant of an asset. */
  url(
    asset: { id: string; workspaceId: string },
    variant: MediaVariant,
    nowSeconds: number,
  ): string;
  /** True only for a signature made for exactly this asset, workspace, variant and expiry. */
  check(
    asset: { id: string; workspaceId: string },
    variant: MediaVariant,
    exp: number,
    signature: string,
    nowSeconds: number,
  ): boolean;
}

export function createMediaSigner(sessionSecret: string): MediaSigner {
  const key = deriveKey(sessionSecret, 'media');
  const parts = (
    asset: { id: string; workspaceId: string },
    variant: MediaVariant,
    exp: number,
  ) => [asset.id, asset.workspaceId, variant, String(exp)];

  return {
    url(asset, variant, nowSeconds) {
      // Round up to a bucket boundary: the same URL is returned for several minutes, which lets
      // the browser cache the image, while the URL still expires within the stated lifetime.
      const exp =
        Math.ceil((nowSeconds + MEDIA_URL_TTL_SECONDS) / MEDIA_EXP_BUCKET_SECONDS) *
        MEDIA_EXP_BUCKET_SECONDS;
      const signature = sign(key, 'media', parts(asset, variant, exp));
      return `/api/v1/media/${asset.id}/${variant}?exp=${exp}&sig=${signature}`;
    },
    check(asset, variant, exp, signature, nowSeconds) {
      if (exp <= nowSeconds) return false;
      return verify(key, 'media', parts(asset, variant, exp), signature);
    },
  };
}
