import { and, eq, gte, isNull, sql } from 'drizzle-orm';

import type { Db, DbOrTx } from '../../db/client.js';
import { usageEvents } from '../../db/schema.js';

export interface ReserveInput {
  readonly workspaceId: string;
  readonly jobId: string;
  readonly attempt: number;
  readonly callIndex: number;
  readonly provider: string;
  readonly model: string;
  /** The worst case for this call, in USD. */
  readonly reservedUsd: number;
  /** The monthly limit in USD, or null for none. */
  readonly capUsd: number | null;
}

export type ReserveResult =
  | { readonly ok: true; readonly eventId: string }
  | { readonly ok: false; readonly reason: 'over_cap' | 'duplicate' | 'cost_hold' };

/** The start of the current calendar month in UTC, as the database computes it. */
const monthStart = sql`date_trunc('month', now() at time zone 'UTC') at time zone 'UTC'`;

/** Names the per-workspace lock that serialises reservations (tests hold it to prove the wait). */
export const RESERVE_LOCK_SEED = 7;

const usd = (value: number): string => value.toFixed(6);

/** Cost counted against the limit this month: settled cost plus what is still set aside. */
export async function countedUsd(db: DbOrTx, workspaceId: string): Promise<number> {
  const rows = await db
    .select({
      total: sql<string>`coalesce(sum(case when ${usageEvents.status} = 'settled' then coalesce(${usageEvents.costUsd}, 0) when ${usageEvents.status} = 'reserved' then ${usageEvents.reservedUsd} else 0 end), 0)`,
    })
    .from(usageEvents)
    .where(and(eq(usageEvents.workspaceId, workspaceId), gte(usageEvents.createdAt, monthStart)));
  return Number(rows[0]?.total ?? 0);
}

/**
 * True while a call that cost far more than expected (an anomaly) has not been acknowledged by an
 * owner or admin. New calls are refused until then (D-077 follow-up: a mispriced model must not
 * keep spending up to the monthly limit).
 */
export async function hasCostHold(db: DbOrTx, workspaceId: string): Promise<boolean> {
  const rows = await db
    .select({ id: usageEvents.id })
    .from(usageEvents)
    .where(
      and(
        eq(usageEvents.workspaceId, workspaceId),
        eq(usageEvents.anomaly, true),
        isNull(usageEvents.anomalyAckedAt),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

/** Clears the hold: marks this workspace's unacknowledged anomalies as seen. Returns how many. */
export async function acknowledgeAnomalies(db: DbOrTx, workspaceId: string): Promise<number> {
  const rows = await db
    .update(usageEvents)
    .set({ anomalyAckedAt: sql`date_trunc('milliseconds', now())` })
    .where(
      and(
        eq(usageEvents.workspaceId, workspaceId),
        eq(usageEvents.anomaly, true),
        isNull(usageEvents.anomalyAckedAt),
      ),
    )
    .returning({ id: usageEvents.id });
  return rows.length;
}

/**
 * Sets the worst case aside before a call is made. The check and the insert run under one lock per
 * workspace, so two workers cannot both pass the limit. With no limit the event is still recorded.
 */
export async function reserveCall(db: Db, input: ReserveInput): Promise<ReserveResult> {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${input.workspaceId}, ${RESERVE_LOCK_SEED}))`,
    );
    // Checked even with no monthly limit: the hold exists for exactly that case.
    if (await hasCostHold(tx, input.workspaceId)) {
      return { ok: false, reason: 'cost_hold' } as const;
    }
    if (input.capUsd !== null) {
      const counted = await countedUsd(tx, input.workspaceId);
      // A tiny tolerance keeps rounding (six decimals) from refusing a call that exactly fits.
      if (counted + input.reservedUsd > input.capUsd + 1e-9) {
        return { ok: false, reason: 'over_cap' } as const;
      }
    }
    const rows = await tx
      .insert(usageEvents)
      .values({
        workspaceId: input.workspaceId,
        jobId: input.jobId,
        attempt: input.attempt,
        callIndex: input.callIndex,
        provider: input.provider,
        model: input.model,
        status: 'reserved',
        reservedUsd: usd(input.reservedUsd),
      })
      .onConflictDoNothing()
      .returning({ id: usageEvents.id });
    const row = rows[0];
    return row === undefined
      ? ({ ok: false, reason: 'duplicate' } as const)
      : ({ ok: true, eventId: row.id } as const);
  });
}

export interface Settlement {
  readonly status: 'settled' | 'released';
  readonly requests: number;
  readonly inputUnits: number;
  readonly outputUnits: number;
  readonly costUsd: number;
  readonly costSource: 'reported' | 'computed' | 'reserved' | null;
  readonly anomaly: boolean;
}

/** Records what a call cost. Only a still-reserved event can be settled, and only once. */
export async function settleCall(
  db: DbOrTx,
  eventId: string,
  settlement: Settlement,
): Promise<boolean> {
  const rows = await db
    .update(usageEvents)
    .set({
      status: settlement.status,
      requests: settlement.requests,
      inputUnits: settlement.inputUnits,
      outputUnits: settlement.outputUnits,
      costUsd: usd(settlement.costUsd),
      costSource: settlement.costSource,
      anomaly: settlement.anomaly,
      settledAt: sql`date_trunc('milliseconds', now())`,
    })
    .where(and(eq(usageEvents.id, eventId), eq(usageEvents.status, 'reserved')))
    .returning({ id: usageEvents.id });
  return rows.length === 1;
}

export interface MonthSummary {
  readonly month: string;
  readonly calls: number;
  readonly inputUnits: number;
  readonly outputUnits: number;
  readonly spentUsd: number;
  readonly reservedUsd: number;
  readonly anomalies: number;
  readonly byModel: readonly { provider: string; model: string; calls: number; costUsd: number }[];
}

export async function monthSummary(db: DbOrTx, workspaceId: string): Promise<MonthSummary> {
  const inMonth = and(
    eq(usageEvents.workspaceId, workspaceId),
    gte(usageEvents.createdAt, monthStart),
  );
  const totals = await db
    .select({
      month: sql<string>`to_char(now() at time zone 'UTC', 'YYYY-MM')`,
      calls: sql<number>`count(*) filter (where ${usageEvents.status} = 'settled')::int`,
      inputUnits: sql<number>`coalesce(sum(${usageEvents.inputUnits}) filter (where ${usageEvents.status} = 'settled'), 0)::int`,
      outputUnits: sql<number>`coalesce(sum(${usageEvents.outputUnits}) filter (where ${usageEvents.status} = 'settled'), 0)::int`,
      spent: sql<string>`coalesce(sum(coalesce(${usageEvents.costUsd}, 0)) filter (where ${usageEvents.status} = 'settled'), 0)`,
      reserved: sql<string>`coalesce(sum(${usageEvents.reservedUsd}) filter (where ${usageEvents.status} = 'reserved'), 0)`,
      anomalies: sql<number>`count(*) filter (where ${usageEvents.anomaly})::int`,
    })
    .from(usageEvents)
    .where(inMonth);
  const models = await db
    .select({
      provider: usageEvents.provider,
      model: usageEvents.model,
      calls: sql<number>`count(*)::int`,
      cost: sql<string>`coalesce(sum(coalesce(${usageEvents.costUsd}, 0)), 0)`,
    })
    .from(usageEvents)
    .where(and(inMonth, eq(usageEvents.status, 'settled')))
    .groupBy(usageEvents.provider, usageEvents.model)
    .orderBy(usageEvents.provider, usageEvents.model);
  const row = totals[0];
  return {
    month: row?.month ?? '',
    calls: row?.calls ?? 0,
    inputUnits: row?.inputUnits ?? 0,
    outputUnits: row?.outputUnits ?? 0,
    spentUsd: Number(row?.spent ?? 0),
    reservedUsd: Number(row?.reserved ?? 0),
    anomalies: row?.anomalies ?? 0,
    byModel: models.map((m) => ({
      provider: m.provider,
      model: m.model,
      calls: m.calls,
      costUsd: Number(m.cost),
    })),
  };
}
