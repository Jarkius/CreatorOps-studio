import { randomBytes } from 'node:crypto';

import { UsageSummarySchema } from '@creatorops/contracts';
import {
  MockTextProvider,
  type DraftSections,
  type HttpRequest,
  type HttpResponse,
  type HttpTransport,
} from '@creatorops/provider-core';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { buildApp } from '../../app.js';
import { loadConfig } from '../../platform/config.js';
import { createLogger } from '../../platform/logger.js';
import { parseSecretsKey } from '../../platform/secrets.js';
import { requireDatabaseUrl, validEnv } from '../../test/db-url.js';
import { RecordingJobQueue } from '../../test/job-queue.js';
import { createPerson, type Person } from '../../test/people.js';
import { testStorage } from '../../test/storage.js';
import { createTestDb, type TestDb } from '../../test/test-db.js';
import { processJob, type WorkerDeps } from '../jobs/process.js';
import { resolveProvider } from '../provider-settings/resolver.js';
import { RESERVE_LOCK_SEED, reserveCall } from './ledger.js';

const KEY_B64 = randomBytes(32).toString('base64');
const config = loadConfig(validEnv({ SECRETS_ENCRYPTION_KEY: KEY_B64 }));
const secrets = parseSecretsKey(KEY_B64, 'k1');
const silent = createLogger({ level: 'silent' });
const quiet = { info: () => undefined, warn: () => undefined, error: () => undefined };
const API_KEY = 'sk-or-v1-0123456789abcdefLIVEKEY';
const PRICING = { inputPerMillionUsd: 3, outputPerMillionUsd: 15 };

let testDb: TestDb;
let app: FastifyInstance;
let queue: RecordingJobQueue;
let draft: DraftSections;
let counter = 0;

/** What the fake provider will do on its next calls. */
interface Script {
  status?: number;
  cost?: number;
  content?: string;
  headers?: Record<string, string>;
  finish?: string;
  throwError?: boolean;
}
let script: Script[] = [];
const requests: HttpRequest[] = [];

const transport: HttpTransport = (request) => {
  requests.push(request);
  const step = script.shift() ?? {};
  if (step.throwError) return Promise.reject(new TypeError('network down'));
  const body = {
    choices: [
      {
        message: { content: step.content ?? JSON.stringify(draft) },
        finish_reason: step.finish ?? 'stop',
      },
    ],
    usage: {
      prompt_tokens: 1000,
      completion_tokens: 500,
      ...(step.cost === undefined ? {} : { cost: step.cost }),
    },
  };
  const headers = step.headers ?? {};
  const response: HttpResponse = {
    status: step.status ?? 200,
    headers: { get: (name) => headers[name.toLowerCase()] ?? null },
    text: () => Promise.resolve(JSON.stringify(body)),
  };
  return Promise.resolve(response);
};

const workerDeps = (): WorkerDeps => {
  const fallback = new MockTextProvider();
  return {
    db: testDb.db,
    provider: fallback,
    resolveProvider: (job, attempt) =>
      resolveProvider({ db: testDb.db, fallback, secrets, transport, log: quiet }, job, attempt),
    queue,
    log: quiet,
    random: () => 0,
  };
};

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
    providerRateLimitMax: 100000,
    providerTransport: transport,
  });
  draft = (
    await new MockTextProvider().generateBrief({
      template: { id: 'product-showcase', version: 1 },
      language: 'th',
      tone: null,
      platform: 'generic',
      durationSeconds: 30,
      variantIndex: 0,
      product: {
        name: 'พัดลม',
        description: null,
        priceAmount: null,
        currency: null,
        sellingPoints: ['เบา'],
        targetAudience: null,
        brandTone: null,
        restrictedClaims: [],
      },
    })
  ).output;
});

afterAll(async () => {
  await app.close();
  await testDb.drop();
});

beforeEach(() => {
  script = [];
  requests.length = 0;
  queue.enqueued.length = 0;
});

const auth = (who: Person) => ({ authorization: `Bearer ${who.token}` });
const base = (who: Person) => `/api/v1/workspaces/${who.workspaceId}`;

async function person(label: string): Promise<Person> {
  counter += 1;
  return createPerson(testDb.db, config.SESSION_SECRET, `rp-${label}-${String(counter)}`);
}

async function saveProvider(who: Person, extra: Record<string, unknown> = {}) {
  const response = await app.inject({
    method: 'PUT',
    url: `${base(who)}/provider-settings`,
    headers: auth(who),
    payload: {
      provider: 'openrouter',
      model: 'vendor/model-x',
      apiKey: API_KEY,
      pricing: PRICING,
      ...extra,
    },
  });
  expect(response.statusCode, response.body).toBe(200);
}

async function newCampaign(who: Person, variants = 1): Promise<string> {
  const product = await app.inject({
    method: 'POST',
    url: `${base(who)}/products`,
    headers: auth(who),
    payload: { name: 'พัดลมพกพา', sellingPoints: ['เบา เงียบ'], restrictedClaims: [] },
  });
  const templates = (
    await app.inject({ method: 'GET', url: `${base(who)}/templates`, headers: auth(who) })
  ).json() as { items: { id: string; version: number }[] };
  const t = templates.items[0]!;
  const campaign = await app.inject({
    method: 'POST',
    url: `${base(who)}/campaigns`,
    headers: auth(who),
    payload: {
      productId: (product.json() as { id: string }).id,
      templateId: t.id,
      templateVersion: t.version,
      language: 'th',
      platform: 'tiktok',
      variants,
    },
  });
  expect(campaign.statusCode, campaign.body).toBe(201);
  return (campaign.json() as { id: string }).id;
}

async function startGenerate(who: Person, campaignId: string): Promise<string> {
  counter += 1;
  const response = await app.inject({
    method: 'POST',
    url: `${base(who)}/jobs/generate-brief`,
    headers: {
      ...auth(who),
      'idempotency-key': `rp-key-${String(counter)}-${randomBytes(4).toString('hex')}`,
    },
    payload: { campaignId },
  });
  expect(response.statusCode, response.body).toBe(202);
  return (response.json() as { id: string }).id;
}

const job = async (id: string) =>
  (await testDb.pool.query('select * from jobs where id = $1', [id])).rows[0];
const events = async (who: Person) =>
  (
    await testDb.pool.query(
      'select * from usage_events where workspace_id = $1 order by created_at, call_index',
      [who.workspaceId],
    )
  ).rows;
const usage = async (who: Person) =>
  UsageSummarySchema.parse(
    (await app.inject({ method: 'GET', url: `${base(who)}/usage`, headers: auth(who) })).json(),
  );

describe('a workspace with a saved provider', () => {
  it('generates through the real adapter, saves the draft with the provider, and meters the call', async () => {
    const who = await person('ok');
    await saveProvider(who, { monthlyCapUsd: 5 });
    const jobId = await startGenerate(who, await newCampaign(who));
    script = [{ cost: 0.0123 }];
    expect(await processJob(workerDeps(), jobId)).toBe('succeeded');

    expect(requests).toHaveLength(1);
    expect(requests[0]!.url).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect(requests[0]!.headers.authorization).toBe(`Bearer ${API_KEY}`);
    expect(JSON.parse(requests[0]!.body ?? '{}')).toMatchObject({
      model: 'vendor/model-x',
      usage: { include: true },
    });
    const row = await job(jobId);
    expect(row).toMatchObject({ status: 'succeeded', provider: 'openrouter' });
    const drafts = await testDb.pool.query(
      'select sections from content_drafts where workspace_id = $1',
      [who.workspaceId],
    );
    expect(drafts.rows[0].sections.title).toBe(draft.title);

    const [event] = await events(who);
    expect(event).toMatchObject({
      status: 'settled',
      model: 'vendor/model-x',
      input_units: 1000,
      output_units: 500,
      cost_source: 'reported',
      requests: 1,
    });
    expect(Number(event.cost_usd)).toBeCloseTo(0.0123, 6);
    expect(Number(event.reserved_usd)).toBeGreaterThan(Number(event.cost_usd));
    // The worst case includes the estimated input, not only the output limit (2000 tokens at 15 USD per million).
    expect(Number(event.reserved_usd)).toBeGreaterThan(0.03);
    const summary = await usage(who);
    expect(summary).toMatchObject({
      calls: 1,
      inputUnits: 1000,
      outputUnits: 500,
      capUsd: 5,
      anomalies: 0,
    });
    expect(summary.spentUsd).toBeCloseTo(0.0123, 6);
    expect(summary.byModel).toEqual([
      { provider: 'openrouter', model: 'vendor/model-x', calls: 1, costUsd: 0.0123 },
    ]);
  });

  it('computes the cost from the owner prices when the provider reports none, and flags a reported cost far above it', async () => {
    const who = await person('cost');
    await saveProvider(who);
    const one = await startGenerate(who, await newCampaign(who));
    expect(await processJob(workerDeps(), one)).toBe('succeeded');
    const two = await startGenerate(who, await newCampaign(who));
    script = [{ cost: 0.5 }];
    expect(await processJob(workerDeps(), two)).toBe('succeeded');
    const rows = await events(who);
    expect(rows[0]).toMatchObject({ cost_source: 'computed', anomaly: false });
    expect(Number(rows[0].cost_usd)).toBeCloseTo((1000 * 3 + 500 * 15) / 1_000_000, 6);
    expect(rows[1]).toMatchObject({ cost_source: 'reported', anomaly: true });
    expect((await usage(who)).anomalies).toBe(1);
  });

  it('refuses a call that would pass the monthly limit: no provider call, a plain failure, no retry', async () => {
    const who = await person('cap');
    await saveProvider(who, { monthlyCapUsd: 0 });
    const jobId = await startGenerate(who, await newCampaign(who));
    expect(await processJob(workerDeps(), jobId)).toBe('failed');
    expect(requests).toHaveLength(0);
    expect(await job(jobId)).toMatchObject({
      status: 'failed',
      error_code: 'PROVIDER_BUDGET',
      attempts: 1,
    });
    expect(await events(who)).toHaveLength(0);
    // Nothing was saved for the campaign.
    expect(
      (
        await testDb.pool.query(
          'select count(*)::int as n from content_drafts where workspace_id = $1',
          [who.workspaceId],
        )
      ).rows[0].n,
    ).toBe(0);
  });

  it('counts what has been spent: a second call is refused once the first used the room', async () => {
    const who = await person('two');
    // Worst case of one call is about 0.03 USD with these prices; the limit fits one real cost but not a second worst case.
    await saveProvider(who, { monthlyCapUsd: 0.05 });
    const first = await startGenerate(who, await newCampaign(who));
    script = [{ cost: 0.04 }];
    expect(await processJob(workerDeps(), first)).toBe('succeeded');
    const second = await startGenerate(who, await newCampaign(who));
    expect(await processJob(workerDeps(), second)).toBe('failed');
    expect(requests).toHaveLength(1);
    expect(await job(second)).toMatchObject({ error_code: 'PROVIDER_BUDGET' });
    expect((await usage(who)).countedUsd).toBeCloseTo(0.04, 6);
  });

  it('with several variants, stops at the limit and saves nothing from the job', async () => {
    const who = await person('variants');
    await saveProvider(who, { monthlyCapUsd: 0.05 });
    const jobId = await startGenerate(who, await newCampaign(who, 3));
    script = [{ cost: 0.04 }, { cost: 0.04 }, { cost: 0.04 }];
    expect(await processJob(workerDeps(), jobId)).toBe('failed');
    expect(requests).toHaveLength(1);
    expect(await job(jobId)).toMatchObject({ error_code: 'PROVIDER_BUDGET' });
    expect(
      (
        await testDb.pool.query(
          'select count(*)::int as n from content_drafts where workspace_id = $1',
          [who.workspaceId],
        )
      ).rows[0].n,
    ).toBe(0);
    const rows = await events(who);
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('settled');
  });

  it('maps a rejected key and an empty account to their own codes, never retries them, and bills nothing', async () => {
    for (const [status, code] of [
      [401, 'PROVIDER_AUTH'],
      [402, 'PROVIDER_BUDGET'],
    ] as const) {
      const who = await person(`status${String(status)}`);
      await saveProvider(who);
      const jobId = await startGenerate(who, await newCampaign(who));
      script = [{ status }];
      expect(await processJob(workerDeps(), jobId)).toBe('failed');
      expect(await job(jobId)).toMatchObject({ error_code: code, attempts: 1 });
      const [event] = await events(who);
      expect(event).toMatchObject({ status: 'released', requests: 0 });
      expect(Number(event.cost_usd)).toBe(0);
      expect((await usage(who)).spentUsd).toBe(0);
    }
  });

  it('retries a rate limit and a server error, billing neither, then succeeds', async () => {
    const who = await person('retry');
    await saveProvider(who);
    const jobId = await startGenerate(who, await newCampaign(who));
    script = [{ status: 429, headers: { 'retry-after': '1' } }, { status: 503 }, { cost: 0.01 }];
    expect(await processJob(workerDeps(), jobId)).toBe('retried');
    await testDb.pool.query('update jobs set run_after = now() where id = $1', [jobId]);
    expect(await processJob(workerDeps(), jobId)).toBe('retried');
    await testDb.pool.query('update jobs set run_after = now() where id = $1', [jobId]);
    expect(await processJob(workerDeps(), jobId)).toBe('succeeded');
    expect(requests).toHaveLength(3);
    const rows = await events(who);
    expect(rows.map((r) => [r.attempt, r.status])).toEqual([
      [1, 'released'],
      [2, 'released'],
      [3, 'settled'],
    ]);
    const summary = await usage(who);
    expect(summary.calls).toBe(1);
    expect(summary.spentUsd).toBeCloseTo(0.01, 6);
  });

  it('keeps the worst case for a call that may have been billed (bad output, refusal)', async () => {
    const who = await person('billed');
    await saveProvider(who);
    const jobId = await startGenerate(who, await newCampaign(who));
    script = [{ content: 'Sure! Here is a video.' }];
    expect(await processJob(workerDeps(), jobId)).toBe('failed');
    expect(await job(jobId)).toMatchObject({ error_code: 'INVALID_PROVIDER_OUTPUT' });
    const [event] = await events(who);
    expect(event).toMatchObject({ status: 'settled', cost_source: 'reserved' });
    expect(Number(event.cost_usd)).toBeCloseTo(Number(event.reserved_usd), 6);
    expect(Number(event.cost_usd)).toBeGreaterThan(0);
  });

  it('fails with PROVIDER_AUTH, and calls nothing, when the key cannot be opened with the server key', async () => {
    const who = await person('wrongkey');
    await saveProvider(who);
    const jobId = await startGenerate(who, await newCampaign(who));
    const other = parseSecretsKey(randomBytes(32).toString('base64'), 'k1');
    const fallback = new MockTextProvider();
    const deps: WorkerDeps = {
      ...workerDeps(),
      resolveProvider: (j, a) =>
        resolveProvider({ db: testDb.db, fallback, secrets: other, transport, log: quiet }, j, a),
    };
    expect(await processJob(deps, jobId)).toBe('failed');
    expect(requests).toHaveLength(0);
    const row = await job(jobId);
    expect(row.error_code).toBe('PROVIDER_AUTH');
    expect(JSON.stringify(row)).not.toContain(API_KEY);
  });

  it('never puts the key in the job row, the events, the draft or the audit trail', async () => {
    const who = await person('leak');
    await saveProvider(who);
    const jobId = await startGenerate(who, await newCampaign(who));
    script = [{ cost: 0.01 }];
    await processJob(workerDeps(), jobId);
    const dump = JSON.stringify([
      (await testDb.pool.query('select * from jobs where workspace_id = $1', [who.workspaceId]))
        .rows,
      await events(who),
      (
        await testDb.pool.query('select * from content_drafts where workspace_id = $1', [
          who.workspaceId,
        ])
      ).rows,
      (
        await testDb.pool.query('select * from audit_events where workspace_id = $1', [
          who.workspaceId,
        ])
      ).rows,
    ]);
    expect(dump).not.toContain(API_KEY);
    expect(dump).not.toContain('LIVEKEY');
  });
});

describe('a workspace without a saved provider', () => {
  it('uses the built-in writer, calls no network, and records no usage', async () => {
    const who = await person('mock');
    const jobId = await startGenerate(who, await newCampaign(who));
    expect(await processJob(workerDeps(), jobId)).toBe('succeeded');
    expect(requests).toHaveLength(0);
    expect(await job(jobId)).toMatchObject({ provider: 'mock-text' });
    expect(await events(who)).toHaveLength(0);
  });

  it("is not affected by another workspace's provider or spending", async () => {
    const rich = await person('rich');
    const plain = await person('plain');
    await saveProvider(rich, { monthlyCapUsd: 0 });
    const jobId = await startGenerate(plain, await newCampaign(plain));
    expect(await processJob(workerDeps(), jobId)).toBe('succeeded');
    expect(await job(jobId)).toMatchObject({ provider: 'mock-text' });
  });
});

describe('the usage ledger', () => {
  it('lets many workers reserve at the same moment without passing the limit', async () => {
    const who = await person('race');
    const campaign = await newCampaign(who);
    const jobs: string[] = [];
    for (let i = 0; i < 24; i += 1) {
      const made = await testDb.pool.query<{ id: string }>(
        `insert into jobs (workspace_id, type, input, created_by, idempotency_key, request_hash, campaign_id)
         values ($1, 'generate_brief', '{}'::jsonb, $2, $3, repeat('d', 64), $4) returning id`,
        [
          who.workspaceId,
          who.userId,
          `race-${String(i)}-${randomBytes(4).toString('hex')}`,
          campaign,
        ],
      );
      jobs.push(made.rows[0]!.id);
    }
    const results = await Promise.all(
      jobs.map((jobId) =>
        reserveCall(testDb.db, {
          workspaceId: who.workspaceId,
          jobId,
          attempt: 1,
          callIndex: 1,
          provider: 'p',
          model: 'm',
          reservedUsd: 0.4,
          capUsd: 1,
        }),
      ),
    );
    expect(results.filter((r) => r.ok)).toHaveLength(2);
    expect(results.filter((r) => !r.ok && r.reason === 'over_cap')).toHaveLength(22);
  });

  it('waits for the workspace lock before it counts, so a held lock holds every reservation back', async () => {
    const who = await person('lock');
    const jobId = await startGenerate(who, await newCampaign(who));
    const holder = await testDb.pool.connect();
    try {
      await holder.query('begin');
      await holder.query('select pg_advisory_xact_lock(hashtextextended($1, $2))', [
        who.workspaceId,
        RESERVE_LOCK_SEED,
      ]);
      let done = false;
      const pending = reserveCall(testDb.db, {
        workspaceId: who.workspaceId,
        jobId,
        attempt: 1,
        callIndex: 1,
        provider: 'p',
        model: 'm',
        reservedUsd: 0.1,
        capUsd: 1,
      }).then((result) => {
        done = true;
        return result;
      });
      await new Promise((resolve) => setTimeout(resolve, 400));
      expect(done).toBe(false);
      await holder.query('commit');
      expect((await pending).ok).toBe(true);
    } finally {
      holder.release();
    }
  });

  it("does not count last month against this month's limit", async () => {
    const who = await person('lastmonth');
    const jobId = await startGenerate(who, await newCampaign(who));
    await testDb.pool.query(
      `insert into usage_events (workspace_id, job_id, attempt, call_index, provider, model, status, reserved_usd, cost_usd, settled_at, created_at)
       values ($1, $2, 9, 9, 'p', 'm', 'settled', 50, 50, now(), now() - interval '40 days')`,
      [who.workspaceId, jobId],
    );
    const result = await reserveCall(testDb.db, {
      workspaceId: who.workspaceId,
      jobId,
      attempt: 1,
      callIndex: 1,
      provider: 'p',
      model: 'm',
      reservedUsd: 0.4,
      capUsd: 1,
    });
    expect(result.ok).toBe(true);
  });

  it('refuses the same call twice, and counts only this calendar month', async () => {
    const who = await person('month');
    const [jobId] = [await startGenerate(who, await newCampaign(who))];
    const input = {
      workspaceId: who.workspaceId,
      jobId: jobId!,
      attempt: 1,
      callIndex: 1,
      provider: 'p',
      model: 'm',
      reservedUsd: 0.1,
      capUsd: null,
    };
    expect((await reserveCall(testDb.db, input)).ok).toBe(true);
    expect(await reserveCall(testDb.db, input)).toEqual({ ok: false, reason: 'duplicate' });
    // An old settled event does not count against this month.
    await testDb.pool.query(
      `insert into usage_events (workspace_id, job_id, attempt, call_index, provider, model, status, reserved_usd, cost_usd, settled_at, created_at)
       values ($1, $2, 9, 9, 'p', 'm', 'settled', 50, 50, now(), now() - interval '40 days')`,
      [who.workspaceId, jobId],
    );
    const summary = await usage(who);
    expect(summary.spentUsd).toBe(0);
    expect(summary.reservedUsd).toBeCloseTo(0.1, 6);
    expect(summary.countedUsd).toBeCloseTo(0.1, 6);
  });
});

describe('usage route', () => {
  it('is readable by every member, 404 for a stranger and 401 without a token', async () => {
    const owner = await person('route');
    const stranger = await person('stranger');
    const viewer = await person('viewer');
    await testDb.pool.query(
      'insert into workspace_members (workspace_id, user_id, role) values ($1, $2, $3)',
      [owner.workspaceId, viewer.userId, 'viewer'],
    );
    const get = (who: Person | null, workspace: Person) =>
      app.inject({ method: 'GET', url: `${base(workspace)}/usage`, headers: who ? auth(who) : {} });
    expect((await get(viewer, owner)).statusCode).toBe(200);
    expect((await get(stranger, owner)).statusCode).toBe(404);
    expect((await get(null, owner)).statusCode).toBe(401);
    expect(UsageSummarySchema.parse((await get(owner, owner)).json())).toMatchObject({
      calls: 0,
      capUsd: null,
      byModel: [],
    });
  });
});
