import type { WorkspaceRole } from '../../db/schema.js';

declare const workspaceIdBrand: unique symbol;

/**
 * A workspace id that has been checked against the caller's membership (D-025). It can only be
 * produced by resolveWorkspaceContext, so a repository function that requires a RequestContext
 * cannot be called with an unchecked id from the client.
 */
export type WorkspaceId = string & { readonly [workspaceIdBrand]: true };

export interface RequestContext {
  readonly userId: string;
  readonly workspaceId: WorkspaceId;
  readonly role: WorkspaceRole;
  readonly requestId: string;
}

/** The authenticated caller, before any workspace is chosen. */
export interface AuthContext {
  readonly userId: string;
  readonly email: string;
  readonly displayName: string;
}

/** Only for use by the identity module after a membership check, and by tests. */
export function brandWorkspaceId(value: string): WorkspaceId {
  return value as WorkspaceId;
}
