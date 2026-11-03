import type { Workspace } from '@creatorops/contracts';
import { count, eq, sql } from 'drizzle-orm';

import type { Db } from '../../db/client.js';
import { workspaceMembers, workspaces, type WorkspaceRole } from '../../db/schema.js';
import { AppError } from '../../platform/errors.js';
import { recordAuditEvent } from '../audit/repo.js';
import type { AuthContext, RequestContext } from '../identity/context.js';
import { createWorkspaceWithOwner } from '../identity/service.js';

/** A user may own this many workspaces; a simple guard against runaway creation. */
export const MAX_WORKSPACES_PER_USER = 20;

interface WorkspaceRow {
  readonly id: string;
  readonly name: string;
  readonly defaultLanguage: string;
  readonly brandVoice: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

function toWorkspace(row: WorkspaceRow, role: WorkspaceRole): Workspace {
  return {
    id: row.id,
    name: row.name,
    defaultLanguage: row.defaultLanguage === 'en' ? 'en' : 'th',
    brandVoice: row.brandVoice,
    role,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Workspaces the user is a member of, oldest first. */
export async function listWorkspacesForUser(db: Db, userId: string): Promise<Workspace[]> {
  const rows = await db
    .select({
      id: workspaces.id,
      name: workspaces.name,
      defaultLanguage: workspaces.defaultLanguage,
      brandVoice: workspaces.brandVoice,
      createdAt: workspaces.createdAt,
      updatedAt: workspaces.updatedAt,
      role: workspaceMembers.role,
    })
    .from(workspaceMembers)
    .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
    .where(eq(workspaceMembers.userId, userId))
    .orderBy(workspaces.createdAt, workspaces.id);
  return rows.map((row) => toWorkspace(row, row.role as WorkspaceRole));
}

export async function getWorkspace(db: Db, ctx: RequestContext): Promise<Workspace> {
  const rows = await db
    .select({
      id: workspaces.id,
      name: workspaces.name,
      defaultLanguage: workspaces.defaultLanguage,
      brandVoice: workspaces.brandVoice,
      createdAt: workspaces.createdAt,
      updatedAt: workspaces.updatedAt,
    })
    .from(workspaces)
    .where(eq(workspaces.id, ctx.workspaceId))
    .limit(1);
  const row = rows[0];
  if (row === undefined) throw new AppError('NOT_FOUND', 'Workspace not found.');
  return toWorkspace(row, ctx.role);
}

export interface CreateWorkspaceInput {
  readonly name: string;
  readonly defaultLanguage: 'th' | 'en';
  readonly brandVoice?: string | null | undefined;
}

/**
 * Creates a workspace owned by the caller. The workspace, the owner membership and the audit
 * event commit together or not at all. The caller's identity comes from the verified token,
 * never from the request body.
 */
export async function createWorkspace(
  db: Db,
  auth: AuthContext,
  input: CreateWorkspaceInput,
  requestId: string,
): Promise<Workspace> {
  const brandVoice = input.brandVoice?.normalize('NFC').trim() || null;
  const name = input.name.normalize('NFC').trim();

  const created = await db.transaction(async (tx) => {
    // Serialise per user so two concurrent requests cannot both pass the limit check.
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${`workspace-create:${auth.userId}`}))`,
    );
    const owned = await tx
      .select({ n: count() })
      .from(workspaces)
      .where(eq(workspaces.ownerUserId, auth.userId));
    if ((owned[0]?.n ?? 0) >= MAX_WORKSPACES_PER_USER) {
      throw new AppError('CONFLICT', 'You have reached the maximum number of workspaces.');
    }

    const ctx = await createWorkspaceWithOwner(
      tx,
      auth.userId,
      { name, defaultLanguage: input.defaultLanguage, brandVoice },
      requestId,
    );
    await recordAuditEvent(tx, ctx, {
      action: 'workspace.created',
      resourceType: 'workspace',
      resourceId: ctx.workspaceId,
      metadata: { name, defaultLanguage: input.defaultLanguage },
    });
    return ctx;
  });

  return getWorkspace(db, created);
}
