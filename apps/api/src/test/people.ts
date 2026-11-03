import { eq } from 'drizzle-orm';

import type { Db } from '../db/client.js';
import { users, workspaceMembers, workspaces } from '../db/schema.js';
import { signToken } from '../modules/identity/token.js';

export interface Person {
  readonly userId: string;
  readonly workspaceId: string;
  readonly token: string;
}

/**
 * Creates a user who owns one workspace, and a valid bearer token for them. Tests use two of
 * these to play "victim" and "attacker" against each other.
 */
export async function createPerson(db: Db, secret: string, label: string): Promise<Person> {
  const [user] = await db
    .insert(users)
    .values({ email: `${label}@example.test`, displayName: label })
    .returning({ id: users.id });
  if (!user) throw new Error('could not create user');
  const [workspace] = await db
    .insert(workspaces)
    .values({ name: `${label} workspace`, ownerUserId: user.id })
    .returning({ id: workspaces.id });
  if (!workspace) throw new Error('could not create workspace');
  await db
    .insert(workspaceMembers)
    .values({ workspaceId: workspace.id, userId: user.id, role: 'owner' });

  const now = Math.floor(Date.now() / 1000);
  const token = signToken({ sub: user.id, iat: now, exp: now + 3600 }, secret);
  return { userId: user.id, workspaceId: workspace.id, token };
}

export async function countWorkspacesOwnedBy(db: Db, userId: string): Promise<number> {
  const rows = await db
    .select({ id: workspaces.id })
    .from(workspaces)
    .where(eq(workspaces.ownerUserId, userId));
  return rows.length;
}
