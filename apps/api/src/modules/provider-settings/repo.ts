import { and, eq, sql } from 'drizzle-orm';

import type { DbOrTx } from '../../db/client.js';
import { providerCredentials } from '../../db/schema.js';
import type { RequestContext } from '../identity/context.js';

export type CredentialRow = typeof providerCredentials.$inferSelect;

const nowMs = sql`date_trunc('milliseconds', now())`;

export async function findCredential(
  db: DbOrTx,
  ctx: RequestContext,
): Promise<CredentialRow | null> {
  return findCredentialOf(db, ctx.workspaceId);
}

/** For the worker, which holds a job's workspace id (taken from the job row, never from a client). */
export async function findCredentialOf(
  db: DbOrTx,
  workspaceId: string,
): Promise<CredentialRow | null> {
  const rows = await db
    .select()
    .from(providerCredentials)
    .where(
      and(
        eq(providerCredentials.workspaceId, workspaceId),
        eq(providerCredentials.purpose, 'text'),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

export interface CredentialValues {
  readonly provider: string;
  readonly baseUrl: string;
  readonly model: string;
  readonly keyEncrypted: string;
  readonly keyLast4: string;
  readonly pricing: unknown;
  readonly monthlyCapUsd: string | null;
}

export async function insertCredential(
  db: DbOrTx,
  ctx: RequestContext,
  values: CredentialValues,
): Promise<CredentialRow | null> {
  const rows = await db
    .insert(providerCredentials)
    .values({
      ...values,
      workspaceId: ctx.workspaceId,
      purpose: 'text',
      createdBy: ctx.userId,
      updatedBy: ctx.userId,
    })
    .onConflictDoNothing()
    .returning();
  return rows[0] ?? null;
}

/** Updates only if the stored version is the one the caller saw. */
export async function updateCredential(
  db: DbOrTx,
  ctx: RequestContext,
  version: number,
  values: CredentialValues,
): Promise<CredentialRow | null> {
  const rows = await db
    .update(providerCredentials)
    .set({
      ...values,
      updatedBy: ctx.userId,
      version: sql`${providerCredentials.version} + 1`,
      updatedAt: nowMs,
    })
    .where(
      and(
        eq(providerCredentials.workspaceId, ctx.workspaceId),
        eq(providerCredentials.purpose, 'text'),
        eq(providerCredentials.version, version),
      ),
    )
    .returning();
  return rows[0] ?? null;
}

export async function deleteCredential(db: DbOrTx, ctx: RequestContext): Promise<boolean> {
  const rows = await db
    .delete(providerCredentials)
    .where(
      and(
        eq(providerCredentials.workspaceId, ctx.workspaceId),
        eq(providerCredentials.purpose, 'text'),
      ),
    )
    .returning({ id: providerCredentials.id });
  return rows.length > 0;
}
