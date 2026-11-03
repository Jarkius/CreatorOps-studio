import { desc, eq } from 'drizzle-orm';

import type { DbOrTx } from '../../db/client.js';
import { auditEvents } from '../../db/schema.js';
import type { RequestContext } from '../identity/context.js';

export interface AuditEventInput {
  readonly action: string;
  readonly resourceType: string;
  readonly resourceId: string;
  readonly metadata?: Record<string, unknown>;
}

/**
 * Records an audit event for the context's workspace. Call it inside the same transaction as the
 * change it describes, so both commit or neither does. Metadata must already be free of secrets.
 */
export async function recordAuditEvent(
  db: DbOrTx,
  ctx: RequestContext,
  event: AuditEventInput,
): Promise<void> {
  await db.insert(auditEvents).values({
    workspaceId: ctx.workspaceId,
    actorUserId: ctx.userId,
    action: event.action,
    resourceType: event.resourceType,
    resourceId: event.resourceId,
    metadata: event.metadata ?? {},
  });
}

/** Newest first. The workspace comes from the context; there is no unscoped variant. */
export async function listAuditEvents(db: DbOrTx, ctx: RequestContext, limit = 50) {
  return db
    .select()
    .from(auditEvents)
    .where(eq(auditEvents.workspaceId, ctx.workspaceId))
    .orderBy(desc(auditEvents.createdAt))
    .limit(limit);
}
