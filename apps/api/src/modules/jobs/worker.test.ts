import {
  MockTextProvider,
  ProviderError,
  type DraftSections,
  type GenerateBriefRequest,
  type ProviderCallOptions,
  type TextProvider,
} from '@creatorops/provider-core';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { schema } from '../../db/client.js';
import { requireDatabaseUrl, SECRET_FOR_TESTS } from '../../test/db-url.js';
import { RecordingJobQueue } from '../../test/job-queue.js';
import { createPerson, type Person } from '../../test/people.js';
import { createTestDb, type TestDb } from '../../test/test-db.js';
import {
  DEFAULT_WORKER_SETTINGS,
  jobTimeoutMs,
  processJob,
  type WorkerDeps,
  type WorkerLog,
} from './process.js';
import { reconcile } from './reconcile.js';

let testDb: TestDb;
let alice: Person;
let queue: RecordingJobQueue;
let records: Record<string, unknown>[];
let counter = 0;

const log: WorkerLog = {
  info: (object, message) => void records.push({ level: 'info', ...object, message }),
  warn: (object, message) => void records.push({ level: 'warn', ...object, message }),
  error: (object, message) => void records.push({ level: 'error', ...object, message }),
};

beforeAll(async () => {
  testDb = await createTestDb(requireDatabaseUrl());
  alice = await createPerson(testDb.db, SECRET_FOR_TESTS, 'worker-alice');
});

afterAll(async () => {
  await testDb.drop();
});

beforeEach(async () => {
  queue = new RecordingJobQueue();
  records = [];
  // The reconciler looks at every job in the database, so each test starts with none.
  await testDb.pool.query('delete from jobs');
});

const SECTIONS: DraftSections = {
  title: 'พัดลมพกพา',
  hook: 'ลมแรงในกระเป๋า',
  script: 'พัดลมตัวเล็กใช้ได้ทุกที่',
  storyboard: ['ฉากที่ 1', 'ฉากที่ 2'],
  caption: 'พัดลมพกพา ใช้ง่าย',
  hashtags: ['#พัดลม'],
  callToAction: 'สั่งซื้อได้เลย',
};

/** A provider whose behaviour each test scripts. */
class ScriptedProvider implements TextProvider {
  readonly id = 'scripted';
  calls = 0;
  constructor(
    private readonly script: (
      request: GenerateBriefRequest,
      options: ProviderCallOptions,
      call: number,
    ) => Promise<DraftSections> | DraftSections = () => SECTIONS,
  ) {}
  async generateBrief(request: GenerateBriefRequest, options: ProviderCallOptions = {}) {
    this.calls += 1;
    const output = await this.script(request, options, this.calls);
    return { output, usage: { inputUnits: 1, outputUnits: 1 }, model: 'scripted-1' };
  }
  regenerateSection(): never {
    throw new Error('not used');
  }
  generateVideoPrompts(): never {
    throw new Error('not used');
  }
}

/** Rejects when the signal aborts, the way a real HTTP adapter would. */
function untilAborted(options: ProviderCallOptions): Promise<never> {
  return new Promise((_resolve, reject) => {
    const signal = options.signal;
    if (signal === undefined) return;
    const fail = () =>
      reject(signal.reason instanceof Error ? signal.reason : new Error('aborted'));
    if (signal.aborted) fail();
    else signal.addEventListener('abort', fail, { once: true });
  });
}

function deps(provider: TextProvider, overrides: Partial<WorkerDeps> = {}): WorkerDeps {
  return { db: testDb.db, provider, queue, log, random: () => 0, ...overrides };
}

interface SeedOptions {
  readonly productName?: string;
  readonly variants?: number;
  readonly sellingPoints?: string[];
  readonly restrictedClaims?: string[];
  readonly status?: 'queued' | 'running';
  readonly attempts?: number;
  readonly maxAttempts?: number;
  readonly input?: Record<string, unknown>;
  readonly campaignStatus?: 'draft' | 'archived';
}

async function seed(options: SeedOptions = {}) {
  const n = (counter += 1);
  const [product] = await testDb.db
    .insert(schema.products)
    .values({
      workspaceId: alice.workspaceId,
      name: options.productName ?? `Fan ${n}`,
      sellingPoints: options.sellingPoints ?? ['เบา', 'ชาร์จ USB'],
      restrictedClaims: options.restrictedClaims ?? [],
    })
    .returning();
  if (product === undefined) throw new Error('no product');
  const variants = options.variants ?? 2;
  const [campaign] = await testDb.db
    .insert(schema.campaigns)
    .values({
      workspaceId: alice.workspaceId,
      productId: product.id,
      name: `Campaign ${n}`,
      templateId: 'product-showcase',
      templateVersion: 1,
      language: 'th',
      tone: null,
      platform: 'tiktok',
      durationSeconds: 30,
      variants,
      status: options.campaignStatus ?? 'draft',
      createdBy: alice.userId,
    })
    .returning();
  if (campaign === undefined) throw new Error('no campaign');
  const status = options.status ?? 'queued';
  const [job] = await testDb.db
    .insert(schema.jobs)
    .values({
      workspaceId: alice.workspaceId,
      type: 'generate_brief',
      status,
      input: options.input ?? {
        campaignId: campaign.id,
        productId: product.id,
        templateId: 'product-showcase',
        templateVersion: 1,
        language: 'th',
        tone: null,
        platform: 'tiktok',
        durationSeconds: 30,
        variants,
      },
      createdBy: alice.userId,
      idempotencyKey: `seed-key-${n}-abcdefgh`,
      requestHash: 'a'.repeat(64),
      campaignId: campaign.id,
      attempts: options.attempts ?? (status === 'running' ? 1 : 0),
      maxAttempts: options.maxAttempts ?? 3,
      ...(status === 'running' ? { lockedUntil: new Date(Date.now() + 60_000) } : {}),
    })
    .returning();
  if (job === undefined) throw new Error('no job');
  return { job, campaign, product };
}

async function getJob(jobId: string) {
  const [row] = await testDb.db.select().from(schema.jobs).where(eq(schema.jobs.id, jobId));
  if (row === undefined) throw new Error('job vanished');
  return row;
}

async function draftsOf(campaignId: string) {
  return testDb.db
    .select()
    .from(schema.contentDrafts)
    .where(eq(schema.contentDrafts.campaignId, campaignId))
    .orderBy(schema.contentDrafts.variantIndex);
}

const sql = (text: string, values: unknown[] = []) => testDb.pool.query(text, values);

describe('processJob: a successful run', () => {
  it('stores one draft per variant and finishes the job in one step', async () => {
    const { job, campaign, product } = await seed({ variants: 2 });
    const provider = new ScriptedProvider();
    expect(await processJob(deps(provider), job.id)).toBe('succeeded');

    const row = await getJob(job.id);
    expect(row).toMatchObject({
      status: 'succeeded',
      attempts: 1,
      provider: 'scripted',
      errorCode: null,
      errorMessage: null,
      lockedUntil: null,
    });
    expect(row.startedAt).not.toBeNull();
    expect(row.finishedAt).not.toBeNull();

    const drafts = await draftsOf(campaign.id);
    expect(drafts.map((draft) => draft.variantIndex)).toEqual([0, 1]);
    expect(row.output).toEqual({ draftIds: drafts.map((draft) => draft.id), model: 'scripted-1' });
    for (const draft of drafts) {
      expect(draft).toMatchObject({
        workspaceId: alice.workspaceId,
        campaignId: campaign.id,
        productId: product.id,
        status: 'draft',
        version: 1,
      });
      expect(draft.sections).toEqual(SECTIONS);
      expect(draft.sectionState).toEqual(
        Object.fromEntries(
          Object.keys(SECTIONS).map((name) => [
            name,
            { rev: 1, origin: 'generated', jobId: job.id },
          ]),
        ),
      );
    }
    expect(provider.calls).toBe(2);
  });

  it('works with the real mock provider and produces Thai copy', async () => {
    const { job, campaign } = await seed({ variants: 3, productName: 'แก้วเก็บความเย็น' });
    expect(await processJob(deps(new MockTextProvider()), job.id)).toBe('succeeded');
    const drafts = await draftsOf(campaign.id);
    expect(drafts).toHaveLength(3);
    expect(await getJob(job.id)).toMatchObject({ provider: 'mock-text' });
    expect(JSON.stringify(drafts[0]?.sections)).toMatch(/[฀-๿]/u);
  });

  it('passes the product facts and the campaign snapshot to the provider', async () => {
    const { job, product } = await seed({ variants: 1, sellingPoints: ['เบา'] });
    const seen: GenerateBriefRequest[] = [];
    await processJob(
      deps(
        new ScriptedProvider((request) => {
          seen.push(request);
          return SECTIONS;
        }),
      ),
      job.id,
    );
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({
      template: { id: 'product-showcase', version: 1 },
      language: 'th',
      platform: 'tiktok',
      durationSeconds: 30,
      variantIndex: 0,
      product: { name: product.name, sellingPoints: ['เบา'], restrictedClaims: [] },
    });
  });

  it('runs the claim guard: a restricted claim marks the draft for review', async () => {
    const { job, campaign } = await seed({ variants: 1, restrictedClaims: ['พัดลมตัวเล็ก'] });
    await processJob(deps(new ScriptedProvider()), job.id);
    const [draft] = await draftsOf(campaign.id);
    expect(draft?.needsReview).toBe(true);
    expect(draft?.claimWarnings).toContainEqual({
      section: 'script',
      kind: 'restricted_claim',
      text: 'พัดลมตัวเล็ก',
    });
  });

  it('validates provider output again: a bad draft is a permanent failure', async () => {
    const { job, campaign } = await seed({ variants: 1 });
    const outcome = await processJob(
      deps(new ScriptedProvider(() => ({ ...SECTIONS, title: '' }))),
      job.id,
    );
    expect(outcome).toBe('failed');
    expect(await getJob(job.id)).toMatchObject({
      status: 'failed',
      errorCode: 'INVALID_PROVIDER_OUTPUT',
      attempts: 1,
    });
    expect(await draftsOf(campaign.id)).toHaveLength(0);
  });
});

describe('processJob: claiming (a duplicate message never runs twice)', () => {
  it('lets only one of two simultaneous calls run the job', async () => {
    const { job, campaign } = await seed({ variants: 2 });
    const provider = new ScriptedProvider(async () => {
      await new Promise((resolve) => setTimeout(resolve, 100));
      return SECTIONS;
    });
    const outcomes = await Promise.all([
      processJob(deps(provider), job.id),
      processJob(deps(provider), job.id),
      processJob(deps(provider), job.id),
    ]);
    expect(outcomes.filter((outcome) => outcome === 'succeeded')).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome === 'skipped')).toHaveLength(2);
    expect(provider.calls).toBe(2); // two variants, one run
    expect(await draftsOf(campaign.id)).toHaveLength(2);
    expect((await getJob(job.id)).attempts).toBe(1);
  });

  it.each(['succeeded', 'failed', 'cancelled'] as const)(
    'does nothing for a job that is already %s',
    async (finished) => {
      const { job } = await seed();
      await sql(
        `update jobs set status = $2, finished_at = now(),
           output = case when $2 = 'succeeded' then '{}'::jsonb end,
           error_code = case when $2 = 'succeeded' then null when $2 = 'failed' then 'INTERNAL' else 'CANCELLED' end,
           error_message = case when $2 = 'succeeded' then null else 'x' end
         where id = $1`,
        [job.id, finished],
      );
      const provider = new ScriptedProvider();
      expect(await processJob(deps(provider), job.id)).toBe('skipped');
      expect(provider.calls).toBe(0);
      expect((await getJob(job.id)).status).toBe(finished);
    },
  );

  it('does nothing for a job that is running', async () => {
    const { job } = await seed({ status: 'running' });
    const provider = new ScriptedProvider();
    expect(await processJob(deps(provider), job.id)).toBe('skipped');
    expect(provider.calls).toBe(0);
    expect((await getJob(job.id)).attempts).toBe(1);
  });

  it('does nothing for a job that is not due yet', async () => {
    const { job } = await seed();
    await sql("update jobs set run_after = now() + interval '1 hour' where id = $1", [job.id]);
    const provider = new ScriptedProvider();
    expect(await processJob(deps(provider), job.id)).toBe('skipped');
    expect(provider.calls).toBe(0);
    expect(await getJob(job.id)).toMatchObject({ status: 'queued', attempts: 0 });
  });

  it('does nothing for a queued job that used every attempt', async () => {
    const { job } = await seed({ attempts: 3, maxAttempts: 3 });
    expect(await processJob(deps(new ScriptedProvider()), job.id)).toBe('skipped');
    expect((await getJob(job.id)).attempts).toBe(3);
  });

  it('ignores an id that is not a job', async () => {
    expect(await processJob(deps(new ScriptedProvider()), crypto.randomUUID())).toBe('skipped');
  });
});

describe('processJob: retries (D-048)', () => {
  it('puts a transient failure back in the queue with a delay and hands it over for attempt 2', async () => {
    const { job, campaign } = await seed();
    const outcome = await processJob(
      deps(new ScriptedProvider(() => Promise.reject(new ProviderError('UPSTREAM_5XX')))),
      job.id,
    );
    expect(outcome).toBe('retried');

    const row = await getJob(job.id);
    expect(row).toMatchObject({
      status: 'queued',
      attempts: 1,
      errorCode: null,
      errorMessage: null,
      lockedUntil: null,
      finishedAt: null,
    });
    const waitMs = row.runAfter.getTime() - Date.now();
    expect(waitMs).toBeGreaterThan(500);
    expect(waitMs).toBeLessThanOrEqual(2_100);
    expect(queue.enqueued).toEqual([{ jobId: job.id, delayMs: 2_000, attempt: 2 }]);
    expect(await draftsOf(campaign.id)).toHaveLength(0);
  });

  it('succeeds on the second attempt without duplicating drafts', async () => {
    const { job, campaign } = await seed({ variants: 2 });
    const provider = new ScriptedProvider((_request, _options, call) => {
      if (call === 2) return Promise.reject(new ProviderError('TIMEOUT')); // 1st attempt, 2nd variant
      return SECTIONS;
    });
    expect(await processJob(deps(provider), job.id)).toBe('retried');
    expect(await draftsOf(campaign.id)).toHaveLength(0); // nothing stored from the failed attempt

    await sql('update jobs set run_after = now() where id = $1', [job.id]);
    expect(await processJob(deps(provider), job.id)).toBe('succeeded');
    expect(await getJob(job.id)).toMatchObject({ status: 'succeeded', attempts: 2 });
    expect(await draftsOf(campaign.id)).toHaveLength(2);
    expect(queue.enqueued.map((entry) => entry.attempt)).toEqual([2]);
  });

  it('fails for good on the third failed attempt, with a stable code and a fixed message', async () => {
    const { job } = await seed();
    const provider = new ScriptedProvider(() => Promise.reject(new ProviderError('UPSTREAM_5XX')));
    const outcomes: string[] = [];
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      await sql('update jobs set run_after = now() where id = $1', [job.id]);
      outcomes.push(await processJob(deps(provider), job.id));
    }
    expect(outcomes).toEqual(['retried', 'retried', 'failed']);
    const row = await getJob(job.id);
    expect(row).toMatchObject({
      status: 'failed',
      attempts: 3,
      errorCode: 'PROVIDER_UNAVAILABLE',
      errorMessage: 'The text provider is unavailable right now.',
    });
    expect(row.finishedAt).not.toBeNull();
    expect(queue.enqueued.map((entry) => [entry.attempt, entry.delayMs])).toEqual([
      [2, 2_000],
      [3, 10_000],
    ]);
    expect(provider.calls).toBe(3); // the first call of each attempt fails
  });

  it('never runs a fourth attempt', async () => {
    const { job } = await seed();
    const provider = new ScriptedProvider(() => Promise.reject(new ProviderError('TIMEOUT')));
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      await sql('update jobs set run_after = now() where id = $1', [job.id]);
      await processJob(deps(provider), job.id);
    }
    const calls = provider.calls;
    expect(await processJob(deps(provider), job.id)).toBe('skipped');
    expect(provider.calls).toBe(calls);
  });

  it('honours a lower limit on the job row', async () => {
    const { job } = await seed({ maxAttempts: 1 });
    const outcome = await processJob(
      deps(new ScriptedProvider(() => Promise.reject(new ProviderError('UPSTREAM_5XX')))),
      job.id,
    );
    expect(outcome).toBe('failed');
    expect(await getJob(job.id)).toMatchObject({ status: 'failed', attempts: 1 });
    expect(queue.enqueued).toEqual([]);
  });

  it('waits at least as long as a rate limit asked', async () => {
    const { job } = await seed();
    await processJob(
      deps(
        new ScriptedProvider(() =>
          Promise.reject(new ProviderError('RATE_LIMITED', { retryAfterMs: 20_000 })),
        ),
      ),
      job.id,
    );
    expect(queue.enqueued[0]?.delayMs).toBe(20_000);
    const row = await getJob(job.id);
    expect(row.runAfter.getTime() - Date.now()).toBeGreaterThan(18_000);
  });

  it('keeps the retry in the database when the queue is down', async () => {
    const { job } = await seed();
    queue.failWith = new Error('redis down');
    const outcome = await processJob(
      deps(new ScriptedProvider(() => Promise.reject(new ProviderError('TIMEOUT')))),
      job.id,
    );
    expect(outcome).toBe('retried');
    expect((await getJob(job.id)).status).toBe('queued');
    expect(records.some((record) => record.event === 'job.enqueue_failed')).toBe(true);
  });

  it('retries the mock provider failure markers and fails the permanent ones', async () => {
    const transient = await seed({ productName: 'Fan [[mock:5xx]]', variants: 1 });
    expect(await processJob(deps(new MockTextProvider()), transient.job.id)).toBe('retried');

    const invalid = await seed({ productName: 'Fan [[mock:invalid-output]]', variants: 1 });
    expect(await processJob(deps(new MockTextProvider()), invalid.job.id)).toBe('failed');
    expect(await getJob(invalid.job.id)).toMatchObject({ errorCode: 'INVALID_PROVIDER_OUTPUT' });

    const refused = await seed({ productName: 'Fan [[mock:refused]]', variants: 1 });
    expect(await processJob(deps(new MockTextProvider()), refused.job.id)).toBe('failed');
    expect(await getJob(refused.job.id)).toMatchObject({
      errorCode: 'CONTENT_REFUSED',
      attempts: 1,
    });
  });
});

describe('processJob: permanent failures end at once', () => {
  it.each([
    [new ProviderError('INVALID_OUTPUT'), 'INVALID_PROVIDER_OUTPUT'],
    [new ProviderError('CONTENT_REFUSED'), 'CONTENT_REFUSED'],
    [new ProviderError('INVALID_REQUEST'), 'INTERNAL'],
    [new ProviderError('AUTH_FAILED'), 'PROVIDER_AUTH'],
    [new ProviderError('BUDGET_EXCEEDED'), 'PROVIDER_BUDGET'],
    [new Error('db password=hunter2 leaked'), 'INTERNAL'],
  ])('%s becomes %s on the first attempt', async (error, code) => {
    const { job } = await seed();
    const outcome = await processJob(
      deps(new ScriptedProvider(() => Promise.reject(error))),
      job.id,
    );
    expect(outcome).toBe('failed');
    const row = await getJob(job.id);
    expect(row).toMatchObject({ status: 'failed', attempts: 1, errorCode: code });
    expect(row.errorMessage).not.toContain('hunter2');
    expect(queue.enqueued).toEqual([]);
    expect(JSON.stringify(records)).not.toContain('hunter2');
  });

  it('fails a job whose settings snapshot is not valid', async () => {
    const { job } = await seed({ input: { campaignId: 'x' } });
    expect(await processJob(deps(new ScriptedProvider()), job.id)).toBe('failed');
    expect(await getJob(job.id)).toMatchObject({
      errorCode: 'INTERNAL',
      errorMessage: 'The job settings are not valid.',
    });
  });

  it('fails a job whose campaign was archived after it was queued', async () => {
    const { job } = await seed({ campaignStatus: 'archived' });
    const provider = new ScriptedProvider();
    expect(await processJob(deps(provider), job.id)).toBe('failed');
    expect(await getJob(job.id)).toMatchObject({
      errorCode: 'INTERNAL',
      errorMessage: 'The campaign is no longer available.',
    });
    expect(provider.calls).toBe(0);
  });

  it('fails a job whose product was archived after it was queued', async () => {
    const { job, product } = await seed();
    await sql("update products set status = 'archived', archived_at = now() where id = $1", [
      product.id,
    ]);
    expect(await processJob(deps(new ScriptedProvider()), job.id)).toBe('failed');
    expect((await getJob(job.id)).errorMessage).toBe('The product is no longer available.');
  });
});

describe('jobTimeoutMs', () => {
  const settings = { ...DEFAULT_WORKER_SETTINGS, providerTimeoutMs: 100 };
  it('gives a generate job one call limit per variant, at most three', () => {
    expect(jobTimeoutMs({ type: 'generate_brief', input: { variants: 1 } }, settings)).toBe(100);
    expect(jobTimeoutMs({ type: 'generate_brief', input: { variants: 3 } }, settings)).toBe(300);
    expect(jobTimeoutMs({ type: 'generate_brief', input: { variants: 99 } }, settings)).toBe(300);
    expect(jobTimeoutMs({ type: 'generate_brief', input: {} }, settings)).toBe(300);
    expect(jobTimeoutMs({ type: 'generate_brief', input: null }, settings)).toBe(300);
  });
  it('leaves other job types at one call limit', () => {
    expect(jobTimeoutMs({ type: 'regenerate_section', input: {} }, settings)).toBe(100);
    expect(jobTimeoutMs({ type: 'export_package', input: {} }, settings)).toBe(100);
  });
});

describe('processJob: time limit', () => {
  it('lets three slow-but-healthy variants finish inside the per-call limit times three', async () => {
    const { job } = await seed({ variants: 3 });
    const outcome = await processJob(
      deps(
        new ScriptedProvider(async () => {
          await new Promise((done) => setTimeout(done, 40));
          return SECTIONS;
        }),
        { settings: { providerTimeoutMs: 50 } },
      ),
      job.id,
    );
    expect(outcome).toBe('succeeded');
  });

  it('turns a slow provider call into a timeout and retries it', async () => {
    const { job } = await seed();
    const outcome = await processJob(
      deps(new ScriptedProvider((_request, options) => untilAborted(options)), {
        settings: { providerTimeoutMs: 50 },
      }),
      job.id,
    );
    expect(outcome).toBe('retried');
    expect(records.find((record) => record.event === 'job.attempt_failed')).toMatchObject({
      code: 'PROVIDER_TIMEOUT',
      retry: true,
    });
  });

  it('ends as PROVIDER_TIMEOUT when no attempts are left', async () => {
    const { job } = await seed({ maxAttempts: 1 });
    await processJob(
      deps(new ScriptedProvider((_request, options) => untilAborted(options)), {
        settings: { providerTimeoutMs: 50 },
      }),
      job.id,
    );
    expect(await getJob(job.id)).toMatchObject({
      status: 'failed',
      errorCode: 'PROVIDER_TIMEOUT',
    });
  });
});

describe('processJob: lease and heartbeat', () => {
  it('takes a lease at the start and renews it while the job runs', async () => {
    const { job } = await seed({ variants: 1 });
    let first: Date | null = null;
    let second: Date | null = null;
    const provider = new ScriptedProvider(async () => {
      first = (await getJob(job.id)).lockedUntil;
      await new Promise((resolve) => setTimeout(resolve, 400));
      second = (await getJob(job.id)).lockedUntil;
      return SECTIONS;
    });
    const outcome = await processJob(
      deps(provider, { settings: { leaseSeconds: 5, heartbeatMs: 50 } }),
      job.id,
    );
    expect(outcome).toBe('succeeded');
    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    expect((second as unknown as Date).getTime()).toBeGreaterThan(
      (first as unknown as Date).getTime(),
    );
    expect((await getJob(job.id)).lockedUntil).toBeNull();
  });

  it('measures the lease on the database clock', async () => {
    const { job } = await seed({ variants: 1 });
    let lease: Date | null = null;
    await processJob(
      deps(
        new ScriptedProvider(async () => {
          lease = (await getJob(job.id)).lockedUntil;
          return SECTIONS;
        }),
        { settings: { leaseSeconds: 90 } },
      ),
      job.id,
    );
    const dbNow = await sql('select extract(epoch from now()) * 1000 as ms');
    const lag = Number((dbNow.rows[0] as { ms: string }).ms) - (lease as unknown as Date).getTime();
    expect(lag).toBeGreaterThan(-91_000);
    expect(lag).toBeLessThan(-85_000);
  });

  it('stops and writes nothing when the lease is taken over mid-run (heartbeat)', async () => {
    const { job, campaign } = await seed({ variants: 1 });
    const provider = new ScriptedProvider(async (_request, options) => {
      // Simulates the reconciler giving the job back to the queue.
      await sql(
        "update jobs set status = 'queued', locked_until = null, run_after = now() where id = $1",
        [job.id],
      );
      return untilAborted(options);
    });
    const outcome = await processJob(deps(provider, { settings: { heartbeatMs: 30 } }), job.id);
    expect(outcome).toBe('lost');
    expect(await getJob(job.id)).toMatchObject({ status: 'queued', attempts: 1 });
    expect(await draftsOf(campaign.id)).toHaveLength(0);
  });

  it("stops, and leaves the new owner's lease alone, when a newer attempt holds the job (heartbeat)", async () => {
    const { job, campaign } = await seed({ variants: 1 });
    const provider = new ScriptedProvider(async (_request, options) => {
      // Attempt 1 lost its lease; the job was requeued and attempt 2 now holds it.
      await sql(
        "update jobs set attempts = 2, locked_until = now() + interval '10 minutes' where id = $1",
        [job.id],
      );
      return untilAborted(options);
    });
    const before = Date.now();
    const outcome = await processJob(deps(provider, { settings: { heartbeatMs: 30 } }), job.id);
    expect(outcome).toBe('lost');
    expect(Date.now() - before).toBeLessThan(3_000);
    const row = await getJob(job.id);
    expect(row).toMatchObject({ status: 'running', attempts: 2 });
    // A heartbeat from attempt 1 must not rewrite attempt 2's lease (10 minutes, not its own 60 s).
    expect((row.lockedUntil?.getTime() ?? 0) - Date.now()).toBeGreaterThan(300_000);
    expect(await draftsOf(campaign.id)).toHaveLength(0);
  });

  it('writes nothing when the provider finishes after the lease was taken over', async () => {
    const { job, campaign } = await seed({ variants: 1 });
    const provider = new ScriptedProvider(async () => {
      await sql(
        "update jobs set status = 'queued', locked_until = null, run_after = now() where id = $1",
        [job.id],
      );
      return SECTIONS;
    });
    expect(await processJob(deps(provider), job.id)).toBe('lost');
    expect(await getJob(job.id)).toMatchObject({ status: 'queued', output: null });
    expect(await draftsOf(campaign.id)).toHaveLength(0);
  });

  it('does not let an old attempt overwrite a newer one', async () => {
    const { job, campaign } = await seed({ variants: 1 });
    const provider = new ScriptedProvider(async () => {
      // The job is requeued and claimed again (attempt 2) while attempt 1 is still working.
      await sql("update jobs set status = 'queued', locked_until = null where id = $1", [job.id]);
      await sql(
        "update jobs set status = 'running', attempts = 2, locked_until = now() + interval '1 minute' where id = $1",
        [job.id],
      );
      return SECTIONS;
    });
    expect(await processJob(deps(provider), job.id)).toBe('lost');
    expect(await getJob(job.id)).toMatchObject({ status: 'running', attempts: 2, output: null });
    expect(await draftsOf(campaign.id)).toHaveLength(0);
  });

  it('does not let an old attempt fail or retry a job it no longer owns', async () => {
    const { job } = await seed({ variants: 1 });
    const provider = new ScriptedProvider(async () => {
      await sql(
        "update jobs set status = 'queued', locked_until = null, attempts = 1 where id = $1",
        [job.id],
      );
      await sql(
        "update jobs set status = 'running', attempts = 2, locked_until = now() + interval '1 minute' where id = $1",
        [job.id],
      );
      return Promise.reject(new ProviderError('CONTENT_REFUSED'));
    });
    expect(await processJob(deps(provider), job.id)).toBe('lost');
    expect(await getJob(job.id)).toMatchObject({ status: 'running', attempts: 2, errorCode: null });
  });
});

describe('processJob: cancelling a running job', () => {
  it('stops at the next heartbeat and stores nothing', async () => {
    const { job, campaign } = await seed({ variants: 2 });
    const provider = new ScriptedProvider(async (_request, options) => {
      await sql('update jobs set cancel_requested_at = now() where id = $1', [job.id]);
      return untilAborted(options);
    });
    const outcome = await processJob(deps(provider, { settings: { heartbeatMs: 30 } }), job.id);
    expect(outcome).toBe('cancelled');
    expect(await getJob(job.id)).toMatchObject({
      status: 'cancelled',
      errorCode: 'CANCELLED',
      lockedUntil: null,
    });
    expect((await getJob(job.id)).finishedAt).not.toBeNull();
    expect(await draftsOf(campaign.id)).toHaveLength(0);
    expect(queue.enqueued).toEqual([]);
  });

  it('wins over a result that arrives after the request (the heartbeat never saw it)', async () => {
    const { job, campaign } = await seed({ variants: 1 });
    const provider = new ScriptedProvider(async () => {
      await sql('update jobs set cancel_requested_at = now() where id = $1', [job.id]);
      return SECTIONS; // finishes before any heartbeat
    });
    expect(await processJob(deps(provider), job.id)).toBe('cancelled');
    expect(await getJob(job.id)).toMatchObject({ status: 'cancelled', output: null });
    expect(await draftsOf(campaign.id)).toHaveLength(0);
  });

  it('wins over a retry: a cancelled job is not queued again', async () => {
    const { job } = await seed({ variants: 1 });
    const provider = new ScriptedProvider(async () => {
      await sql('update jobs set cancel_requested_at = now() where id = $1', [job.id]);
      return Promise.reject(new ProviderError('UPSTREAM_5XX'));
    });
    expect(await processJob(deps(provider), job.id)).toBe('cancelled');
    expect((await getJob(job.id)).status).toBe('cancelled');
    expect(queue.enqueued).toEqual([]);
  });
});

describe('processJob: logging', () => {
  it('logs ids and outcomes only, never product text', async () => {
    const { job } = await seed({ productName: 'SECRET-PRODUCT-NAME', variants: 1 });
    await processJob(deps(new MockTextProvider()), job.id);
    const events = records.map((record) => record.event);
    expect(events).toEqual(['job.started', 'job.finished']);
    expect(records[1]).toMatchObject({ jobId: job.id, outcome: 'succeeded', attempt: 1 });
    const text = JSON.stringify(records);
    expect(text).not.toContain('SECRET-PRODUCT-NAME');
    expect(text).not.toContain('พัดลม');
  });
});

describe('reconcile', () => {
  async function expire(jobId: string): Promise<void> {
    await sql("update jobs set locked_until = now() - interval '5 seconds' where id = $1", [jobId]);
  }

  it('puts a running job whose lease ran out back in the queue and offers it as the next attempt', async () => {
    const { job } = await seed({ status: 'running', attempts: 1 });
    await expire(job.id);
    const summary = await reconcile({ db: testDb.db, queue, log });
    expect(summary).toMatchObject({ requeued: 1, failed: 0, cancelled: 0 });
    expect(await getJob(job.id)).toMatchObject({
      status: 'queued',
      lockedUntil: null,
      attempts: 1,
    });
    expect(queue.enqueued).toEqual([{ jobId: job.id, delayMs: undefined, attempt: 2 }]);
  });

  it('fails a job whose worker vanished on the last attempt', async () => {
    const { job } = await seed({ status: 'running', attempts: 3, maxAttempts: 3 });
    await expire(job.id);
    const summary = await reconcile({ db: testDb.db, queue, log });
    expect(summary).toMatchObject({ requeued: 0, failed: 1 });
    expect(await getJob(job.id)).toMatchObject({
      status: 'failed',
      errorCode: 'INTERNAL',
      errorMessage: 'The job stopped responding.',
      lockedUntil: null,
    });
    expect(queue.enqueued).toEqual([]);
  });

  it('cancels, instead of retrying, a job that had a cancel request when its worker vanished', async () => {
    const { job } = await seed({ status: 'running', attempts: 1 });
    await sql('update jobs set cancel_requested_at = now() where id = $1', [job.id]);
    await expire(job.id);
    const summary = await reconcile({ db: testDb.db, queue, log });
    expect(summary).toMatchObject({ cancelled: 1, requeued: 0 });
    expect(await getJob(job.id)).toMatchObject({ status: 'cancelled', errorCode: 'CANCELLED' });
    expect(queue.enqueued).toEqual([]);
  });

  it('leaves a running job with a live lease alone', async () => {
    const { job } = await seed({ status: 'running', attempts: 1 });
    const summary = await reconcile({ db: testDb.db, queue, log });
    expect(summary).toMatchObject({ requeued: 0, failed: 0, cancelled: 0 });
    expect(await getJob(job.id)).toMatchObject({ status: 'running', attempts: 1 });
    expect(queue.enqueued.filter((entry) => entry.jobId === job.id)).toEqual([]);
  });

  it('offers an overdue queued job to the queue again, as the same attempt number each time', async () => {
    const { job } = await seed({ attempts: 1 });
    await sql("update jobs set run_after = now() - interval '2 minutes' where id = $1", [job.id]);
    await reconcile({ db: testDb.db, queue, log });
    await reconcile({ db: testDb.db, queue, log });
    const mine = queue.enqueued.filter((entry) => entry.jobId === job.id);
    expect(mine).toEqual([
      { jobId: job.id, delayMs: undefined, attempt: 2 },
      { jobId: job.id, delayMs: undefined, attempt: 2 },
    ]);
    expect(await getJob(job.id)).toMatchObject({ status: 'queued', attempts: 1 });
  });

  it('does not touch a queued job that is not overdue, or is waiting out a retry delay', async () => {
    const fresh = await seed();
    const waiting = await seed();
    await sql("update jobs set run_after = now() + interval '30 seconds' where id = $1", [
      waiting.job.id,
    ]);
    const justDue = await seed();
    await sql("update jobs set run_after = now() - interval '20 seconds' where id = $1", [
      justDue.job.id,
    ]);
    await reconcile({ db: testDb.db, queue, log });
    const ids = queue.enqueued.map((entry) => entry.jobId);
    expect(ids).not.toContain(fresh.job.id);
    expect(ids).not.toContain(waiting.job.id);
    expect(ids).not.toContain(justDue.job.id);
  });

  it('fails a queued job that has no attempts left', async () => {
    const { job } = await seed({ attempts: 3, maxAttempts: 3 });
    const summary = await reconcile({ db: testDb.db, queue, log });
    expect(summary.failed).toBeGreaterThanOrEqual(1);
    expect(await getJob(job.id)).toMatchObject({
      status: 'failed',
      errorCode: 'INTERNAL',
      errorMessage: 'The job stopped responding.',
    });
  });

  it('does not touch finished jobs', async () => {
    const { job } = await seed({ variants: 1 });
    await processJob(deps(new ScriptedProvider()), job.id);
    await sql(
      "update jobs set locked_until = null, updated_at = now() - interval '1 day' where id = $1",
      [job.id],
    );
    await reconcile({ db: testDb.db, queue, log });
    expect((await getJob(job.id)).status).toBe('succeeded');
    expect(queue.enqueued.filter((entry) => entry.jobId === job.id)).toEqual([]);
  });

  it('survives a queue outage and tries again on the next pass', async () => {
    const { job } = await seed({ status: 'running', attempts: 1 });
    await expire(job.id);
    queue.failWith = new Error('redis down');
    const summary = await reconcile({ db: testDb.db, queue, log });
    expect(summary).toMatchObject({ requeued: 1, enqueued: 0 });
    expect((await getJob(job.id)).status).toBe('queued');
    expect(records.some((record) => record.event === 'reconcile.enqueue_failed')).toBe(true);

    // The row is queued but not yet overdue; once it is, the next pass offers it again.
    await sql("update jobs set run_after = now() - interval '2 minutes' where id = $1", [job.id]);
    queue.failWith = null;
    await reconcile({ db: testDb.db, queue, log });
    expect(queue.enqueued.map((entry) => entry.jobId)).toContain(job.id);
  });

  it('lets two reconcilers share the work without handling a job twice', async () => {
    const jobs = await Promise.all(
      Array.from({ length: 6 }, () => seed({ status: 'running', attempts: 1 })),
    );
    await Promise.all(jobs.map(({ job }) => expire(job.id)));
    const summaries = await Promise.all([
      reconcile({ db: testDb.db, queue, log }),
      reconcile({ db: testDb.db, queue, log }),
    ]);
    expect(summaries.reduce((total, summary) => total + summary.requeued, 0)).toBe(6);
    for (const { job } of jobs) {
      expect(queue.enqueued.filter((entry) => entry.jobId === job.id)).toHaveLength(1);
    }
  });

  it('recovers a job whose worker died: reconcile, then a second worker finishes it', async () => {
    const { job, campaign } = await seed({ variants: 1 });
    // Worker 1 claims the job and then dies without a trace.
    await sql(
      "update jobs set status = 'running', attempts = 1, locked_until = now() - interval '1 second' where id = $1",
      [job.id],
    );
    await reconcile({ db: testDb.db, queue, log });
    expect(await processJob(deps(new ScriptedProvider()), job.id)).toBe('succeeded');
    expect(await getJob(job.id)).toMatchObject({ status: 'succeeded', attempts: 2 });
    expect(await draftsOf(campaign.id)).toHaveLength(1);
  });
});
