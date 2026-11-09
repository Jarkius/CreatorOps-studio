import { SECTION_NAMES } from '@creatorops/contracts';
import {
  fakeMp4,
  MockTextProvider,
  ProviderError,
  VIDEO_SCENES,
  type DraftSections,
  type ProviderCallOptions,
  type TextProvider,
  type VideoPromptRequest,
  type VideoPromptScene,
} from '@creatorops/provider-core';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { schema } from '../../db/client.js';
import { requireDatabaseUrl, SECRET_FOR_TESTS } from '../../test/db-url.js';
import { RecordingJobQueue } from '../../test/job-queue.js';
import { createPerson, type Person } from '../../test/people.js';
import { createTestDb, type TestDb } from '../../test/test-db.js';
import { processJob, type WorkerDeps, type WorkerLog } from './process.js';

void fakeMp4;

let testDb: TestDb;
let alice: Person;
let bob: Person;
let queue: RecordingJobQueue;
let counter = 0;

const log: WorkerLog = { info: () => undefined, warn: () => undefined, error: () => undefined };

beforeAll(async () => {
  testDb = await createTestDb(requireDatabaseUrl());
  alice = await createPerson(testDb.db, SECRET_FOR_TESTS, 'vp-alice');
  bob = await createPerson(testDb.db, SECRET_FOR_TESTS, 'vp-bob');
});
afterAll(async () => {
  await testDb.drop();
});
beforeEach(async () => {
  queue = new RecordingJobQueue();
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

const PROMPT =
  'Vertical 9:16 video. A small handheld fan stands on a white desk, the camera slowly pushing in, soft window light, clean modern style. No on-screen text, no logos, no watermarks.';
const scenesWith = (over: Partial<VideoPromptScene> = {}): VideoPromptScene[] =>
  VIDEO_SCENES.map((scene) => ({ scene, prompt: PROMPT, voiceover: 'ลมเย็นสบาย', ...over }));

/** A provider whose video prompt answer each test scripts. */
class VideoScripted implements TextProvider {
  readonly id = 'scripted';
  readonly requests: VideoPromptRequest[] = [];
  calls = 0;
  constructor(
    private readonly script: (
      request: VideoPromptRequest,
      options: ProviderCallOptions,
      call: number,
    ) => Promise<VideoPromptScene[]> | VideoPromptScene[] = () => scenesWith(),
  ) {}
  generateBrief(): never {
    throw new Error('not used');
  }
  regenerateSection(): never {
    throw new Error('not used');
  }
  async generateVideoPrompts(request: VideoPromptRequest, options: ProviderCallOptions = {}) {
    this.requests.push(request);
    this.calls += 1;
    const scenes = await this.script(request, options, this.calls);
    return { scenes, usage: { inputUnits: 1, outputUnits: 1 }, model: 'scripted-1' };
  }
}

const deps = (provider: TextProvider): WorkerDeps => ({
  db: testDb.db,
  provider,
  queue,
  log,
  random: () => 0,
});

interface SeedOptions {
  readonly owner?: Person;
  readonly campaignStatus?: 'draft' | 'archived';
  readonly productStatus?: 'active' | 'archived';
  readonly restrictedClaims?: string[];
  readonly input?: (base: Record<string, unknown>) => Record<string, unknown>;
}

async function seed(options: SeedOptions = {}) {
  const owner = options.owner ?? alice;
  const n = (counter += 1);
  const [product] = await testDb.db
    .insert(schema.products)
    .values({
      workspaceId: owner.workspaceId,
      name: `Fan ${n}`,
      sellingPoints: ['เบา', 'ชาร์จ USB-C'],
      restrictedClaims: options.restrictedClaims ?? [],
      status: options.productStatus ?? 'active',
      ...(options.productStatus === 'archived' ? { archivedAt: new Date() } : {}),
    })
    .returning();
  const [campaign] = await testDb.db
    .insert(schema.campaigns)
    .values({
      workspaceId: owner.workspaceId,
      productId: product?.id ?? '',
      name: `Campaign ${n}`,
      templateId: 'product-showcase',
      templateVersion: 1,
      language: 'th',
      tone: 'สนุก',
      platform: 'tiktok',
      durationSeconds: 30,
      status: options.campaignStatus ?? 'draft',
      createdBy: owner.userId,
    })
    .returning();
  if (product === undefined || campaign === undefined) throw new Error('seed failed');
  const [draft] = await testDb.db
    .insert(schema.contentDrafts)
    .values({
      workspaceId: owner.workspaceId,
      campaignId: campaign.id,
      productId: product.id,
      sections: SECTIONS,
      sectionState: Object.fromEntries(
        SECTION_NAMES.map((name) => [name, { rev: 1, origin: 'generated', jobId: null }]),
      ),
    })
    .returning();
  if (draft === undefined) throw new Error('seed failed');
  const base = {
    draftId: draft.id,
    draftVersion: draft.version,
    language: 'th',
    tone: 'สนุก',
    platform: 'tiktok',
    clipSeconds: 8,
  };
  const [job] = await testDb.db
    .insert(schema.jobs)
    .values({
      workspaceId: owner.workspaceId,
      type: 'generate_video_prompts',
      status: 'queued',
      input: options.input ? options.input(base) : base,
      createdBy: owner.userId,
      idempotencyKey: `vp-key-${n}-abcdefghijk`,
      requestHash: 'b'.repeat(64),
      draftId: draft.id,
      attempts: 0,
      maxAttempts: 3,
    })
    .returning();
  if (job === undefined) throw new Error('seed failed');
  return { job, draft, campaign, product };
}

async function getJob(id: string) {
  const [row] = await testDb.db.select().from(schema.jobs).where(eq(schema.jobs.id, id));
  if (row === undefined) throw new Error('job vanished');
  return row;
}

describe('generate_video_prompts: a successful run', () => {
  it('stores four scenes in the job output, leaves the draft alone, and records the provider', async () => {
    const { job, draft } = await seed();
    const before = await testDb.pool.query('select * from content_drafts where id = $1', [
      draft.id,
    ]);
    expect(await processJob(deps(new VideoScripted()), job.id)).toBe('succeeded');
    const row = await getJob(job.id);
    expect(row.status).toBe('succeeded');
    expect(row.provider).toBe('scripted');
    const output = row.output as {
      draftId: string;
      draftVersion: number;
      model: string;
      scenes: VideoPromptScene[];
    };
    expect(output.draftId).toBe(draft.id);
    expect(output.draftVersion).toBe(draft.version);
    expect(output.model).toBe('scripted-1');
    expect(output.scenes.map((s) => s.scene)).toEqual([...VIDEO_SCENES]);
    const after = await testDb.pool.query('select * from content_drafts where id = $1', [draft.id]);
    expect(after.rows).toEqual(before.rows); // not one byte of the draft changed
  });

  it("sends the product's facts, the campaign's language and tone, and the clip length", async () => {
    const { job } = await seed({ restrictedClaims: ['รักษาโรค'] });
    const provider = new VideoScripted();
    await processJob(deps(provider), job.id);
    const request = provider.requests[0];
    expect(request).toMatchObject({
      language: 'th',
      tone: 'สนุก',
      platform: 'tiktok',
      clipSeconds: 8,
    });
    expect(request?.product.sellingPoints).toEqual(['เบา', 'ชาร์จ USB-C']);
    expect(request?.product.restrictedClaims).toEqual(['รักษาโรค']);
  });

  it('passes the clip length of the job settings on to the provider', async () => {
    const { job } = await seed({ input: (base) => ({ ...base, clipSeconds: 6, language: 'en' }) });
    const provider = new VideoScripted();
    await processJob(deps(provider), job.id);
    expect(provider.requests[0]).toMatchObject({ clipSeconds: 6, language: 'en' });
  });

  it('works with the built-in mock provider, no key needed', async () => {
    const { job } = await seed();
    expect(await processJob(deps(new MockTextProvider()), job.id)).toBe('succeeded');
    const output = (await getJob(job.id)).output as { scenes: VideoPromptScene[] };
    expect(output.scenes).toHaveLength(4);
    expect(output.scenes[0]?.prompt.startsWith('Vertical 9:16 video.')).toBe(true);
  });
});

describe('generate_video_prompts: refusals and failures', () => {
  it('rejects output that mentions a restricted claim, permanently, and stores nothing', async () => {
    const { job } = await seed({ restrictedClaims: ['รักษาโรค'] });
    const provider = new VideoScripted(() => scenesWith({ voiceover: 'ช่วยรักษาโรคได้' }));
    expect(await processJob(deps(provider), job.id)).toBe('failed');
    const row = await getJob(job.id);
    expect(row.errorCode).toBe('INVALID_PROVIDER_OUTPUT');
    expect(row.output).toBeNull();
    expect(provider.calls).toBe(1); // a bad answer is not retried
  });

  it('rejects the wrong number of scenes even if the adapter promised four', async () => {
    const { job } = await seed();
    const provider = new VideoScripted(() => scenesWith().slice(0, 3));
    expect(await processJob(deps(provider), job.id)).toBe('failed');
    expect((await getJob(job.id)).errorCode).toBe('INVALID_PROVIDER_OUTPUT');
  });

  it('fails plainly when the campaign or the product is archived', async () => {
    for (const options of [
      { campaignStatus: 'archived' as const },
      { productStatus: 'archived' as const },
    ]) {
      const { job } = await seed(options);
      const provider = new VideoScripted();
      expect(await processJob(deps(provider), job.id)).toBe('failed');
      expect(provider.calls).toBe(0);
    }
  });

  it('fails plainly on settings that are not valid, without calling the provider', async () => {
    for (const mutate of [
      (base: Record<string, unknown>) => ({ ...base, clipSeconds: 99 }),
      (base: Record<string, unknown>) => ({ ...base, language: 'fr' }),
      (base: Record<string, unknown>) => ({ draftId: base.draftId }),
    ]) {
      const { job } = await seed({ input: mutate });
      const provider = new VideoScripted();
      expect(await processJob(deps(provider), job.id)).toBe('failed');
      expect(provider.calls).toBe(0);
      expect((await getJob(job.id)).errorMessage).toBe('The job settings are not valid.');
    }
  });

  it("does not read another workspace's draft, even when the job names its id", async () => {
    const foreign = await seed({ owner: bob });
    const mine = await seed({ input: (base) => ({ ...base, draftId: foreign.draft.id }) });
    const provider = new VideoScripted();
    expect(await processJob(deps(provider), mine.job.id)).toBe('failed');
    expect(provider.calls).toBe(0);
    expect(JSON.stringify((await getJob(mine.job.id)).errorMessage)).not.toContain(
      foreign.product.name,
    );
  });

  it('retries a transient provider error, up to the bound, and then gives up with a plain code', async () => {
    const { job } = await seed();
    const provider = new VideoScripted(() => {
      throw new ProviderError('UPSTREAM_5XX');
    });
    expect(await processJob(deps(provider), job.id)).toBe('retried');
    expect((await getJob(job.id)).status).toBe('queued');
    await testDb.pool.query('update jobs set run_after = now(), attempts = 2 where id = $1', [
      job.id,
    ]);
    expect(await processJob(deps(provider), job.id)).toBe('failed');
    expect((await getJob(job.id)).errorCode).toBe('PROVIDER_UNAVAILABLE');
  });

  it('does not retry a rejected key', async () => {
    const { job } = await seed();
    const provider = new VideoScripted(() => {
      throw new ProviderError('AUTH_FAILED');
    });
    expect(await processJob(deps(provider), job.id)).toBe('failed');
    expect(provider.calls).toBe(1);
    expect((await getJob(job.id)).errorCode).toBe('PROVIDER_AUTH');
  });

  it('stores nothing when a cancel arrived while the provider was busy', async () => {
    const { job } = await seed();
    const provider = new VideoScripted(async () => {
      await testDb.pool.query('update jobs set cancel_requested_at = now() where id = $1', [
        job.id,
      ]);
      return scenesWith();
    });
    expect(await processJob(deps(provider), job.id)).toBe('cancelled');
    const row = await getJob(job.id);
    expect(row.status).toBe('cancelled');
    expect(row.output).toBeNull();
  });
});
