import { z } from 'zod';

export const ASSET_TYPE_VALUES = ['image', 'video'] as const;
export const AssetTypeSchema = z.enum(ASSET_TYPE_VALUES);
export type AssetType = z.infer<typeof AssetTypeSchema>;

/** The only media types accepted (D-038). SVG and everything else are refused. */
export const UPLOAD_MIME_VALUES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'video/mp4',
] as const;
export const UploadMimeSchema = z.enum(UPLOAD_MIME_VALUES);
export type UploadMime = z.infer<typeof UploadMimeSchema>;

export const ASSET_LIMITS = {
  filename: 255,
  imageBytes: 15 * 1024 * 1024,
  videoBytes: 200 * 1024 * 1024,
} as const;

export const AssetSchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  productId: z.string().nullable(),
  type: AssetTypeSchema,
  status: z.enum(['ready', 'deleted']),
  mimeType: UploadMimeSchema,
  sizeBytes: z.number().int(),
  width: z.number().int().nullable(),
  height: z.number().int().nullable(),
  durationMs: z.number().int().nullable(),
  /** What the user called the file. Display text only. */
  originalFilename: z.string(),
  sha256: z.string(),
  /** Short-lived signed URL for the original, relative to the API origin (use `client.resolveUrl`). */
  url: z.string(),
  /** Short-lived signed URL for the thumbnail, or null (videos have none yet). */
  thumbUrl: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Asset = z.infer<typeof AssetSchema>;

/** POST .../assets/upload-intent. Declares what is about to be uploaded. */
export const CreateUploadIntentRequestSchema = z
  .object({
    filename: z.string().trim().min(1).max(ASSET_LIMITS.filename),
    mimeType: UploadMimeSchema,
    sizeBytes: z.number().int().min(1).max(ASSET_LIMITS.videoBytes),
    productId: z.string().max(64).optional(),
  })
  .strict()
  .refine(
    (value) =>
      value.sizeBytes <=
      (value.mimeType.startsWith('video/') ? ASSET_LIMITS.videoBytes : ASSET_LIMITS.imageBytes),
    { message: 'file is too large for its type', path: ['sizeBytes'] },
  );
export type CreateUploadIntentRequest = z.input<typeof CreateUploadIntentRequestSchema>;

export const UploadIntentSchema = z.object({
  intentId: z.string(),
  /** Where to PUT the bytes, relative to the API origin. It carries its own signature. */
  uploadUrl: z.string(),
  method: z.literal('PUT'),
  /** Send exactly this Content-Type with the PUT. */
  contentType: UploadMimeSchema,
  expiresAt: z.string(),
});
export type UploadIntent = z.infer<typeof UploadIntentSchema>;

export const CompleteUploadRequestSchema = z.object({ intentId: z.string().max(64) }).strict();
export type CompleteUploadRequest = z.infer<typeof CompleteUploadRequestSchema>;

export const AssetListQuerySchema = z
  .object({
    productId: z.string().max(64).optional(),
    type: AssetTypeSchema.optional(),
    /** Part of the file name, any case. Blank means no filter. */
    q: z.string().trim().max(100).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(25),
    cursor: z.string().max(300).optional(),
  })
  .strict();
export type AssetListQuery = z.input<typeof AssetListQuerySchema>;
export type AssetListQueryParsed = z.infer<typeof AssetListQuerySchema>;

export const AssetListResponseSchema = z.object({
  items: z.array(AssetSchema),
  nextCursor: z.string().nullable(),
});
export type AssetListResponse = z.infer<typeof AssetListResponseSchema>;

export const AssetParamsSchema = z.object({ workspaceId: z.string(), assetId: z.string() });

export const DeleteAssetResponseSchema = z.object({ id: z.string(), deleted: z.literal(true) });
export type DeleteAssetResponse = z.infer<typeof DeleteAssetResponseSchema>;
