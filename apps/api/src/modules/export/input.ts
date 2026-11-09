import {
  DraftAssetRoleSchema,
  DraftSceneSchema,
  DraftSectionsSchema,
  DraftStatusSchema,
  EXPORT_LIMITS,
} from '@creatorops/contracts';
import { z } from 'zod';

/**
 * What an export job carries (D-067 item 4): a snapshot taken when the job is created, so a retry
 * builds the same package and a later edit cannot race it. Written by the service, read back
 * strictly by the worker.
 */
export const ExportInputSchema = z.object({
  draftId: z.string().min(1),
  draftVersion: z.number().int().min(1),
  status: DraftStatusSchema,
  needsReview: z.boolean(),
  claimWarningCount: z.number().int().min(0),
  sections: DraftSectionsSchema,
  media: z
    .array(
      z.object({
        assetId: z.string().min(1),
        role: DraftAssetRoleSchema,
        scene: DraftSceneSchema.nullable(),
        aiGenerated: z.boolean(),
        generator: z.string().nullable(),
        mimeType: z.string().min(1),
        sizeBytes: z.number().int().min(0),
        sha256: z.string().regex(/^[0-9a-f]{64}$/),
      }),
    )
    .max(EXPORT_LIMITS.maxMediaFiles),
});
export type ExportInput = z.infer<typeof ExportInputSchema>;
export type ExportMediaInput = ExportInput['media'][number];
