import { z } from 'zod';

export const WORKSPACE_ROLE_VALUES = ['owner', 'admin', 'editor', 'reviewer', 'viewer'] as const;
export const WorkspaceRoleSchema = z.enum(WORKSPACE_ROLE_VALUES);
export type WorkspaceRoleValue = z.infer<typeof WorkspaceRoleSchema>;

export const UserSchema = z.object({
  id: z.string(),
  email: z.string(),
  displayName: z.string(),
});
export type User = z.infer<typeof UserSchema>;

export const MembershipSchema = z.object({
  id: z.string(),
  name: z.string(),
  role: WorkspaceRoleSchema,
});
export type Membership = z.infer<typeof MembershipSchema>;

/** GET /api/v1/me */
export const MeResponseSchema = z.object({
  user: UserSchema,
  workspaces: z.array(MembershipSchema),
});
export type MeResponse = z.infer<typeof MeResponseSchema>;

/** POST /api/v1/auth/mock-token (development only; exists only when AUTH_MODE=mock). */
export const MockTokenResponseSchema = z.object({
  token: z.string(),
  /** ISO 8601 expiry time. */
  expiresAt: z.string(),
  user: UserSchema,
});
export type MockTokenResponse = z.infer<typeof MockTokenResponseSchema>;
