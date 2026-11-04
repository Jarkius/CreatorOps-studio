import { z } from 'zod';

import { AssetSchema } from './asset.js';

/** Limits of draft attachments and export packages (D-067). The API and the worker enforce them. */
export const EXPORT_LIMITS = {
  /** Attached assets per draft, cover included. */
  maxAssetsPerDraft: 10,
  /** Media files in one package. */
  maxMediaFiles: 10,
  /** Total media bytes in one package. */
  maxPackageBytes: 500 * 1024 * 1024,
  /** Ready exports a workspace may hold at once. */
  maxLivePerWorkspace: 20,
  /** Days a package stays downloadable. */
  ttlDays: 7,
} as const;

export const DRAFT_ASSET_ROLE_VALUES = ['cover', 'media'] as const;
export const DraftAssetRoleSchema = z.enum(DRAFT_ASSET_ROLE_VALUES);
export type DraftAssetRole = z.infer<typeof DraftAssetRoleSchema>;

const idString = z.string().min(1).max(64);

/** One asset attached to a draft. `sortOrder` is the position in the package (0 first). */
export const DraftAssetSchema = z.object({
  assetId: z.string(),
  role: DraftAssetRoleSchema,
  sortOrder: z.number().int(),
  asset: AssetSchema,
  createdAt: z.string(),
});
export type DraftAsset = z.infer<typeof DraftAssetSchema>;

export const DraftAssetListResponseSchema = z.object({
  items: z.array(DraftAssetSchema),
});
export type DraftAssetListResponse = z.infer<typeof DraftAssetListResponseSchema>;

/**
 * PUT /api/v1/workspaces/:workspaceId/drafts/:draftId/assets. The whole ordered list replaces the
 * attachments, so attach, detach, reorder and the choice of cover are one atomic, repeatable call.
 * At most one asset is the cover. The order of the array is the order in the package.
 */
export const SetDraftAssetsRequestSchema = z
  .object({
    assets: z
      .array(z.object({ assetId: idString, role: DraftAssetRoleSchema.default('media') }).strict())
      .max(EXPORT_LIMITS.maxAssetsPerDraft),
  })
  .strict()
  .refine((value) => value.assets.filter((item) => item.role === 'cover').length <= 1, {
    message: 'at most one asset can be the cover',
    path: ['assets'],
  })
  .refine(
    (value) =>
      new Set(value.assets.map((item) => item.assetId.toLowerCase())).size === value.assets.length,
    { message: 'an asset can be attached once', path: ['assets'] },
  );
export type SetDraftAssetsRequest = z.input<typeof SetDraftAssetsRequestSchema>;

export const DraftAssetsParamsSchema = z.object({ workspaceId: z.string(), draftId: z.string() });
export type DraftAssetsParams = z.infer<typeof DraftAssetsParamsSchema>;

// ---------------------------------------------------------------------------
// Export packages
// ---------------------------------------------------------------------------

export const EXPORT_STATUS_VALUES = ['ready', 'expired'] as const;
export const ExportStatusSchema = z.enum(EXPORT_STATUS_VALUES);
export type ExportStatus = z.infer<typeof ExportStatusSchema>;

/** A finished package. The file itself is fetched with a short-lived signed URL. */
export const ExportSchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  draftId: z.string(),
  jobId: z.string(),
  status: ExportStatusSchema,
  /** The draft version the package was built from. */
  draftVersion: z.number().int(),
  fileCount: z.number().int(),
  sizeBytes: z.number().int(),
  sha256: z.string(),
  /** Suggested download name: ASCII, no path. */
  filename: z.string(),
  createdAt: z.string(),
  expiresAt: z.string(),
});
export type Export = z.infer<typeof ExportSchema>;

/** POST /api/v1/workspaces/:workspaceId/jobs/export-package. Needs an Idempotency-Key header. */
export const CreateExportRequestSchema = z
  .object({
    draftId: idString,
    /** The draft version the user is looking at; a newer version is refused with 409. */
    draftVersion: z.number().int().min(1),
  })
  .strict();
export type CreateExportRequest = z.input<typeof CreateExportRequestSchema>;

export const ExportListQuerySchema = z
  .object({
    draftId: idString.optional(),
    limit: z.coerce.number().int().min(1).max(100).default(25),
    cursor: z.string().max(300).optional(),
  })
  .strict();
export type ExportListQuery = z.input<typeof ExportListQuerySchema>;
export type ExportListQueryParsed = z.infer<typeof ExportListQuerySchema>;

export const ExportListResponseSchema = z.object({
  items: z.array(ExportSchema),
  nextCursor: z.string().nullable(),
});
export type ExportListResponse = z.infer<typeof ExportListResponseSchema>;

export const ExportParamsSchema = z.object({ workspaceId: z.string(), exportId: z.string() });
export type ExportParams = z.infer<typeof ExportParamsSchema>;

/** POST .../exports/:exportId/download-url. The URL is relative to the API origin and lives 5 minutes. */
export const ExportDownloadSchema = z.object({
  url: z.string(),
  expiresAt: z.string(),
  filename: z.string(),
});
export type ExportDownload = z.infer<typeof ExportDownloadSchema>;
