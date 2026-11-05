import { deriveKey, sign, verify } from '../../platform/signing.js';

/** Signed download links for export packages live five minutes (D-067 item 7). */
export const EXPORT_URL_TTL_SECONDS = 5 * 60;

export interface ExportLinkSubject {
  readonly exportId: string;
  readonly workspaceId: string;
  readonly userId: string;
}

export interface ExportSigner {
  /** API-relative signed URL, bound to the export, its workspace and the member who asked. */
  url(subject: ExportLinkSubject, nowSeconds: number): { url: string; exp: number };
  /** True only for a signature made for exactly this export, workspace, member and expiry. */
  check(subject: ExportLinkSubject, exp: number, signature: string, nowSeconds: number): boolean;
}

/** Uses its own derived key (label `export`), so a media or upload signature never validates here. */
export function createExportSigner(sessionSecret: string): ExportSigner {
  const key = deriveKey(sessionSecret, 'export');
  const parts = (s: ExportLinkSubject, exp: number) => [
    s.exportId,
    s.workspaceId,
    s.userId,
    String(exp),
  ];
  return {
    url(subject, nowSeconds) {
      const exp = nowSeconds + EXPORT_URL_TTL_SECONDS;
      const signature = sign(key, 'export', parts(subject, exp));
      return {
        url: `/api/v1/exports/${subject.exportId}/download?u=${subject.userId}&exp=${exp}&sig=${signature}`,
        exp,
      };
    },
    check(subject, exp, signature, nowSeconds) {
      if (exp <= nowSeconds) return false;
      return verify(key, 'export', parts(subject, exp), signature);
    },
  };
}
