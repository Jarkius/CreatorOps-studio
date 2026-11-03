import { eq } from 'drizzle-orm';

import type { Db } from './client.js';
import { users, workspaceMembers, workspaces } from './schema.js';

export const DEV_USER_EMAIL = 'dev@creatorops.local';

export interface SeedResult {
  readonly userId: string;
  readonly workspaceId: string;
}

/**
 * Creates the single development user and workspace used by mock authentication. Safe to run
 * repeatedly: it returns the existing rows when they are already there.
 */
export async function seedDevData(db: Db): Promise<SeedResult> {
  return db.transaction(async (tx) => {
    const existing = await tx.select().from(users).where(eq(users.email, DEV_USER_EMAIL)).limit(1);
    let userId = existing[0]?.id;
    if (userId === undefined) {
      const created = await tx
        .insert(users)
        .values({ email: DEV_USER_EMAIL, displayName: 'Dev User' })
        .returning({ id: users.id });
      userId = created[0]?.id;
    }
    if (userId === undefined) throw new Error('Failed to create the development user');

    const owned = await tx
      .select({ id: workspaces.id })
      .from(workspaces)
      .where(eq(workspaces.ownerUserId, userId))
      .limit(1);
    let workspaceId = owned[0]?.id;
    if (workspaceId === undefined) {
      const created = await tx
        .insert(workspaces)
        .values({ name: 'Dev Workspace', ownerUserId: userId })
        .returning({ id: workspaces.id });
      workspaceId = created[0]?.id;
      if (workspaceId === undefined) throw new Error('Failed to create the development workspace');
      await tx.insert(workspaceMembers).values({ workspaceId, userId, role: 'owner' });
    }
    return { userId, workspaceId };
  });
}
