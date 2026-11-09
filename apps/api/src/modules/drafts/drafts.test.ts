import {
  DraftListResponseSchema,
  DraftSchema,
  ErrorBodySchema,
  JobSchema,
  SECTION_NAMES,
  type Draft,
} from '@creatorops/contracts';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

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
let alice: Person;
let bob: Person;
let viewer: Person;
let reviewer: Person;
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
  for (const [person, role] of [
    [viewer, 'viewer'],
    [reviewer, 'reviewer'],
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
  method: 'GET' | 'POST' | 'PATCH',
  url: string,
  options: { payload?: unknown; key?: string } = {},
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

const SECTIONS = {
  title: 'พัดลมพกพา',
  hook: 'ลมแรงในกระเป๋า',
  script: 'พัดลมตัวเล็กใช้ได้ทุกที่',
  storyboard: ['ฉากที่ 1', 'ฉากที่ 2'],
  caption: 'พัดลมพกพา ใช้ง่าย',
  hashtags: ['#พัดลม'],
  callToAction: 'สั่งซื้อได้เลย',
};

interface Seeded {
  readonly draftId: string;
  readonly campaignId: string;
  readonly productId: string;
}

/** A campaign with one draft, written straight to the database in the shape the worker stores. */
async function seedDraft(
  person: Person,
  options: {
    restrictedClaims?: string[];
    status?: 'draft' | 'in_review' | 'approved';
    campaignStatus?: 'draft' | 'archived';
    sameCampaignAs?: Seeded;
  } = {},
): Promise<Seeded> {
  const n = (counter += 1);
  // A second draft of the same campaign must name the same product (composite key).
  const [product] =
    options.sameCampaignAs === undefined
      ? await testDb.db
          .insert(schema.products)
          .values({
            workspaceId: person.workspaceId,
            name: `Fan ${n}`,
            sellingPoints: ['เบา'],
            restrictedClaims: options.restrictedClaims ?? [],
          })
          .returning()
      : await testDb.db
          .select()
          .from(schema.products)
          .where(eq(schema.products.id, options.sameCampaignAs.productId));
  if (product === undefined) throw new Error('no product');
  let campaignId = options.sameCampaignAs?.campaignId;
  if (campaignId === undefined) {
    const [campaign] = await testDb.db
      .insert(schema.campaigns)
      .values({
        workspaceId: person.workspaceId,
        productId: product.id,
        name: `Campaign ${n}`,
        templateId: 'product-showcase',
        templateVersion: 1,
        language: 'th',
        platform: 'tiktok',
        durationSeconds: 30,
        status: options.campaignStatus ?? 'draft',
        createdBy: person.userId,
      })
      .returning();
    if (campaign === undefined) throw new Error('no campaign');
    campaignId = campaign.id;
  }
  const [draft] = await testDb.db
    .insert(schema.contentDrafts)
    .values({
      workspaceId: person.workspaceId,
      campaignId,
      productId: product.id,
      variantIndex: 0,
      sections: SECTIONS,
      sectionState: Object.fromEntries(
        SECTION_NAMES.map((name) => [name, { rev: 1, origin: 'generated', jobId: null }]),
      ),
      status: options.status ?? 'draft',
    })
    .returning();
  if (draft === undefined) throw new Error('no draft');
  return { draftId: draft.id, campaignId, productId: product.id };
}

const getDraft = async (person: Person, id: string): Promise<Draft> => {
  const response = await call(person, 'GET', `${base(person.workspaceId)}/drafts/${id}`);
  expect(response.statusCode, response.body).toBe(200);
  return DraftSchema.parse(response.json());
};

const patch = (person: Person | null, id: string, payload: unknown, workspaceId?: string) =>
  call(person, 'PATCH', `${base(workspaceId ?? person?.workspaceId ?? '')}/drafts/${id}`, {
    payload,
  });

const regenerate = (person: Person | null, payload: unknown, key: string | null = newKey()) =>
  call(person, 'POST', `${base(person?.workspaceId ?? '')}/jobs/regenerate-section`, {
    payload,
    ...(key === null ? {} : { key }),
  });

describe('GET /drafts and /drafts/:id', () => {
  it('returns a draft in the contract shape', async () => {
    const { draftId, campaignId } = await seedDraft(alice);
    const draft = await getDraft(alice, draftId);
    expect(draft).toMatchObject({
      id: draftId,
      campaignId,
      workspaceId: alice.workspaceId,
      status: 'draft',
      version: 1,
      needsReview: false,
      sections: SECTIONS,
    });
    expect(draft.sectionState.hook).toEqual({ rev: 1, origin: 'generated', jobId: null });
  });

  it('is readable by viewers and reviewers', async () => {
    const { draftId } = await seedDraft(alice);
    for (const person of [viewer, reviewer]) {
      const response = await call(person, 'GET', `${base(alice.workspaceId)}/drafts/${draftId}`);
      expect(response.statusCode).toBe(200);
    }
  });

  it('answers 404 for a stranger, an unknown id and a malformed id', async () => {
    const { draftId } = await seedDraft(alice);
    const stranger = await call(bob, 'GET', `${base(alice.workspaceId)}/drafts/${draftId}`);
    expect(stranger.statusCode).toBe(404);
    // Bob's own workspace does not contain Alice's draft either.
    const wrongWorkspace = await call(bob, 'GET', `${base(bob.workspaceId)}/drafts/${draftId}`);
    expect(wrongWorkspace.statusCode).toBe(404);
    for (const id of ['00000000-0000-4000-8000-000000000000', 'not-a-uuid']) {
      const response = await call(alice, 'GET', `${base(alice.workspaceId)}/drafts/${id}`);
      expect(response.statusCode).toBe(404);
      expect(ErrorBodySchema.parse(response.json()).error.code).toBe('NOT_FOUND');
    }
  });

  it('requires a token', async () => {
    const { draftId } = await seedDraft(alice);
    expect(
      (await call(null, 'GET', `${base(alice.workspaceId)}/drafts/${draftId}`)).statusCode,
    ).toBe(401);
  });

  it('lists newest first, filters by campaign and pages without repeats', async () => {
    const first = await seedDraft(alice);
    const second = await seedDraft(alice, { sameCampaignAs: first });
    const filtered = DraftListResponseSchema.parse(
      (
        await call(alice, 'GET', `${base(alice.workspaceId)}/drafts?campaignId=${first.campaignId}`)
      ).json(),
    );
    // Same transaction-free insert order, so the later one is newer.
    expect(filtered.items.map((item) => item.id)).toEqual([second.draftId, first.draftId]);

    const page1 = DraftListResponseSchema.parse(
      (
        await call(
          alice,
          'GET',
          `${base(alice.workspaceId)}/drafts?campaignId=${first.campaignId}&limit=1`,
        )
      ).json(),
    );
    expect(page1.items).toHaveLength(1);
    expect(page1.nextCursor).not.toBeNull();
    const page2 = DraftListResponseSchema.parse(
      (
        await call(
          alice,
          'GET',
          `${base(alice.workspaceId)}/drafts?campaignId=${first.campaignId}&limit=1&cursor=${encodeURIComponent(page1.nextCursor ?? '')}`,
        )
      ).json(),
    );
    expect(page2.items).toHaveLength(1);
    expect(page2.items[0]?.id).not.toBe(page1.items[0]?.id);
    expect(page2.nextCursor).toBeNull();
  });

  it('lists nothing for a malformed or foreign campaign id, and never another workspace', async () => {
    const mine = await seedDraft(alice);
    for (const id of ['not-a-uuid', '00000000-0000-4000-8000-000000000000']) {
      const response = await call(
        alice,
        'GET',
        `${base(alice.workspaceId)}/drafts?campaignId=${id}`,
      );
      expect(response.statusCode).toBe(200);
      expect(DraftListResponseSchema.parse(response.json()).items).toEqual([]);
    }
    const asBob = DraftListResponseSchema.parse(
      (
        await call(bob, 'GET', `${base(bob.workspaceId)}/drafts?campaignId=${mine.campaignId}`)
      ).json(),
    );
    expect(asBob.items).toEqual([]);
  });
});

describe('PATCH /drafts/:id', () => {
  it('edits a section, raises the version and the revision of that section only', async () => {
    const { draftId } = await seedDraft(alice);
    const response = await patch(alice, draftId, { version: 1, sections: { hook: 'ลมเย็นสบาย' } });
    expect(response.statusCode, response.body).toBe(200);
    const draft = DraftSchema.parse(response.json());
    expect(draft.version).toBe(2);
    expect(draft.sections.hook).toBe('ลมเย็นสบาย');
    expect(draft.sections.title).toBe(SECTIONS.title);
    expect(draft.sectionState.hook).toEqual({ rev: 2, origin: 'edited', jobId: null });
    expect(draft.sectionState.title).toEqual({ rev: 1, origin: 'generated', jobId: null });
    expect(await getDraft(alice, draftId)).toEqual(draft);
  });

  it('is refused with 409 and the current version when the version is stale', async () => {
    const { draftId } = await seedDraft(alice);
    expect(
      (await patch(alice, draftId, { version: 1, sections: { hook: 'หนึ่ง' } })).statusCode,
    ).toBe(200);
    const stale = await patch(alice, draftId, { version: 1, sections: { hook: 'สอง' } });
    expect(stale.statusCode).toBe(409);
    const body = ErrorBodySchema.parse(stale.json());
    expect(body.error.code).toBe('CONFLICT');
    expect(body.error.details?.currentVersion).toBe(2);
    expect((await getDraft(alice, draftId)).sections.hook).toBe('หนึ่ง');
  });

  it('lets exactly one of two parallel edits with the same version through', async () => {
    const { draftId } = await seedDraft(alice);
    const results = await Promise.all(
      ['ก', 'ข', 'ค', 'ง'].map((hook) => patch(alice, draftId, { version: 1, sections: { hook } })),
    );
    expect(results.map((result) => result.statusCode).sort()).toEqual([200, 409, 409, 409]);
    expect((await getDraft(alice, draftId)).version).toBe(2);
  });

  it('changes nothing when the value is the same: no new version, no new revision', async () => {
    const { draftId } = await seedDraft(alice);
    const response = await patch(alice, draftId, {
      version: 1,
      sections: { hook: SECTIONS.hook, hashtags: SECTIONS.hashtags },
    });
    expect(response.statusCode).toBe(200);
    const draft = DraftSchema.parse(response.json());
    expect(draft.version).toBe(1);
    expect(draft.sectionState.hook.rev).toBe(1);
  });

  it('edits arrays and normalises text like generated output', async () => {
    const { draftId } = await seedDraft(alice);
    const response = await patch(alice, draftId, {
      version: 1,
      sections: {
        storyboard: ['หนึ่ง', 'สอง', 'สาม'],
        hashtags: ['#a', '#b'],
        title: '  ชื่อใหม่  ',
      },
    });
    expect(response.statusCode, response.body).toBe(200);
    const draft = DraftSchema.parse(response.json());
    expect(draft.sections.storyboard).toEqual(['หนึ่ง', 'สอง', 'สาม']);
    expect(draft.sections.hashtags).toEqual(['#a', '#b']);
    expect(draft.sections.title).toBe('ชื่อใหม่');
    expect(draft.sectionState.storyboard.rev).toBe(2);
    expect(draft.sectionState.hashtags.rev).toBe(2);
    expect(draft.sectionState.title.rev).toBe(2);
    expect(draft.sectionState.caption.rev).toBe(1);
  });

  it('rejects invalid bodies without changing anything', async () => {
    const { draftId } = await seedDraft(alice);
    const bodies: unknown[] = [
      {},
      { version: 1 },
      { version: 1, sections: {} },
      { version: 1, sections: { hook: '' } },
      { version: 1, sections: { hook: 'x'.repeat(201) } },
      { version: 1, sections: { nope: 'x' } },
      { version: 1, sections: { hashtags: ['no-hash'] } },
      // Duplicate hashtags pass the schema and are refused by the shared output rules.
      { version: 1, sections: { hashtags: ['#a', '#A'] } },
      { version: 0, sections: { hook: 'x' } },
      { version: 1, sections: { hook: 'x' }, extra: true },
      { version: 1, sections: { hook: 'x' }, status: 'published' },
    ];
    for (const body of bodies) {
      const response = await patch(alice, draftId, body);
      expect(response.statusCode, JSON.stringify(body)).toBe(400);
    }
    expect((await getDraft(alice, draftId)).version).toBe(1);
  });

  it('answers 403 to a viewer or reviewer and 404 to a stranger, changing nothing', async () => {
    const { draftId } = await seedDraft(alice);
    const body = { version: 1, sections: { hook: 'แก้' } };
    for (const person of [viewer, reviewer]) {
      expect((await patch(person, draftId, body, alice.workspaceId)).statusCode).toBe(403);
    }
    expect((await patch(bob, draftId, body, alice.workspaceId)).statusCode).toBe(404);
    expect((await patch(bob, draftId, body, bob.workspaceId)).statusCode).toBe(404);
    expect((await patch(null, draftId, body, alice.workspaceId)).statusCode).toBe(401);
    expect((await getDraft(alice, draftId)).version).toBe(1);
  });

  it('puts an approved draft back to draft when content changes, unless a status is given', async () => {
    const approved = await seedDraft(alice, { status: 'approved' });
    const reset = DraftSchema.parse(
      (await patch(alice, approved.draftId, { version: 1, sections: { hook: 'ใหม่' } })).json(),
    );
    expect(reset.status).toBe('draft');

    const kept = await seedDraft(alice, { status: 'approved' });
    const explicit = DraftSchema.parse(
      (
        await patch(alice, kept.draftId, {
          version: 1,
          sections: { hook: 'ใหม่' },
          status: 'in_review',
        })
      ).json(),
    );
    expect(explicit.status).toBe('in_review');

    const same = await seedDraft(alice, { status: 'approved' });
    const untouched = DraftSchema.parse(
      (await patch(alice, same.draftId, { version: 1, sections: { hook: SECTIONS.hook } })).json(),
    );
    expect(untouched.status).toBe('approved');
    expect(untouched.version).toBe(1);

    const statusOnly = DraftSchema.parse(
      (
        await patch(alice, same.draftId, {
          version: 1,
          sections: { hook: SECTIONS.hook },
          status: 'in_review',
        })
      ).json(),
    );
    expect(statusOnly.status).toBe('in_review');
    expect(statusOnly.version).toBe(2);
    expect(statusOnly.sectionState.hook.rev).toBe(1);
  });

  it('runs the claim guard again after an edit', async () => {
    const { draftId } = await seedDraft(alice, { restrictedClaims: ['รักษาโรค'] });
    const flagged = DraftSchema.parse(
      (
        await patch(alice, draftId, {
          version: 1,
          sections: { caption: 'ช่วยรักษาโรคได้ ใช้ง่าย' },
        })
      ).json(),
    );
    expect(flagged.needsReview).toBe(true);
    expect(flagged.claimWarnings).toContainEqual(
      expect.objectContaining({ section: 'caption', kind: 'restricted_claim', text: 'รักษาโรค' }),
    );

    const cleared = DraftSchema.parse(
      (
        await patch(alice, draftId, { version: 2, sections: { caption: 'ใช้ง่าย พกพาสะดวก' } })
      ).json(),
    );
    expect(cleared.needsReview).toBe(false);
    expect(cleared.claimWarnings).toEqual([]);
  });

  it('records the edit in the audit log with section names only', async () => {
    const { draftId } = await seedDraft(alice);
    await patch(alice, draftId, { version: 1, sections: { hook: 'ข้อความลับของลูกค้า' } });
    const events = await testDb.db
      .select()
      .from(schema.auditEvents)
      .where(eq(schema.auditEvents.resourceId, draftId));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      action: 'draft.update',
      resourceType: 'draft',
      metadata: { sections: ['hook'], status: 'draft', version: 2 },
    });
    expect(JSON.stringify(events[0]?.metadata)).not.toContain('ลับ');
  });
});

describe('POST /jobs/regenerate-section', () => {
  it('creates a queued job for the draft with a snapshot of the campaign settings', async () => {
    const { draftId } = await seedDraft(alice);
    queue.enqueued.length = 0;
    const response = await regenerate(alice, { draftId, section: 'hook', expectedRev: 1 });
    expect(response.statusCode, response.body).toBe(202);
    const job = JobSchema.parse(response.json());
    expect(job).toMatchObject({
      type: 'regenerate_section',
      status: 'queued',
      draftId,
      campaignId: null,
      attempts: 0,
      input: {
        draftId,
        section: 'hook',
        expectedRev: 1,
        templateId: 'product-showcase',
        templateVersion: 1,
        language: 'th',
        platform: 'tiktok',
        durationSeconds: 30,
        variantIndex: 0,
      },
    });
    expect(queue.enqueued).toEqual([{ jobId: job.id, delayMs: undefined, attempt: 1 }]);
  });

  it('replays the same request with the same key and refuses a different one', async () => {
    const { draftId } = await seedDraft(alice);
    const key = newKey();
    const first = await regenerate(alice, { draftId, section: 'hook', expectedRev: 1 }, key);
    const again = await regenerate(alice, { draftId, section: 'hook', expectedRev: 1 }, key);
    expect(first.statusCode).toBe(202);
    expect(again.statusCode).toBe(200);
    expect(JobSchema.parse(again.json()).id).toBe(JobSchema.parse(first.json()).id);
    for (const other of [
      { draftId, section: 'caption', expectedRev: 1 },
      { draftId, section: 'hook', expectedRev: 2 },
    ]) {
      const conflict = await regenerate(alice, other, key);
      expect(conflict.statusCode).toBe(409);
      expect(ErrorBodySchema.parse(conflict.json()).error.code).toBe('IDEMPOTENCY_CONFLICT');
    }
  });

  it('refuses a stale revision with 409 and creates no job', async () => {
    const { draftId } = await seedDraft(alice);
    await patch(alice, draftId, { version: 1, sections: { hook: 'แก้แล้ว' } });
    const stale = await regenerate(alice, { draftId, section: 'hook', expectedRev: 1 });
    expect(stale.statusCode).toBe(409);
    expect(ErrorBodySchema.parse(stale.json()).error.code).toBe('CONFLICT');
    // Another section of the same draft was not edited, so its revision still matches.
    const other = await regenerate(alice, { draftId, section: 'caption', expectedRev: 1 });
    expect(other.statusCode).toBe(202);
    const rows = await testDb.db.select().from(schema.jobs).where(eq(schema.jobs.draftId, draftId));
    expect(rows).toHaveLength(1);
  });

  it('validates the body and the key', async () => {
    const { draftId } = await seedDraft(alice);
    const bad: unknown[] = [
      {},
      { draftId, section: 'hook' },
      { draftId, section: 'nope', expectedRev: 1 },
      { draftId, section: 'hook', expectedRev: 0 },
      { draftId, section: 'hook', expectedRev: 1, extra: 1 },
    ];
    for (const body of bad) {
      expect((await regenerate(alice, body)).statusCode, JSON.stringify(body)).toBe(400);
    }
    const noKey = await regenerate(alice, { draftId, section: 'hook', expectedRev: 1 }, null);
    expect(noKey.statusCode).toBe(400);
    const shortKey = await regenerate(alice, { draftId, section: 'hook', expectedRev: 1 }, 'short');
    expect(shortKey.statusCode).toBe(400);
  });

  it('refuses an unknown draft, a stranger, a read-only member and an archived campaign', async () => {
    const mine = await seedDraft(alice);
    const body = { draftId: mine.draftId, section: 'hook', expectedRev: 1 };

    const unknown = await regenerate(alice, {
      draftId: '00000000-0000-4000-8000-000000000000',
      section: 'hook',
      expectedRev: 1,
    });
    expect(unknown.statusCode).toBe(400);

    // Bob names Alice's draft inside his own workspace: it does not exist there.
    expect((await regenerate(bob, body)).statusCode).toBe(400);
    // And Alice's workspace URL is closed to him.
    const foreign = await call(bob, 'POST', `${base(alice.workspaceId)}/jobs/regenerate-section`, {
      payload: body,
      key: newKey(),
    });
    expect(foreign.statusCode).toBe(404);

    for (const person of [viewer, reviewer]) {
      const response = await call(
        person,
        'POST',
        `${base(alice.workspaceId)}/jobs/regenerate-section`,
        { payload: body, key: newKey() },
      );
      expect(response.statusCode).toBe(403);
    }

    const archived = await seedDraft(alice, { campaignStatus: 'archived' });
    const refused = await regenerate(alice, {
      draftId: archived.draftId,
      section: 'hook',
      expectedRev: 1,
    });
    expect(refused.statusCode).toBe(409);

    const rows = await testDb.db
      .select()
      .from(schema.jobs)
      .where(eq(schema.jobs.type, 'regenerate_section'));
    expect(rows.filter((row) => row.draftId === mine.draftId)).toHaveLength(0);
    expect(rows.filter((row) => row.draftId === archived.draftId)).toHaveLength(0);
  });
});

const videoPrompts = (person: Person | null, payload: unknown, key: string | null = newKey()) =>
  call(person, 'POST', `${base(person?.workspaceId ?? '')}/jobs/generate-video-prompts`, {
    payload,
    ...(key === null ? {} : { key }),
  });

describe('POST /jobs/generate-video-prompts', () => {
  // Jobs left queued by other tests count against the workspace's cap of active jobs.
  beforeEach(async () => {
    await testDb.pool.query('delete from jobs');
  });

  it('creates a queued job with a snapshot of the campaign language, tone and platform', async () => {
    const { draftId } = await seedDraft(alice);
    queue.enqueued.length = 0;
    const response = await videoPrompts(alice, { draftId, draftVersion: 1 });
    expect(response.statusCode, response.body).toBe(202);
    const job = JobSchema.parse(response.json());
    expect(job).toMatchObject({
      type: 'generate_video_prompts',
      status: 'queued',
      draftId,
      campaignId: null,
      input: { draftId, draftVersion: 1, language: 'th', platform: 'tiktok', clipSeconds: 8 },
    });
    expect(queue.enqueued).toEqual([{ jobId: job.id, attempt: 1 }]);
    const audit = await testDb.pool.query(
      `select metadata from audit_events where resource_id = $1 and action = 'job.create'`,
      [job.id],
    );
    expect(JSON.stringify(audit.rows)).not.toContain('พัดลม'); // ids and counts only, no product text
  });

  it('replays the same key with 200 and no second job, and refuses the key for another request', async () => {
    const { draftId } = await seedDraft(alice);
    const key = newKey();
    const first = await videoPrompts(alice, { draftId, draftVersion: 1 }, key);
    const again = await videoPrompts(alice, { draftId, draftVersion: 1 }, key);
    expect(first.statusCode).toBe(202);
    expect(again.statusCode).toBe(200);
    expect(again.json().id).toBe(first.json().id);
    const other = await seedDraft(alice);
    const conflict = await videoPrompts(alice, { draftId: other.draftId, draftVersion: 1 }, key);
    expect(conflict.statusCode).toBe(409);
    expect(ErrorBodySchema.parse(conflict.json()).error.code).toBe('IDEMPOTENCY_CONFLICT');
    const rows = await testDb.db.select().from(schema.jobs).where(eq(schema.jobs.draftId, draftId));
    expect(rows.filter((row) => row.type === 'generate_video_prompts')).toHaveLength(1);
  });

  it('treats the same key for a newer draft version as a different request', async () => {
    const { draftId } = await seedDraft(alice);
    const key = newKey();
    expect((await videoPrompts(alice, { draftId, draftVersion: 1 }, key)).statusCode).toBe(202);
    await testDb.pool.query('update content_drafts set version = 2 where id = $1', [draftId]);
    const reused = await videoPrompts(alice, { draftId, draftVersion: 2 }, key);
    expect(reused.statusCode).toBe(409);
    expect(ErrorBodySchema.parse(reused.json()).error.code).toBe('IDEMPOTENCY_CONFLICT');
  });

  it('refuses a draft version the person was not looking at', async () => {
    const { draftId } = await seedDraft(alice);
    const stale = await videoPrompts(alice, { draftId, draftVersion: 2 });
    expect(stale.statusCode).toBe(409);
    expect(ErrorBodySchema.parse(stale.json()).error.code).toBe('CONFLICT');
  });

  it('validates the body and the key', async () => {
    const { draftId } = await seedDraft(alice);
    const bad: unknown[] = [
      {},
      { draftId },
      { draftId, draftVersion: 0 },
      { draftId, draftVersion: 1.5 },
      { draftId, draftVersion: 1, extra: 1 },
      { draftId: '', draftVersion: 1 },
    ];
    for (const body of bad) {
      expect((await videoPrompts(alice, body)).statusCode, JSON.stringify(body)).toBe(400);
    }
    expect((await videoPrompts(alice, { draftId, draftVersion: 1 }, null)).statusCode).toBe(400);
    expect((await videoPrompts(alice, { draftId, draftVersion: 1 }, 'short')).statusCode).toBe(400);
  });

  it('refuses an unknown draft, a stranger, a read-only member and an archived campaign', async () => {
    const mine = await seedDraft(alice);
    const body = { draftId: mine.draftId, draftVersion: 1 };
    expect(
      (
        await videoPrompts(alice, {
          draftId: '00000000-0000-4000-8000-000000000000',
          draftVersion: 1,
        })
      ).statusCode,
    ).toBe(400);
    // Bob names Alice's draft inside his own workspace: it does not exist there.
    expect((await videoPrompts(bob, body)).statusCode).toBe(400);
    const foreign = await call(
      bob,
      'POST',
      `${base(alice.workspaceId)}/jobs/generate-video-prompts`,
      {
        payload: body,
        key: newKey(),
      },
    );
    expect(foreign.statusCode).toBe(404);
    for (const person of [viewer, reviewer]) {
      const response = await call(
        person,
        'POST',
        `${base(alice.workspaceId)}/jobs/generate-video-prompts`,
        { payload: body, key: newKey() },
      );
      expect(response.statusCode).toBe(403);
    }
    const archived = await seedDraft(alice, { campaignStatus: 'archived' });
    expect(
      (await videoPrompts(alice, { draftId: archived.draftId, draftVersion: 1 })).statusCode,
    ).toBe(409);
    expect((await videoPrompts(null, body)).statusCode).toBe(401);
    const rows = await testDb.db
      .select()
      .from(schema.jobs)
      .where(eq(schema.jobs.type, 'generate_video_prompts'));
    expect(rows.filter((row) => row.draftId === mine.draftId)).toHaveLength(0);
    expect(rows.filter((row) => row.draftId === archived.draftId)).toHaveLength(0);
  });
});
