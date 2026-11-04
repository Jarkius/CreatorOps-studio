import {
  CampaignListResponseSchema,
  CampaignSchema,
  ErrorBodySchema,
  JobListResponseSchema,
  JobSchema,
  ProductSchema,
  type Job,
} from '@creatorops/contracts';
import { count, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildApp } from '../../app.js';
import { schema } from '../../db/client.js';
import { loadConfig } from '../../platform/config.js';
import { createLogger } from '../../platform/logger.js';
import { requireDatabaseUrl, validEnv } from '../../test/db-url.js';
import { RecordingJobQueue } from '../../test/job-queue.js';
import { createPerson, type Person } from '../../test/people.js';
import { testStorage } from '../../test/storage.js';
import { createTestDb, type TestDb } from '../../test/test-db.js';

const config = loadConfig(validEnv());
const silent = createLogger({ level: 'silent' });

let testDb: TestDb;
let app: FastifyInstance;
let queue: RecordingJobQueue;
let alice: Person; // owner of workspace A
let bob: Person; // owner of workspace B, a stranger to A
let viewer: Person;
let reviewer: Person;
let editor: Person;
let counter = 0;

beforeAll(async () => {
  testDb = await createTestDb(requireDatabaseUrl());
  queue = new RecordingJobQueue();
  app = await buildApp({
    config,
    logger: silent,
    db: testDb.db,
    storage: testStorage(),
    jobQueue: queue,
    rateLimitMax: 100000,
    jobCreateRateLimitMax: 100000,
  });
  alice = await createPerson(testDb.db, config.SESSION_SECRET, 'alice');
  bob = await createPerson(testDb.db, config.SESSION_SECRET, 'bob');
  viewer = await createPerson(testDb.db, config.SESSION_SECRET, 'viewer');
  reviewer = await createPerson(testDb.db, config.SESSION_SECRET, 'reviewer');
  editor = await createPerson(testDb.db, config.SESSION_SECRET, 'editor');
  for (const [person, role] of [
    [viewer, 'viewer'],
    [reviewer, 'reviewer'],
    [editor, 'editor'],
  ] as const) {
    await testDb.db
      .insert(schema.workspaceMembers)
      .values({ workspaceId: alice.workspaceId, userId: person.userId, role });
  }
});

afterAll(async () => {
  await app.close();
  await testDb.drop();
});

const base = (workspaceId: string) => `/api/v1/workspaces/${workspaceId}`;
const newKey = () => `key-${Date.now()}-${(counter += 1)}-abcdef`;

async function call(
  person: Person | null,
  method: 'GET' | 'POST',
  url: string,
  options: { payload?: unknown; key?: string | null } = {},
) {
  return app.inject({
    method,
    url,
    headers: {
      ...(person ? { authorization: `Bearer ${person.token}` } : {}),
      ...(options.key ? { 'idempotency-key': options.key } : {}),
    },
    ...(options.payload === undefined ? {} : { payload: options.payload as object }),
  });
}

async function makeCampaign(person: Person, productName = 'Fan'): Promise<string> {
  const product = await call(person, 'POST', `${base(person.workspaceId)}/products`, {
    payload: { name: productName },
  });
  expect(product.statusCode, product.body).toBe(201);
  const campaign = await call(person, 'POST', `${base(person.workspaceId)}/campaigns`, {
    payload: {
      productId: ProductSchema.parse(product.json()).id,
      templateId: 'product-showcase',
      templateVersion: 1,
      tone: 'เป็นกันเอง',
      platform: 'tiktok',
      durationSeconds: 45,
      variants: 2,
    },
  });
  expect(campaign.statusCode, campaign.body).toBe(201);
  return CampaignSchema.parse(campaign.json()).id;
}

const generate = (
  person: Person | null,
  campaignId: string,
  key: string | null = newKey(),
  workspaceId: string = alice.workspaceId,
) =>
  call(person, 'POST', `${base(workspaceId)}/jobs/generate-brief`, {
    payload: { campaignId },
    key,
  });

async function jobCount(workspaceId: string): Promise<number> {
  const rows = await testDb.db
    .select({ n: count() })
    .from(schema.jobs)
    .where(eq(schema.jobs.workspaceId, workspaceId));
  return rows[0]?.n ?? 0;
}

/** Removes every job of the workspace so each test starts under the active-job cap. */
async function clearJobs(workspaceId: string): Promise<void> {
  await testDb.pool.query('delete from jobs where workspace_id = $1', [workspaceId]);
  queue.enqueued.length = 0;
  queue.failWith = null;
}

describe('creating a job', () => {
  it('answers 202 with a queued job that snapshots the campaign settings, and hands it to the queue', async () => {
    await clearJobs(alice.workspaceId);
    const campaignId = await makeCampaign(alice);
    const response = await generate(alice, campaignId);
    expect(response.statusCode, response.body).toBe(202);
    const job = JobSchema.parse(response.json());
    expect(job).toMatchObject({
      workspaceId: alice.workspaceId,
      type: 'generate_brief',
      status: 'queued',
      attempts: 0,
      maxAttempts: 3,
      campaignId,
      draftId: null,
      output: null,
      errorCode: null,
      startedAt: null,
      finishedAt: null,
    });
    expect(job.input).toMatchObject({
      campaignId,
      templateId: 'product-showcase',
      templateVersion: 1,
      language: 'th',
      tone: 'เป็นกันเอง',
      platform: 'tiktok',
      durationSeconds: 45,
      variants: 2,
    });
    expect(queue.enqueued).toEqual([{ jobId: job.id, delayMs: undefined, attempt: 1 }]);
    const audit = await testDb.pool.query(
      "select metadata from audit_events where action = 'job.create' and resource_id = $1",
      [job.id],
    );
    expect(audit.rows).toHaveLength(1);
  });

  it('replays an earlier request with the same key: 200, the same job, nothing new queued', async () => {
    await clearJobs(alice.workspaceId);
    const campaignId = await makeCampaign(alice);
    const key = newKey();
    const first = JobSchema.parse((await generate(alice, campaignId, key)).json());
    const replay = await generate(alice, campaignId, key);
    expect(replay.statusCode, replay.body).toBe(200);
    expect(JobSchema.parse(replay.json()).id).toBe(first.id);
    expect(await jobCount(alice.workspaceId)).toBe(1);
    expect(queue.enqueued).toHaveLength(1);
    const audit = await testDb.pool.query(
      "select 1 from audit_events where action = 'job.create' and resource_id = $1",
      [first.id],
    );
    expect(audit.rows).toHaveLength(1);
  });

  it('answers 409 IDEMPOTENCY_CONFLICT when the key was used for a different campaign, and creates nothing', async () => {
    await clearJobs(alice.workspaceId);
    const one = await makeCampaign(alice);
    const two = await makeCampaign(alice);
    const key = newKey();
    expect((await generate(alice, one, key)).statusCode).toBe(202);
    const conflict = await generate(alice, two, key);
    expect(conflict.statusCode).toBe(409);
    expect(ErrorBodySchema.parse(conflict.json()).error.code).toBe('IDEMPOTENCY_CONFLICT');
    expect(await jobCount(alice.workspaceId)).toBe(1);
  });

  it('treats a differently spelled campaign id (upper case) as the same request', async () => {
    await clearJobs(alice.workspaceId);
    const campaignId = await makeCampaign(alice);
    const key = newKey();
    expect((await generate(alice, campaignId, key)).statusCode).toBe(202);
    const replay = await generate(alice, campaignId.toUpperCase(), key);
    expect(replay.statusCode, replay.body).toBe(200);
    expect(await jobCount(alice.workspaceId)).toBe(1);
  });

  it('creates exactly one job when the same request arrives ten times at once', async () => {
    await clearJobs(alice.workspaceId);
    const campaignId = await makeCampaign(alice);
    const key = newKey();
    const responses = await Promise.all(
      Array.from({ length: 10 }, () => generate(alice, campaignId, key)),
    );
    const codes = responses.map((r) => r.statusCode).sort();
    expect(codes).toEqual([200, 200, 200, 200, 200, 200, 200, 200, 200, 202]);
    const ids = new Set(responses.map((r) => JobSchema.parse(r.json()).id));
    expect(ids.size).toBe(1);
    expect(await jobCount(alice.workspaceId)).toBe(1);
    expect(queue.enqueued).toHaveLength(1);
  });

  it('keys never collide between users', async () => {
    await clearJobs(alice.workspaceId);
    await clearJobs(bob.workspaceId);
    const key = newKey();
    const a = await generate(alice, await makeCampaign(alice), key);
    const b = await generate(bob, await makeCampaign(bob), key, bob.workspaceId);
    expect(a.statusCode).toBe(202);
    expect(b.statusCode).toBe(202);
    expect(JobSchema.parse(a.json()).id).not.toBe(JobSchema.parse(b.json()).id);
  });

  it('keeps keys apart between two writers of the same workspace', async () => {
    await clearJobs(alice.workspaceId);
    const campaignId = await makeCampaign(alice);
    const key = newKey();
    const mine = await generate(alice, campaignId, key);
    const theirs = await generate(editor, campaignId, key);
    expect(mine.statusCode, mine.body).toBe(202);
    expect(theirs.statusCode, theirs.body).toBe(202);
    expect(JobSchema.parse(mine.json()).id).not.toBe(JobSchema.parse(theirs.json()).id);
    expect(await jobCount(alice.workspaceId)).toBe(2);
  });

  it('requires a valid Idempotency-Key and reports it as a field error', async () => {
    await clearJobs(alice.workspaceId);
    const campaignId = await makeCampaign(alice);
    for (const key of [null, 'short', 'has space 12345678', '../../etc/passwd', 'a'.repeat(129)]) {
      const response = await generate(alice, campaignId, key);
      expect(response.statusCode, String(key)).toBe(400);
      const body = ErrorBodySchema.parse(response.json());
      expect(body.error.code).toBe('VALIDATION_ERROR');
      expect(body.error.details?.fields?.[0]?.path).toBe('Idempotency-Key');
    }
    expect(await jobCount(alice.workspaceId)).toBe(0);
  });

  it('refuses unknown fields and a missing or malformed campaign id', async () => {
    await clearJobs(alice.workspaceId);
    const url = `${base(alice.workspaceId)}/jobs/generate-brief`;
    const campaignId = await makeCampaign(alice);
    for (const payload of [
      {},
      { campaignId: '' },
      { campaignId, workspaceId: bob.workspaceId },
      { campaignId, status: 'succeeded' },
    ]) {
      const response = await call(alice, 'POST', url, { payload, key: newKey() });
      expect(response.statusCode, JSON.stringify(payload)).toBe(400);
    }
    expect(await jobCount(alice.workspaceId)).toBe(0);
  });

  it('answers 400 Campaign not found for a missing, malformed or other-workspace campaign, all alike', async () => {
    await clearJobs(alice.workspaceId);
    const bobsCampaign = await makeCampaign(bob);
    const bodies: string[] = [];
    for (const id of [bobsCampaign, '00000000-0000-4000-8000-000000000000', 'not-a-uuid']) {
      const response = await generate(alice, id);
      expect(response.statusCode, id).toBe(400);
      const error = ErrorBodySchema.parse(response.json()).error;
      expect(error.details?.fields).toEqual([
        { path: 'campaignId', message: 'Campaign not found' },
      ]);
      bodies.push(error.message);
    }
    expect(new Set(bodies).size).toBe(1);
    expect(await jobCount(alice.workspaceId)).toBe(0);
  });

  it('refuses to generate for an archived campaign with 409', async () => {
    await clearJobs(alice.workspaceId);
    const campaignId = await makeCampaign(alice);
    await testDb.pool.query("update campaigns set status = 'archived' where id = $1", [campaignId]);
    const response = await generate(alice, campaignId);
    expect(response.statusCode).toBe(409);
    expect(ErrorBodySchema.parse(response.json()).error.code).toBe('CONFLICT');
  });

  it('still answers 202 and keeps the job queued when the queue is down', async () => {
    await clearJobs(alice.workspaceId);
    queue.failWith = new Error('redis is down');
    const campaignId = await makeCampaign(alice);
    const response = await generate(alice, campaignId);
    expect(response.statusCode, response.body).toBe(202);
    const job = JobSchema.parse(response.json());
    expect(job.status).toBe('queued');
    expect(queue.enqueued).toHaveLength(0);
    const stored = await testDb.pool.query('select status from jobs where id = $1', [job.id]);
    expect(stored.rows[0]).toEqual({ status: 'queued' });
    queue.failWith = null;
  });
});

describe('the active-job cap', () => {
  it('refuses a sixth active job with 429, still replays an earlier request, and frees a slot on cancel', async () => {
    await clearJobs(alice.workspaceId);
    const campaignId = await makeCampaign(alice);
    const keys = Array.from({ length: 5 }, () => newKey());
    const created: Job[] = [];
    for (const key of keys) {
      const response = await generate(alice, campaignId, key);
      expect(response.statusCode, response.body).toBe(202);
      created.push(JobSchema.parse(response.json()));
    }

    const sixth = await generate(alice, campaignId);
    expect(sixth.statusCode).toBe(429);
    expect(ErrorBodySchema.parse(sixth.json()).error.code).toBe('RATE_LIMITED');
    expect(await jobCount(alice.workspaceId)).toBe(5);

    // A replay is not a new job, so it works even at the cap.
    const replay = await generate(alice, campaignId, keys[0]);
    expect(replay.statusCode).toBe(200);

    const first = created[0];
    if (first === undefined) throw new Error('no job');
    const cancelled = await call(
      alice,
      'POST',
      `${base(alice.workspaceId)}/jobs/${first.id}/cancel`,
    );
    expect(cancelled.statusCode, cancelled.body).toBe(200);
    expect((await generate(alice, campaignId)).statusCode).toBe(202);
  });

  it('does not count finished jobs, and the cap is per workspace', async () => {
    await clearJobs(alice.workspaceId);
    await clearJobs(bob.workspaceId);
    const campaignId = await makeCampaign(alice);
    for (let i = 0; i < 5; i += 1) {
      await testDb.pool.query(
        `insert into jobs (workspace_id, type, status, input, created_by, idempotency_key, request_hash, campaign_id, finished_at, output)
         values ($1, 'generate_brief', 'succeeded', '{}'::jsonb, $2, $3, repeat('a', 64), $4, now(), '{}'::jsonb)`,
        [alice.workspaceId, alice.userId, `done-${i}-abcdefgh`, campaignId],
      );
    }
    expect((await generate(alice, campaignId)).statusCode).toBe(202);

    // Bob is unaffected by Alice's jobs.
    expect(
      (await generate(bob, await makeCampaign(bob), newKey(), bob.workspaceId)).statusCode,
    ).toBe(202);
  });
});

describe('roles', () => {
  it('lets viewers and reviewers read but not create or cancel, even with no key', async () => {
    await clearJobs(alice.workspaceId);
    const campaignId = await makeCampaign(alice);
    const job = JobSchema.parse((await generate(alice, campaignId)).json());
    for (const person of [viewer, reviewer]) {
      expect((await generate(person, campaignId, null)).statusCode).toBe(403);
      expect((await generate(person, campaignId)).statusCode).toBe(403);
      expect(
        (await call(person, 'POST', `${base(alice.workspaceId)}/jobs/${job.id}/cancel`)).statusCode,
      ).toBe(403);
      expect((await call(person, 'GET', `${base(alice.workspaceId)}/jobs`)).statusCode).toBe(200);
      expect(
        (await call(person, 'GET', `${base(alice.workspaceId)}/jobs/${job.id}`)).statusCode,
      ).toBe(200);
    }
    expect(await jobCount(alice.workspaceId)).toBe(1);
    const stored = await testDb.pool.query('select status from jobs where id = $1', [job.id]);
    expect(stored.rows[0]).toEqual({ status: 'queued' });
  });

  it('answers a stranger 401 without a token and 404 for another workspace', async () => {
    await clearJobs(alice.workspaceId);
    const campaignId = await makeCampaign(alice);
    const job = JobSchema.parse((await generate(alice, campaignId)).json());
    expect((await generate(null, campaignId)).statusCode).toBe(401);
    // Bob uses Alice's workspace id: not a member, so 404 for everything.
    expect((await generate(bob, campaignId, newKey(), alice.workspaceId)).statusCode).toBe(404);
    expect((await call(bob, 'GET', `${base(alice.workspaceId)}/jobs`)).statusCode).toBe(404);
    expect((await call(bob, 'GET', `${base(alice.workspaceId)}/jobs/${job.id}`)).statusCode).toBe(
      404,
    );
    expect(
      (await call(bob, 'POST', `${base(alice.workspaceId)}/jobs/${job.id}/cancel`)).statusCode,
    ).toBe(404);
  });

  it("never reaches Alice's job through Bob's own workspace, and answers identically for a missing job", async () => {
    await clearJobs(alice.workspaceId);
    const campaignId = await makeCampaign(alice);
    const job = JobSchema.parse((await generate(alice, campaignId)).json());
    const real = await call(bob, 'GET', `${base(bob.workspaceId)}/jobs/${job.id}`);
    const missing = await call(
      bob,
      'GET',
      `${base(bob.workspaceId)}/jobs/00000000-0000-4000-8000-000000000000`,
    );
    expect(real.statusCode).toBe(404);
    expect(missing.statusCode).toBe(404);
    expect(real.json()).toEqual({
      error: { ...missing.json().error, requestId: real.json().error.requestId },
    });
    const cancel = await call(bob, 'POST', `${base(bob.workspaceId)}/jobs/${job.id}/cancel`);
    expect(cancel.statusCode).toBe(404);
    const stored = await testDb.pool.query('select status from jobs where id = $1', [job.id]);
    expect(stored.rows[0]).toEqual({ status: 'queued' });
  });
});

describe('reading jobs', () => {
  it('lists newest first across pages, with status and type filters and bad cursors refused', async () => {
    await clearJobs(alice.workspaceId);
    const campaignId = await makeCampaign(alice);
    const ids: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      ids.push(JobSchema.parse((await generate(alice, campaignId)).json()).id);
    }
    const url = `${base(alice.workspaceId)}/jobs`;

    const seen: string[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < 3; page += 1) {
      const query: string = `?limit=1${cursor === null ? '' : `&cursor=${cursor}`}`;
      const response = await call(alice, 'GET', `${url}${query}`);
      expect(response.statusCode, response.body).toBe(200);
      const body = JobListResponseSchema.parse(response.json());
      expect(body.items).toHaveLength(1);
      seen.push(body.items[0]?.id ?? '');
      cursor = body.nextCursor;
      expect(cursor === null).toBe(page === 2);
    }
    expect(seen).toEqual([...ids].reverse());

    const cancelled = await call(alice, 'POST', `${url}/${ids[0]}/cancel`);
    expect(cancelled.statusCode).toBe(200);
    const onlyCancelled = JobListResponseSchema.parse(
      (await call(alice, 'GET', `${url}?status=cancelled`)).json(),
    );
    expect(onlyCancelled.items.map((j) => j.id)).toEqual([ids[0]]);
    const queued = JobListResponseSchema.parse(
      (await call(alice, 'GET', `${url}?status=queued&type=generate_brief`)).json(),
    );
    expect(queued.items).toHaveLength(2);
    const regenerate = JobListResponseSchema.parse(
      (await call(alice, 'GET', `${url}?type=regenerate_section`)).json(),
    );
    expect(regenerate.items).toEqual([]);

    for (const bad of ['?cursor=not-a-cursor', '?cursor=%00', '?limit=0', '?limit=101', '?x=1']) {
      expect((await call(alice, 'GET', `${url}${bad}`)).statusCode, bad).toBe(400);
    }
  });

  it('filters by campaign and by draft; a malformed or foreign id matches nothing', async () => {
    await clearJobs(alice.workspaceId);
    const first = await makeCampaign(alice, 'First');
    const second = await makeCampaign(alice, 'Second');
    const firstJob = JobSchema.parse((await generate(alice, first)).json());
    const secondJob = JobSchema.parse((await generate(alice, second)).json());
    const url = `${base(alice.workspaceId)}/jobs`;

    const only = async (query: string) =>
      JobListResponseSchema.parse((await call(alice, 'GET', `${url}${query}`)).json()).items.map(
        (job) => job.id,
      );
    expect(await only(`?campaignId=${first}`)).toEqual([firstJob.id]);
    expect(await only(`?campaignId=${second}`)).toEqual([secondJob.id]);
    expect(await only(`?campaignId=${first.toUpperCase()}`)).toEqual([firstJob.id]);
    expect(await only('?campaignId=not-a-uuid')).toEqual([]);
    expect(await only('?draftId=not-a-uuid')).toEqual([]);
    expect(await only(`?draftId=${first}`)).toEqual([]);

    // A regenerate job carries a draft, not a campaign: the draft filter finds it, the campaign
    // filter does not, and another draft's job stays out.
    const [campaignRow] = await testDb.db
      .select()
      .from(schema.campaigns)
      .where(eq(schema.campaigns.id, first));
    if (campaignRow === undefined) throw new Error('campaign vanished');
    const draftIds: string[] = [];
    const regenIds: string[] = [];
    for (let i = 0; i < 2; i += 1) {
      const [draft] = await testDb.db
        .insert(schema.contentDrafts)
        .values({
          workspaceId: alice.workspaceId,
          campaignId: first,
          productId: campaignRow.productId,
          variantIndex: i,
          sections: {},
          sectionState: {},
        })
        .returning();
      if (draft === undefined) throw new Error('draft seed failed');
      draftIds.push(draft.id);
      const [job] = await testDb.db
        .insert(schema.jobs)
        .values({
          workspaceId: alice.workspaceId,
          type: 'regenerate_section',
          status: 'queued',
          input: {},
          createdBy: alice.userId,
          idempotencyKey: `regen-filter-${i}-${newKey()}`,
          requestHash: 'b'.repeat(64),
          draftId: draft.id,
          attempts: 0,
          maxAttempts: 3,
        })
        .returning();
      if (job === undefined) throw new Error('job seed failed');
      regenIds.push(job.id);
    }
    expect(await only(`?draftId=${draftIds[0]}`)).toEqual([regenIds[0]]);
    expect(await only(`?draftId=${draftIds[1]}`)).toEqual([regenIds[1]]);
    expect(await only(`?campaignId=${first}`)).toEqual([firstJob.id]);

    // A campaign of another workspace never matches, even with its real id.
    const foreign = await makeCampaign(bob);
    expect(await only(`?campaignId=${foreign}`)).toEqual([]);
  });

  it('lists campaigns with their newest generate job, null when never generated, never from another workspace', async () => {
    await clearJobs(alice.workspaceId);
    const generated = await makeCampaign(alice, 'Generated');
    const untouched = await makeCampaign(alice, 'Untouched');
    const older = JobSchema.parse((await generate(alice, generated)).json());
    await call(alice, 'POST', `${base(alice.workspaceId)}/jobs/${older.id}/cancel`);
    const newer = JobSchema.parse((await generate(alice, generated)).json());

    const latestOf = async (person: Person) => {
      const response = await call(person, 'GET', `${base(person.workspaceId)}/campaigns?limit=100`);
      expect(response.statusCode, response.body).toBe(200);
      return new Map(
        CampaignListResponseSchema.parse(response.json()).items.map((item) => [
          item.id,
          item.latestGenerateJob?.id ?? null,
        ]),
      );
    };
    const mine = await latestOf(alice);
    expect(mine.get(generated)).toBe(newer.id);
    expect(mine.get(untouched)).toBeNull();

    // Bob's list holds none of Alice's campaigns or jobs.
    const theirs = await latestOf(bob);
    expect(theirs.has(generated)).toBe(false);
  });

  it('answers 404 for a malformed job id', async () => {
    const response = await call(alice, 'GET', `${base(alice.workspaceId)}/jobs/not-a-uuid`);
    expect(response.statusCode).toBe(404);
  });
});

describe('cancelling', () => {
  it('cancels a queued job at once, records it, and is idempotent', async () => {
    await clearJobs(alice.workspaceId);
    const campaignId = await makeCampaign(alice);
    const job = JobSchema.parse((await generate(alice, campaignId)).json());
    const url = `${base(alice.workspaceId)}/jobs/${job.id}/cancel`;
    const response = await call(alice, 'POST', url);
    expect(response.statusCode, response.body).toBe(200);
    const cancelled = JobSchema.parse(response.json());
    expect(cancelled).toMatchObject({
      status: 'cancelled',
      errorCode: 'CANCELLED',
      errorMessage: 'Cancelled by a user.',
    });
    expect(cancelled.finishedAt).not.toBeNull();

    const again = await call(alice, 'POST', url);
    expect(again.statusCode).toBe(200);
    expect(JobSchema.parse(again.json()).finishedAt).toBe(cancelled.finishedAt);

    const audit = await testDb.pool.query(
      "select metadata from audit_events where action = 'job.cancel' and resource_id = $1",
      [job.id],
    );
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0].metadata).toEqual({ was: 'queued' });
  });

  it('flags a running job for cancellation without changing its status', async () => {
    await clearJobs(alice.workspaceId);
    const campaignId = await makeCampaign(alice);
    const job = JobSchema.parse((await generate(alice, campaignId)).json());
    await testDb.pool.query(
      "update jobs set status = 'running', attempts = 1, started_at = now(), locked_until = now() + interval '1 minute' where id = $1",
      [job.id],
    );
    const response = await call(alice, 'POST', `${base(alice.workspaceId)}/jobs/${job.id}/cancel`);
    expect(response.statusCode, response.body).toBe(200);
    expect(JobSchema.parse(response.json()).status).toBe('running');
    const stored = await testDb.pool.query(
      'select status, cancel_requested_at from jobs where id = $1',
      [job.id],
    );
    expect(stored.rows[0].status).toBe('running');
    expect(stored.rows[0].cancel_requested_at).not.toBeNull();
  });

  it('refuses to cancel a finished job with 409 and leaves it alone', async () => {
    await clearJobs(alice.workspaceId);
    const campaignId = await makeCampaign(alice);
    const job = JobSchema.parse((await generate(alice, campaignId)).json());
    await testDb.pool.query(
      "update jobs set status = 'succeeded', finished_at = now(), output = '{}'::jsonb where id = $1",
      [job.id],
    );
    const response = await call(alice, 'POST', `${base(alice.workspaceId)}/jobs/${job.id}/cancel`);
    expect(response.statusCode).toBe(409);
    const stored = await testDb.pool.query('select status from jobs where id = $1', [job.id]);
    expect(stored.rows[0]).toEqual({ status: 'succeeded' });
  });

  it('answers 404 for a job that does not exist', async () => {
    const response = await call(
      alice,
      'POST',
      `${base(alice.workspaceId)}/jobs/00000000-0000-4000-8000-000000000000/cancel`,
    );
    expect(response.statusCode).toBe(404);
  });
});

describe('rate limit on job creation', () => {
  it('limits job-creating requests per client, with a configurable ceiling', async () => {
    const limited = await buildApp({
      config,
      logger: silent,
      db: testDb.db,
      storage: testStorage(),
      jobQueue: new RecordingJobQueue(),
      rateLimitMax: 100000,
      jobCreateRateLimitMax: 2,
    });
    const url = `${base(alice.workspaceId)}/jobs/generate-brief`;
    const results: number[] = [];
    for (let i = 0; i < 3; i += 1) {
      const response = await limited.inject({
        method: 'POST',
        url,
        headers: { authorization: `Bearer ${alice.token}`, 'idempotency-key': 'x' },
        payload: { campaignId: '00000000-0000-4000-8000-000000000000' },
      });
      results.push(response.statusCode);
    }
    // The first two reach the handler (400: bad key or campaign); the third is stopped by the limit.
    expect(results.slice(0, 2).every((code) => code === 400)).toBe(true);
    expect(results[2]).toBe(429);
    await limited.close();
  });
});
