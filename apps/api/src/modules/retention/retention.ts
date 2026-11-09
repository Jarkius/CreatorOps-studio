import { sql } from 'drizzle-orm';

import type { Db } from '../../db/client.js';

/**
 * Retention (D-088): removes rows nobody needs any more. It never touches the usage ledger (the
 * money record, which cost reports read over all time) or any job that has usage rows, any
 * succeeded job (the panel and the final video read their output; export rows reference them), or
 * anything not yet old enough. Ages use the database clock. Each table is deleted in short batches
 * so no run holds long locks.
 */
export interface RetentionSettings {
  readonly auditDays: number;
  readonly jobDays: number;
  readonly exportRowDays: number;
  readonly intentDays: number;
}

export interface RetentionResult {
  readonly audit: number;
  readonly jobs: number;
  readonly exportRows: number;
  readonly intents: number;
  /** Steps that threw (for example a new table that references jobs): the others still ran. */
  readonly failed: readonly { readonly step: string; readonly error: unknown }[];
}

/** Rows deleted per statement, and how many statements per table in one run. */
export const BATCH = 500;
export const MAX_BATCHES = 10;

async function inBatches(db: Db, run: () => Promise<number>): Promise<number> {
  let total = 0;
  for (let round = 0; round < MAX_BATCHES; round += 1) {
    const deleted = await run();
    total += deleted;
    if (deleted < BATCH) break;
  }
  return total;
}

const days = (value: number) => sql`make_interval(days => ${value})`;

/** Deletes with `returning 1` so the affected count is the number of returned rows. */
async function count(db: Db, statement: ReturnType<typeof sql>): Promise<number> {
  const result = await db.execute(statement);
  return result.rows.length;
}

export async function sweepRetention(
  db: Db,
  settings: RetentionSettings,
): Promise<RetentionResult> {
  // One step failing (say a new table whose foreign key to jobs is not in the guard below) must not
  // stop the others, hour after hour: each step runs alone and is reported by name.
  const failed: { step: string; error: unknown }[] = [];
  const step = async (name: string, run: () => Promise<number>): Promise<number> => {
    try {
      return await run();
    } catch (error) {
      failed.push({ step: name, error });
      return 0;
    }
  };
  const audit = await step('audit', () =>
    inBatches(db, () =>
      count(
        db,
        sql`delete from audit_events where id in (
            select id from audit_events
            where created_at < now() - ${days(settings.auditDays)}
            order by created_at limit ${BATCH}
          ) returning 1`,
      ),
    ),
  );

  // Only failed or cancelled jobs, finished long ago, with no usage rows and no export rows.
  const jobs = await step('jobs', () =>
    inBatches(db, () =>
      count(
        db,
        sql`delete from jobs where id in (
            select j.id from jobs j
            where j.status in ('failed', 'cancelled')
              and j.finished_at < now() - ${days(settings.jobDays)}
              and not exists (
                select 1 from usage_events u where u.workspace_id = j.workspace_id and u.job_id = j.id
              )
              and not exists (
                select 1 from draft_exports e where e.workspace_id = j.workspace_id and e.job_id = j.id
              )
            order by j.finished_at limit ${BATCH}
          ) returning 1`,
      ),
    ),
  );

  // Export rows whose package expired long ago (the sweeper already removed the file).
  const exportRows = await step('exportRows', () =>
    inBatches(db, () =>
      count(
        db,
        sql`delete from draft_exports where id in (
            select id from draft_exports
            where status = 'expired'
              and expires_at < now() - ${days(settings.exportRowDays)}
            order by expires_at limit ${BATCH}
          ) returning 1`,
      ),
    ),
  );

  // Finished upload intents: only a repeated "complete" for an old upload reads them.
  const intents = await step('intents', () =>
    inBatches(db, () =>
      count(
        db,
        sql`delete from upload_intents where id in (
            select id from upload_intents
            where status = 'completed'
              and updated_at < now() - ${days(settings.intentDays)}
            order by updated_at limit ${BATCH}
          ) returning 1`,
      ),
    ),
  );

  return { audit, jobs, exportRows, intents, failed };
}
