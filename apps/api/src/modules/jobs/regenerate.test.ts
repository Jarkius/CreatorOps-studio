import { SECTION_NAMES } from '@creatorops/contracts';
import {
  MockTextProvider,
  ProviderError,
  type DraftSections,
  type ProviderCallOptions,
  type RegenerateSectionRequest,
  type SectionName,
  type SectionValue,
  type TextProvider,
} from '@creatorops/provider-core';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { schema } from '../../db/client.js';
import { requireDatabaseUrl, SECRET_FOR_TESTS } from '../../test/db-url.js';
import { RecordingJobQueue } from '../../test/job-queue.js';
import { createPerson, type Person } from '../../test/people.js';
import { createTestDb, type TestDb } from '../../test/test-db.js';
import { processJob, type WorkerDeps, type WorkerLog } from './process.js';

let testDb: TestDb;
let alice: Person;
let queue: RecordingJobQueue;
let counter = 0;

const log: WorkerLog = { info: () => undefined, warn: () => undefined, error: () => undefined };

beforeAll(async () => {
  testDb = await createTestDb(requireDatabaseUrl());
  alice = await createPerson(testDb.db, SECRET_FOR_TESTS, 'regen-alice');
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

/** A provider whose regenerate answer each test scripts; generateBrief is never used here. */
class ScriptedProvider implements TextProvider {
  readonly id = 'scripted';
  readonly requests: RegenerateSectionRequest[] = [];
  constructor(
    private readonly script: (
      request: RegenerateSectionRequest,
      options: ProviderCallOptions,
    ) =>
      | Promise<{ section: SectionName; value: SectionValue }>
      | { section: SectionName; value: SectionValue },
  ) {}
  generateBrief(): never {
    throw new Error('not used');
  }
  async regenerateSection(request: RegenerateSectionRequest, options: ProviderCallOptions = {}) {
    this.requests.push(request);
    const answer = await this.script(request, options);
    return { ...answer, usage: { inputUnits: 1, outputUnits: 1 }, model: 'scripted-1' };
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
  readonly restrictedClaims?: string[];
  readonly status?: 'draft' | 'in_review' | 'approved';
  readonly section?: SectionName;
  readonly expectedRev?: number;
  readonly campaignStatus?: 'draft' | 'archived';
  readonly input?: Record<string, unknown>;
  readonly withDraft?: boolean;
}

async function seed(options: SeedOptions = {}) {
  const n = (counter += 1);
  const [product] = await testDb.db
    .insert(schema.products)
    .values({
      workspaceId: alice.workspaceId,
      name: `Fan ${n}`,
      sellingPoints: ['เบา'],
      restrictedClaims: options.restrictedClaims ?? [],
    })
    .returning();
  const [campaign] = await testDb.db
    .insert(schema.campaigns)
    .values({
      workspaceId: alice.workspaceId,
      productId: product?.id ?? '',
      name: `Campaign ${n}`,
      templateId: 'product-showcase',
      templateVersion: 1,
      language: 'th',
      platform: 'tiktok',
      durationSeconds: 30,
      status: options.campaignStatus ?? 'draft',
      createdBy: alice.userId,
    })
    .returning();
  if (product === undefined || campaign === undefined) throw new Error('seed failed');
  const [draft] = await testDb.db
    .insert(schema.contentDrafts)
    .values({
      workspaceId: alice.workspaceId,
      campaignId: campaign.id,
      productId: product.id,
      variantIndex: 1,
      sections: SECTIONS,
      sectionState: Object.fromEntries(
        SECTION_NAMES.map((name) => [name, { rev: 1, origin: 'generated', jobId: null }]),
      ),
      status: options.status ?? 'draft',
    })
    .returning();
  if (draft === undefined) throw new Error('seed failed');
  const section = options.section ?? 'hook';
  const [job] = await testDb.db
    .insert(schema.jobs)
    .values({
      workspaceId: alice.workspaceId,
      type: 'regenerate_section',
      status: 'queued',
      input: options.input ?? {
        draftId: draft.id,
        campaignId: campaign.id,
        section,
        expectedRev: options.expectedRev ?? 1,
        templateId: 'product-showcase',
        templateVersion: 1,
        language: 'th',
        tone: null,
        platform: 'tiktok',
        durationSeconds: 30,
        variantIndex: 1,
      },
      createdBy: alice.userId,
      idempotencyKey: `regen-key-${n}-abcdefgh`,
      requestHash: 'a'.repeat(64),
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

async function getDraft(id: string) {
  const [row] = await testDb.db
    .select()
    .from(schema.contentDrafts)
    .where(eq(schema.contentDrafts.id, id));
  if (row === undefined) throw new Error('draft vanished');
  return row;
}

/** What a manual edit of the hook does to the row (the same rows PATCH writes). */
async function editHook(draftId: string, hook: string): Promise<void> {
  const row = await getDraft(draftId);
  const state = row.sectionState as Record<string, { rev: number }>;
  await testDb.db
    .update(schema.contentDrafts)
    .set({
      sections: { ...(row.sections as object), hook },
      sectionState: {
        ...state,
        hook: { rev: (state.hook?.rev ?? 0) + 1, origin: 'edited', jobId: null },
      },
      version: row.version + 1,
    })
    .where(eq(schema.contentDrafts.id, draftId));
}

const newHook = new ScriptedProvider(() => ({ section: 'hook', value: 'ลมเย็นสบาย' }));

describe('regenerate_section: a successful run', () => {
  it('replaces only that section, raises its revision and the version, and finishes the job', async () => {
    const { job, draft } = await seed();
    const provider = new ScriptedProvider(() => ({ section: 'hook', value: 'ลมเย็นสบาย' }));
    expect(await processJob(deps(provider), job.id)).toBe('succeeded');

    const after = await getDraft(draft.id);
    expect(after.sections).toEqual({ ...SECTIONS, hook: 'ลมเย็นสบาย' });
    expect(after.version).toBe(2);
    expect(after.sectionState).toMatchObject({
      hook: { rev: 2, origin: 'generated', jobId: job.id },
      title: { rev: 1, origin: 'generated', jobId: null },
      caption: { rev: 1 },
    });
    expect(await getJob(job.id)).toMatchObject({
      status: 'succeeded',
      provider: 'scripted',
      attempts: 1,
      errorCode: null,
      output: { draftId: draft.id, section: 'hook', rev: 2, changed: true, model: 'scripted-1' },
    });
  });

  it('hands the provider the current draft, the product facts and the job snapshot', async () => {
    const { job, product } = await seed({ section: 'caption' });
    const provider = new ScriptedProvider(() => ({ section: 'caption', value: 'แคปชั่นใหม่' }));
    await processJob(deps(provider), job.id);
    expect(provider.requests).toHaveLength(1);
    expect(provider.requests[0]).toMatchObject({
      section: 'caption',
      current: SECTIONS,
      template: { id: 'product-showcase', version: 1 },
      language: 'th',
      platform: 'tiktok',
      durationSeconds: 30,
      variantIndex: 1,
      product: { name: product.name, sellingPoints: ['เบา'] },
    });
  });

  it('works for array sections with the real mock provider', async () => {
    for (const section of ['storyboard', 'hashtags'] as const) {
      const { job, draft } = await seed({ section });
      expect(await processJob(deps(new MockTextProvider()), job.id)).toBe('succeeded');
      const after = await getDraft(draft.id);
      expect(Array.isArray((after.sections as Record<string, unknown>)[section])).toBe(true);
      expect((after.sectionState as Record<string, { rev: number }>)[section]?.rev).toBe(2);
    }
  });

  it('puts an approved draft back to draft, and runs the claim guard over the whole draft', async () => {
    const { job, draft } = await seed({ status: 'approved', restrictedClaims: ['รักษาโรค'] });
    const provider = new ScriptedProvider(() => ({ section: 'hook', value: 'ช่วยรักษาโรคได้' }));
    expect(await processJob(deps(provider), job.id)).toBe('succeeded');
    const after = await getDraft(draft.id);
    expect(after.status).toBe('draft');
    expect(after.needsReview).toBe(true);
    expect(after.claimWarnings).toContainEqual(
      expect.objectContaining({ section: 'hook', kind: 'restricted_claim', text: 'รักษาโรค' }),
    );
  });

  it('clears an old warning when the regenerated section no longer contains the claim', async () => {
    const { job, draft } = await seed({ restrictedClaims: ['รักษาโรค'] });
    await testDb.db
      .update(schema.contentDrafts)
      .set({
        sections: { ...SECTIONS, hook: 'รักษาโรคได้' },
        claimWarnings: [{ section: 'hook', kind: 'restricted_claim', text: 'รักษาโรค' }],
        needsReview: true,
      })
      .where(eq(schema.contentDrafts.id, draft.id));
    expect(await processJob(deps(newHook), job.id)).toBe('succeeded');
    const after = await getDraft(draft.id);
    expect(after.claimWarnings).toEqual([]);
    expect(after.needsReview).toBe(false);
  });

  it('succeeds without a new revision when the value did not change', async () => {
    const { job, draft } = await seed();
    const provider = new ScriptedProvider(() => ({ section: 'hook', value: SECTIONS.hook }));
    expect(await processJob(deps(provider), job.id)).toBe('succeeded');
    const after = await getDraft(draft.id);
    expect(after.version).toBe(1);
    expect((after.sectionState as Record<string, { rev: number }>).hook?.rev).toBe(1);
    expect(await getJob(job.id)).toMatchObject({
      status: 'succeeded',
      output: { rev: 1, changed: false },
    });
  });
});

describe('regenerate_section: an edit always wins (SECTION_CHANGED)', () => {
  it('fails at once, without calling the provider, when the section moved before the job ran', async () => {
    const { job, draft } = await seed({ expectedRev: 1 });
    await editHook(draft.id, 'ข้อความที่ผู้ใช้แก้เอง');
    const provider = new ScriptedProvider(() => ({ section: 'hook', value: 'ไม่ควรถูกใช้' }));
    expect(await processJob(deps(provider), job.id)).toBe('failed');

    expect(provider.requests).toHaveLength(0);
    expect(await getJob(job.id)).toMatchObject({
      status: 'failed',
      errorCode: 'SECTION_CHANGED',
      attempts: 1,
      errorMessage: 'The section was edited while the job was running.',
    });
    expect((await getDraft(draft.id)).sections).toMatchObject({ hook: 'ข้อความที่ผู้ใช้แก้เอง' });
    expect(queue.enqueued).toEqual([]);
  });

  it('fails and keeps the edit when the edit lands while the provider is working', async () => {
    const { job, draft } = await seed();
    const provider = new ScriptedProvider(async () => {
      await editHook(draft.id, 'แก้ระหว่างที่โมเดลกำลังทำงาน');
      return { section: 'hook', value: 'ผลจากโมเดล' };
    });
    expect(await processJob(deps(provider), job.id)).toBe('failed');

    expect(provider.requests).toHaveLength(1);
    expect(await getJob(job.id)).toMatchObject({
      status: 'failed',
      errorCode: 'SECTION_CHANGED',
      output: null,
    });
    const after = await getDraft(draft.id);
    expect(after.sections).toMatchObject({ hook: 'แก้ระหว่างที่โมเดลกำลังทำงาน' });
    expect(after.version).toBe(2);
    expect((after.sectionState as Record<string, { rev: number; origin: string }>).hook).toEqual({
      rev: 2,
      origin: 'edited',
      jobId: null,
    });
  });

  it('is not triggered by an edit to a different section', async () => {
    const { job, draft } = await seed({ section: 'caption' });
    const provider = new ScriptedProvider(async () => {
      await editHook(draft.id, 'แก้ฮุคระหว่างทาง');
      return { section: 'caption', value: 'แคปชั่นใหม่' };
    });
    expect(await processJob(deps(provider), job.id)).toBe('succeeded');
    const after = await getDraft(draft.id);
    expect(after.sections).toMatchObject({ hook: 'แก้ฮุคระหว่างทาง', caption: 'แคปชั่นใหม่' });
    expect(after.version).toBe(3);
  });

  it('lets two regenerate jobs for the same section run one after the other, the second fails', async () => {
    const first = await seed();
    // A second job created from the same draft state, as two browser tabs would.
    const [second] = await testDb.db
      .insert(schema.jobs)
      .values({
        workspaceId: alice.workspaceId,
        type: 'regenerate_section',
        status: 'queued',
        input: first.job.input,
        createdBy: alice.userId,
        idempotencyKey: `regen-key-twin-${counter}-abcdefgh`,
        requestHash: 'b'.repeat(64),
        draftId: first.draft.id,
      })
      .returning();
    if (second === undefined) throw new Error('no second job');
    expect(await processJob(deps(newHook), first.job.id)).toBe('succeeded');
    expect(await processJob(deps(newHook), second.id)).toBe('failed');
    expect(await getJob(second.id)).toMatchObject({ errorCode: 'SECTION_CHANGED' });
    expect((await getDraft(first.draft.id)).version).toBe(2);
  });
});

describe('regenerate_section: failures', () => {
  it('fails with INVALID_PROVIDER_OUTPUT, without retry, when the value breaks the section rules', async () => {
    const { job, draft } = await seed();
    const provider = new ScriptedProvider(() => ({ section: 'hook', value: 'x'.repeat(500) }));
    expect(await processJob(deps(provider), job.id)).toBe('failed');
    expect(await getJob(job.id)).toMatchObject({
      errorCode: 'INVALID_PROVIDER_OUTPUT',
      attempts: 1,
    });
    expect((await getDraft(draft.id)).version).toBe(1);
  });

  it('refuses a value for a different section than the one asked for', async () => {
    const { job, draft } = await seed();
    const provider = new ScriptedProvider(() => ({ section: 'caption', value: 'ผิดที่' }));
    expect(await processJob(deps(provider), job.id)).toBe('failed');
    expect(await getJob(job.id)).toMatchObject({ errorCode: 'INTERNAL' });
    expect(await getDraft(draft.id)).toMatchObject({ version: 1, sections: SECTIONS });
  });

  it('retries a transient provider error and then stores the section', async () => {
    const { job, draft } = await seed();
    let calls = 0;
    const provider = new ScriptedProvider(() => {
      calls += 1;
      if (calls === 1) throw new ProviderError('UPSTREAM_5XX');
      return { section: 'hook', value: 'ลองใหม่ได้แล้ว' };
    });
    expect(await processJob(deps(provider), job.id)).toBe('retried');
    expect(queue.enqueued).toHaveLength(1);
    expect((await getDraft(draft.id)).version).toBe(1);
    await testDb.pool.query('update jobs set run_after = now() where id = $1', [job.id]);
    expect(await processJob(deps(provider), job.id)).toBe('succeeded');
    expect(await getJob(job.id)).toMatchObject({ attempts: 2 });
    expect((await getDraft(draft.id)).sections).toMatchObject({ hook: 'ลองใหม่ได้แล้ว' });
  });

  it('fails with INTERNAL when the draft, the campaign or the settings are gone or damaged', async () => {
    const archived = await seed({ campaignStatus: 'archived' });
    expect(await processJob(deps(newHook), archived.job.id)).toBe('failed');
    expect(await getJob(archived.job.id)).toMatchObject({ errorCode: 'INTERNAL' });

    const missingDraft = await seed();
    await testDb.db
      .update(schema.jobs)
      .set({
        input: {
          ...(missingDraft.job.input as object),
          draftId: '00000000-0000-4000-8000-000000000000',
        },
      })
      .where(eq(schema.jobs.id, missingDraft.job.id));
    expect(await processJob(deps(newHook), missingDraft.job.id)).toBe('failed');
    expect(await getJob(missingDraft.job.id)).toMatchObject({
      errorCode: 'INTERNAL',
      errorMessage: 'The draft is no longer available.',
    });

    const badInput = await seed({ input: { draftId: 'x' } });
    expect(await processJob(deps(newHook), badInput.job.id)).toBe('failed');
    expect(await getJob(badInput.job.id)).toMatchObject({
      errorCode: 'INTERNAL',
      errorMessage: 'The job settings are not valid.',
    });
  });

  it('never reads a draft of another workspace, even if the job names its id', async () => {
    const other = await createPerson(testDb.db, SECRET_FOR_TESTS, 'regen-other');
    const [product] = await testDb.db
      .insert(schema.products)
      .values({ workspaceId: other.workspaceId, name: 'Other fan' })
      .returning();
    const [campaign] = await testDb.db
      .insert(schema.campaigns)
      .values({
        workspaceId: other.workspaceId,
        productId: product?.id ?? '',
        name: 'Other',
        templateId: 'product-showcase',
        templateVersion: 1,
        language: 'th',
        durationSeconds: 30,
        createdBy: other.userId,
      })
      .returning();
    const [foreign] = await testDb.db
      .insert(schema.contentDrafts)
      .values({
        workspaceId: other.workspaceId,
        campaignId: campaign?.id ?? '',
        productId: product?.id ?? '',
        sections: SECTIONS,
        sectionState: Object.fromEntries(
          SECTION_NAMES.map((name) => [name, { rev: 1, origin: 'generated', jobId: null }]),
        ),
      })
      .returning();
    const { job } = await seed();
    await testDb.db
      .update(schema.jobs)
      .set({ input: { ...(job.input as object), draftId: foreign?.id } })
      .where(eq(schema.jobs.id, job.id));
    const provider = new ScriptedProvider(() => ({ section: 'hook', value: 'ข้ามพื้นที่' }));
    expect(await processJob(deps(provider), job.id)).toBe('failed');
    expect(provider.requests).toHaveLength(0);
    expect((await getDraft(foreign?.id ?? '')).version).toBe(1);
  });

  it('a cancel request that arrives while the provider works wins; the draft is untouched', async () => {
    const { job, draft } = await seed();
    const provider = new ScriptedProvider(async () => {
      await testDb.pool.query('update jobs set cancel_requested_at = now() where id = $1', [
        job.id,
      ]);
      return { section: 'hook', value: 'ไม่ควรถูกบันทึก' };
    });
    expect(await processJob(deps(provider), job.id)).toBe('cancelled');
    expect(await getJob(job.id)).toMatchObject({ status: 'cancelled', errorCode: 'CANCELLED' });
    expect(await getDraft(draft.id)).toMatchObject({ version: 1, sections: SECTIONS });
  });
});
