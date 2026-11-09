import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { loadConfig } from '../../platform/config.js';
import { requireDatabaseUrl, validEnv } from '../../test/db-url.js';
import { createPerson, type Person } from '../../test/people.js';
import { createTestDb, type TestDb } from '../../test/test-db.js';
import { sweepRetention, type RetentionSettings } from './retention.js';

const SETTINGS: RetentionSettings = {
  auditDays: 365,
  jobDays: 90,
  exportRowDays: 30,
  intentDays: 30,
};

let testDb: TestDb;
let alice: Person;
let campaignId = '';
let draftId = '';
let counter = 0;

const sql = (text: string, values: unknown[] = []) => testDb.pool.query(text, values);
const one = async (text: string, values: unknown[]): Promise<string> =>
  (await sql(text, values)).rows[0].id as string;
const exists = async (table: string, id: string): Promise<boolean> =>
  (await sql(`select 1 from ${table} where id = $1`, [id])).rowCount === 1;

beforeAll(async () => {
  testDb = await createTestDb(requireDatabaseUrl());
  alice = await createPerson(testDb.db, loadConfig(validEnv()).SESSION_SECRET, 'retention-alice');
  const product = await one(
    'insert into products (workspace_id, name) values ($1, $2) returning id',
    [alice.workspaceId, 'P'],
  );
  campaignId = await one(
    `insert into campaigns (workspace_id, product_id, name, template_id, template_version, language, duration_seconds, created_by)
     values ($1, $2, 'C', 'product-showcase', 1, 'th', 30, $3) returning id`,
    [alice.workspaceId, product, alice.userId],
  );
  const sections = {
    title: 't',
    hook: 'h',
    script: 's',
    storyboard: ['a'],
    caption: 'c',
    hashtags: ['#a'],
    callToAction: 'x',
  };
  const state = Object.fromEntries(
    Object.keys(sections).map((n) => [n, { rev: 1, origin: 'generated', jobId: null }]),
  );
  draftId = await one(
    `insert into content_drafts (workspace_id, campaign_id, product_id, sections, section_state) values ($1, $2, $3, $4, $5) returning id`,
    [alice.workspaceId, campaignId, product, JSON.stringify(sections), JSON.stringify(state)],
  );
});

afterAll(async () => {
  await testDb.drop();
});

/** A generate job in `status`, finished `daysAgo` days ago on the database clock (queued: never). */
async function job(
  status: 'failed' | 'cancelled' | 'succeeded' | 'queued',
  daysAgo: number,
): Promise<string> {
  counter += 1;
  const terminal = status !== 'queued';
  return one(
    `insert into jobs (workspace_id, type, status, input, output, error_code, error_message, created_by, idempotency_key, request_hash, campaign_id, attempts, started_at, finished_at)
     values ($1, 'generate_brief', $2, '{}'::jsonb, $3, $4, $5, $6, $7, repeat('d', 64), $8, $9,
             case when $10 then now() - make_interval(days => $11) end,
             case when $10 then now() - make_interval(days => $11) end)
     returning id`,
    [
      alice.workspaceId,
      status,
      status === 'succeeded' ? '{}' : null,
      status === 'failed' ? 'INTERNAL' : null,
      status === 'failed' ? 'It failed.' : null,
      alice.userId,
      `retention-job-${String(counter)}-${randomUUID()}`,
      campaignId,
      terminal ? 1 : 0,
      terminal,
      daysAgo,
    ],
  );
}

describe('retention: jobs', () => {
  it('removes only failed or cancelled jobs finished long ago, with no usage rows and no export rows', async () => {
    const oldFailed = await job('failed', 120);
    const oldCancelled = await job('cancelled', 120);
    const youngFailed = await job('failed', 10);
    const oldSucceeded = await job('succeeded', 400);
    const queued = await job('queued', 0);
    const withUsage = await job('failed', 120);
    await sql(
      `insert into usage_events (workspace_id, job_id, attempt, call_index, provider, model, status, reserved_usd, cost_usd, settled_at)
       values ($1, $2, 1, 1, 'custom', 'm', 'settled', 0.1, 0.05, now())`,
      [alice.workspaceId, withUsage],
    );
    // A failed export job that an export row still points at.
    counter += 1;
    const exportJob = await one(
      `insert into jobs (workspace_id, type, status, input, error_code, error_message, created_by, idempotency_key, request_hash, draft_id, attempts, started_at, finished_at)
       values ($1, 'export_package', 'failed', '{}', 'INTERNAL', 'x', $2, $3, repeat('b', 64), $4, 1, now() - interval '120 days', now() - interval '120 days') returning id`,
      [
        alice.workspaceId,
        alice.userId,
        `retention-export-${String(counter)}-${randomUUID()}`,
        draftId,
      ],
    );
    await sql(
      `insert into draft_exports (workspace_id, draft_id, job_id, created_by, draft_version, file_count, size_bytes, sha256, filename, storage_key, manifest, expires_at)
       values ($1, $2, $3, $4, 1, 1, 1, repeat('f', 64), 'a.zip', $5, '{}', now() + interval '1 day')`,
      [alice.workspaceId, draftId, exportJob, alice.userId, `exports/keep-${randomUUID()}.zip`],
    );

    const result = await sweepRetention(testDb.db, SETTINGS);
    expect(result.jobs).toBe(2);
    expect(await exists('jobs', oldFailed)).toBe(false);
    expect(await exists('jobs', oldCancelled)).toBe(false);
    for (const kept of [youngFailed, oldSucceeded, queued, withUsage, exportJob]) {
      expect(await exists('jobs', kept), kept).toBe(true);
    }
    // The usage ledger is untouched.
    expect(
      (await sql('select count(*)::int as n from usage_events where job_id = $1', [withUsage]))
        .rows[0].n,
    ).toBe(1);
    // A second run finds nothing more.
    expect((await sweepRetention(testDb.db, SETTINGS)).jobs).toBe(0);
  });

  it('follows the configured age: a longer period keeps what a shorter one removes', async () => {
    const failed = await job('failed', 50);
    expect((await sweepRetention(testDb.db, { ...SETTINGS, jobDays: 90 })).jobs).toBe(0);
    expect(await exists('jobs', failed)).toBe(true);
    expect((await sweepRetention(testDb.db, { ...SETTINGS, jobDays: 30 })).jobs).toBe(1);
    expect(await exists('jobs', failed)).toBe(false);
  });
});

describe('retention: audit rows', () => {
  it('removes audit rows older than the period and keeps younger ones', async () => {
    const old = await one(
      `insert into audit_events (workspace_id, actor_user_id, action, resource_type, resource_id, created_at)
       values ($1, $2, 'x.old', 'x', 'r', now() - interval '400 days') returning id`,
      [alice.workspaceId, alice.userId],
    );
    const young = await one(
      `insert into audit_events (workspace_id, actor_user_id, action, resource_type, resource_id, created_at)
       values ($1, $2, 'x.young', 'x', 'r', now() - interval '100 days') returning id`,
      [alice.workspaceId, alice.userId],
    );
    expect((await sweepRetention(testDb.db, SETTINGS)).audit).toBeGreaterThanOrEqual(1);
    expect(await exists('audit_events', old)).toBe(false);
    expect(await exists('audit_events', young)).toBe(true);
  });
});

describe('retention: export rows and upload intents', () => {
  async function exportRow(status: 'ready' | 'expired', expiredDaysAgo: number): Promise<string> {
    counter += 1;
    const job = await one(
      `insert into jobs (workspace_id, type, status, input, output, created_by, idempotency_key, request_hash, draft_id, attempts, started_at, finished_at)
       values ($1, 'export_package', 'succeeded', '{}', '{}', $2, $3, repeat('b', 64), $4, 1, now(), now()) returning id`,
      [
        alice.workspaceId,
        alice.userId,
        `retention-exp-${String(counter)}-${randomUUID()}`,
        draftId,
      ],
    );
    return one(
      `insert into draft_exports (workspace_id, draft_id, job_id, created_by, draft_version, status, file_count, size_bytes, sha256, filename, storage_key, manifest, expires_at)
       values ($1, $2, $3, $4, 1, $5, 1, 1, repeat('f', 64), 'a.zip', $6, '{}', now() - make_interval(days => $7)) returning id`,
      [
        alice.workspaceId,
        draftId,
        job,
        alice.userId,
        status,
        `exports/r-${randomUUID()}.zip`,
        expiredDaysAgo,
      ],
    );
  }

  it('removes export rows only when expired and long past their expiry', async () => {
    const gone = await exportRow('expired', 60);
    const recent = await exportRow('expired', 5);
    // Past its expiry but not yet marked expired: the file may still exist, so the row stays.
    const unswept = await exportRow('ready', 60);
    expect((await sweepRetention(testDb.db, SETTINGS)).exportRows).toBe(1);
    expect(await exists('draft_exports', gone)).toBe(false);
    expect(await exists('draft_exports', recent)).toBe(true);
    expect(await exists('draft_exports', unswept)).toBe(true);
  });

  async function intent(status: string, ageDays: number): Promise<string> {
    return one(
      `insert into upload_intents (workspace_id, user_id, asset_id, declared_mime, declared_size, original_filename, status, expires_at, created_at, updated_at)
       values ($1, $2, gen_random_uuid(), 'image/png', 10, 'a.png', $3, now() + interval '1 hour', now() - make_interval(days => $4), now() - make_interval(days => $4)) returning id`,
      [alice.workspaceId, alice.userId, status, ageDays],
    );
  }

  it('removes old completed upload intents only; unfinished ones belong to the upload sweeper', async () => {
    const oldDone = await intent('completed', 60);
    const youngDone = await intent('completed', 5);
    const oldPending = await intent('pending', 60);
    expect((await sweepRetention(testDb.db, SETTINGS)).intents).toBe(1);
    expect(await exists('upload_intents', oldDone)).toBe(false);
    expect(await exists('upload_intents', youngDone)).toBe(true);
    expect(await exists('upload_intents', oldPending)).toBe(true);
  });
});

describe('retention settings', () => {
  it('has safe defaults and refuses values that could wipe data', () => {
    const config = loadConfig(validEnv());
    expect([
      config.AUDIT_RETENTION_DAYS,
      config.JOB_RETENTION_DAYS,
      config.EXPORT_ROW_RETENTION_DAYS,
      config.INTENT_RETENTION_DAYS,
    ]).toEqual([365, 90, 30, 30]);
    for (const [name, bad] of [
      ['AUDIT_RETENTION_DAYS', '0'],
      ['AUDIT_RETENTION_DAYS', '30'],
      ['JOB_RETENTION_DAYS', '1'],
      ['EXPORT_ROW_RETENTION_DAYS', '-5'],
      ['INTENT_RETENTION_DAYS', 'soon'],
    ] as const) {
      expect(() => loadConfig(validEnv({ [name]: bad })), `${name}=${bad}`).toThrow();
    }
  });
});
