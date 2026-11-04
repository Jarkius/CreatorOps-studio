import { and, eq, gt, sql } from 'drizzle-orm';

import type { DbOrTx } from '../../db/client.js';
import { draftExports } from '../../db/schema.js';
import type { RequestContext } from '../identity/context.js';

/** Packages of this workspace that can still be downloaded. */
export async function countLiveExports(db: DbOrTx, ctx: RequestContext): Promise<number> {
  const rows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(draftExports)
    .where(
      and(
        eq(draftExports.workspaceId, ctx.workspaceId),
        eq(draftExports.status, 'ready'),
        gt(draftExports.expiresAt, sql`now()`),
      ),
    );
  return rows[0]?.count ?? 0;
}
