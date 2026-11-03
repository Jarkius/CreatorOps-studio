import { deriveKey, sign, verify } from '../../platform/signing.js';
import { UPLOAD_TTL_SECONDS } from './limits.js';

export interface UploadIntentFacts {
  readonly id: string;
  readonly workspaceId: string;
  readonly userId: string;
  readonly declaredSize: number;
}

export interface UploadSigner {
  /** API-relative signed URL for the PUT of one intent. */
  url(intent: UploadIntentFacts, nowSeconds: number): { path: string; exp: number };
  check(intent: UploadIntentFacts, exp: number, signature: string, nowSeconds: number): boolean;
}

/**
 * The signature binds the intent, its workspace, the user who created it, and the declared size,
 * so a URL cannot be reused for another intent, workspace, user, or size (D-038).
 */
export function createUploadSigner(sessionSecret: string): UploadSigner {
  const key = deriveKey(sessionSecret, 'upload');
  const parts = (intent: UploadIntentFacts, exp: number) => [
    intent.id,
    intent.workspaceId,
    intent.userId,
    String(intent.declaredSize),
    String(exp),
  ];

  return {
    url(intent, nowSeconds) {
      const exp = nowSeconds + UPLOAD_TTL_SECONDS;
      const signature = sign(key, 'upload', parts(intent, exp));
      return { path: `/api/v1/uploads/${intent.id}?exp=${exp}&sig=${signature}`, exp };
    },
    check(intent, exp, signature, nowSeconds) {
      if (exp <= nowSeconds) return false;
      return verify(key, 'upload', parts(intent, exp), signature);
    },
  };
}
