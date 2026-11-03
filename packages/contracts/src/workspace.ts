import { z } from 'zod';

import { WorkspaceRoleSchema } from './auth.js';

export const LANGUAGE_VALUES = ['th', 'en'] as const;
export const LanguageSchema = z.enum(LANGUAGE_VALUES);
export type Language = z.infer<typeof LanguageSchema>;

/** A workspace as seen by one of its members, including that member's role. */
export const WorkspaceSchema = z.object({
  id: z.string(),
  name: z.string(),
  defaultLanguage: LanguageSchema,
  brandVoice: z.string().nullable(),
  role: WorkspaceRoleSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Workspace = z.infer<typeof WorkspaceSchema>;

/** POST /api/v1/workspaces. The owner is always the caller; the client cannot choose it. */
export const CreateWorkspaceRequestSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    defaultLanguage: LanguageSchema.default('th'),
    brandVoice: z.string().trim().max(2000).nullish(),
  })
  // Strict on purpose: an unknown field such as ownerUserId or role is rejected, never ignored,
  // so a client cannot even attempt mass assignment.
  .strict();
export type CreateWorkspaceRequest = z.input<typeof CreateWorkspaceRequestSchema>;

/** GET /api/v1/workspaces */
export const WorkspaceListResponseSchema = z.object({ items: z.array(WorkspaceSchema) });
export type WorkspaceListResponse = z.infer<typeof WorkspaceListResponseSchema>;

/** Path parameters of every /workspaces/:workspaceId route. */
export const WorkspaceParamsSchema = z.object({ workspaceId: z.string() });
