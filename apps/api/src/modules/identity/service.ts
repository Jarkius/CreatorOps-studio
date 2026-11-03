import { and, eq } from 'drizzle-orm';

import type { DbOrTx } from '../../db/client.js';
import { users, workspaceMembers, workspaces, type WorkspaceRole } from '../../db/schema.js';
import { brandWorkspaceId, type AuthContext, type RequestContext } from './context.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function findAuthContextById(db: DbOrTx, userId: string): Promise<AuthContext | null> {
  if (!UUID.test(userId)) return null;
  const rows = await db
    .select({ userId: users.id, email: users.email, displayName: users.displayName })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return rows[0] ?? null;
}

export async function findAuthContextByEmail(
  db: DbOrTx,
  email: string,
): Promise<AuthContext | null> {
  const rows = await db
    .select({ userId: users.id, email: users.email, displayName: users.displayName })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);
  return rows[0] ?? null;
}

export interface Membership {
  readonly id: string;
  readonly name: string;
  readonly role: WorkspaceRole;
}

export async function listMemberships(db: DbOrTx, userId: string): Promise<Membership[]> {
  const rows = await db
    .select({ id: workspaces.id, name: workspaces.name, role: workspaceMembers.role })
    .from(workspaceMembers)
    .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
    .where(eq(workspaceMembers.userId, userId))
    .orderBy(workspaces.createdAt);
  return rows.map((row) => ({ id: row.id, name: row.name, role: row.role as WorkspaceRole }));
}

/**
 * Resolves the workspace a request may act on (D-025). Returns null when the id is malformed,
 * does not exist, or the caller is not a member: callers answer all three with 404, so a
 * workspace's existence is never revealed to a non-member.
 */
export async function resolveWorkspaceContext(
  db: DbOrTx,
  userId: string,
  workspaceId: string,
  requestId: string,
): Promise<RequestContext | null> {
  if (!UUID.test(workspaceId)) return null;
  const rows = await db
    .select({ workspaceId: workspaceMembers.workspaceId, role: workspaceMembers.role })
    .from(workspaceMembers)
    .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, userId)))
    .limit(1);
  const row = rows[0];
  if (row === undefined) return null;
  // Brand the id the database returned (canonical lower case), not the caller's spelling.
  return {
    userId,
    workspaceId: brandWorkspaceId(row.workspaceId),
    role: row.role as WorkspaceRole,
    requestId,
  };
}
