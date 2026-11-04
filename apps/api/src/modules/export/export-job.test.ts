import { createHash, randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';

import { MockTextProvider, type DraftSections } from '@creatorops/provider-core';
import { buffer as readAll } from 'node:stream/consumers';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { buildApp } from '../../app.js';
import { loadConfig } from '../../platform/config.js';
import { createLogger } from '../../platform/logger.js';
import { requireDatabaseUrl, validEnv } from '../../test/db-url.js';
import { RecordingJobQueue } from '../../test/job-queue.js';
import { createPerson, type Person } from '../../test/people.js';
import { testStorage } from '../../test/storage.js';
import { createTestDb, type TestDb } from '../../test/test-db.js';
import { readZip } from '../../test/zip-reader.js';
import { processJob, type WorkerDeps } from '../jobs/process.js';
import { buildExport, exportStorageKey } from '../jobs/export-package.js';

const config = loadConfig(validEnv());
const silent = createLogger({ level: 'silent' });
const quiet = { info: () => undefined, warn: () => undefined, error: () => undefined };

let testDb: TestDb;
let app: FastifyInstance;
let queue: RecordingJobQueue;
const storage = testStorage();
let alice: Person;
let bob: Person;
let viewer: Person;

beforeAll(async () => {
  testDb = await createTestDb(requireDatabaseUrl());
  queue = new RecordingJobQueue();
  app = await buildApp({
    config,
    logger: silent,
    db: testDb.db,
    storage,
    jobQueue: queue,
    rateLimitMax: 100000,
    jobCreateRateLimitMax: 100000,
  });
  alice = await createPerson(testDb.db, config.SESSION_SECRET, 'export-alice');
  bob = await createPerson(testDb.db, config.SESSION_SECRET, 'export-bob');
  viewer = await createPerson(testDb.db, config.SESSION_SECRET, 'export-viewer');
  await testDb.pool.query(
    'insert into workspace_members (workspace_id, user_id, role) values ($1, $2, $3)',
    [alice.workspaceId, viewer.userId, 'viewer'],
  );
});

afterAll(async () => {
  await app.close();
  await testDb.drop();
});

beforeEach(async () => {
  queue.enqueued.length = 0;
  await testDb.pool.query('delete from draft_exports');
  await testDb.pool.query("delete from jobs where type = 'export_package'");
});

const workerDeps = (overrides: Partial<WorkerDeps> = {}): WorkerDeps => ({
  db: testDb.db,
  provider: new MockTextProvider(),
  queue,
  log: quiet,
  storage,
  random: () => 0,
  ...overrides,
});

const SECTIONS: DraftSections = {
  title: 'พัดลมพกพา',
  hook: 'ลมแรงในกระเป๋า',
  script: 'พัดลมตัวเล็กใช้ได้ทุกที่',
  storyboard: ['ฉากที่ 1 โชว์สินค้า', 'ฉากที่ 2 ใช้งานจริง'],
  caption: 'พัดลมพกพา ใช้ง่าย ชาร์จได้',
  hashtags: ['#พัดลม', '#ของมันต้องมี'],
  callToAction: 'สั่งซื้อได้เลย',
};
const STATE = Object.fromEntries(
  Object.keys(SECTIONS).map((name) => [name, { rev: 1, origin: 'generated', jobId: null }]),
);

async function one(sql: string, values: unknown[]): Promise<string> {
  return (await testDb.pool.query<{ id: string }>(sql, values)).rows[0]!.id;
}

async function newDraft(person: Person, sections: DraftSections = SECTIONS) {
  const product = await one(
    'insert into products (workspace_id, name) values ($1, $2) returning id',
    [person.workspaceId, 'P'],
  );
  const campaign = await one(
    `insert into campaigns (workspace_id, product_id, name, template_id, template_version, language, duration_seconds, created_by)
     values ($1, $2, 'C', 'product-showcase', 1, 'th', 30, $3) returning id`,
    [person.workspaceId, product, person.userId],
  );
  return one(
    `insert into content_drafts (workspace_id, campaign_id, product_id, sections, section_state)
     values ($1, $2, $3, $4, $5) returning id`,
    [person.workspaceId, campaign, product, JSON.stringify(sections), JSON.stringify(STATE)],
  );
}

interface Seeded {
  id: string;
  bytes: Buffer;
  key: string;
}

/** A ready file whose bytes really are in storage, with the hash and size the row records. */
async function newFile(
  person: Person,
  options: { mime?: string; bytes?: Buffer; store?: boolean } = {},
): Promise<Seeded> {
  const mime = options.mime ?? 'image/png';
  const bytes = options.bytes ?? Buffer.from(randomUUID().repeat(40));
  const key = `ws/${person.workspaceId}/${randomUUID()}/original`;
  if (options.store !== false) await storage.put(key, Readable.from([bytes]));
  const id = await one(
    `insert into assets (workspace_id, type, status, mime_type, size_bytes, original_filename, sha256, storage_key, created_by)
     values ($1, $2, 'ready', $3, $4, 'ไฟล์.png', $5, $6, $7) returning id`,
    [
      person.workspaceId,
      mime.startsWith('video') ? 'video' : 'image',
      mime,
      bytes.length,
      createHash('sha256').update(bytes).digest('hex'),
      key,
      person.userId,
    ],
  );
  return { id, bytes, key };
}

async function attach(person: Person, draftId: string, assets: unknown[]) {
  const response = await app.inject({
    method: 'PUT',
    url: `/api/v1/workspaces/${person.workspaceId}/drafts/${draftId}/assets`,
    headers: { authorization: `Bearer ${person.token}` },
    payload: { assets },
  });
  expect(response.statusCode, response.body).toBe(200);
}

let keyCounter = 0;
const exportRequest = (
  person: Person,
  payload: unknown,
  key: string = `export-key-${String((keyCounter += 1))}-${randomUUID()}`,
) =>
  app.inject({
    method: 'POST',
    url: `/api/v1/workspaces/${person.workspaceId}/jobs/export-package`,
    headers: { authorization: `Bearer ${person.token}`, 'idempotency-key': key },
    payload: payload as object,
  });

async function createExport(person: Person, draftId: string, draftVersion = 1) {
  const response = await exportRequest(person, { draftId, draftVersion });
  expect(response.statusCode, response.body).toBe(202);
  return response.json<{ id: string }>().id;
}

const jobRow = async (id: string) =>
  (await testDb.pool.query('select * from jobs where id = $1', [id])).rows[0];

describe('creating an export job', () => {
  it('answers 202, snapshots the text and the attached files, and queues the job', async () => {
    const draft = await newDraft(alice);
    const cover = await newFile(alice);
    const clip = await newFile(alice, { mime: 'video/mp4' });
    await attach(alice, draft, [
      { assetId: cover.id, role: 'cover', scene: 'product_hero' },
      { assetId: clip.id, scene: 'usage', aiGenerated: true, generator: 'Meta AI' },
    ]);
    const response = await exportRequest(alice, { draftId: draft, draftVersion: 1 });
    expect(response.statusCode, response.body).toBe(202);
    const job = response.json<{ id: string; type: string; status: string; draftId: string }>();
    expect(job).toMatchObject({ type: 'export_package', status: 'queued', draftId: draft });
    expect(queue.enqueued.map((item) => item.jobId)).toEqual([job.id]);

    const input = (await jobRow(job.id)).input;
    expect(input.sections).toEqual(SECTIONS);
    expect(input.draftVersion).toBe(1);
    expect(input.media).toEqual([
      expect.objectContaining({
        assetId: cover.id,
        role: 'cover',
        scene: 'product_hero',
        aiGenerated: false,
      }),
      expect.objectContaining({
        assetId: clip.id,
        scene: 'usage',
        aiGenerated: true,
        generator: 'Meta AI',
        sizeBytes: clip.bytes.length,
        sha256: createHash('sha256').update(clip.bytes).digest('hex'),
      }),
    ]);
  });

  it('replays the same request with the same key (200, one job) and refuses another request on that key', async () => {
    const draft = await newDraft(alice);
    const other = await newDraft(alice);
    const first = await exportRequest(
      alice,
      { draftId: draft, draftVersion: 1 },
      'export-replay-key',
    );
    const again = await exportRequest(
      alice,
      { draftId: draft, draftVersion: 1 },
      'export-replay-key',
    );
    expect(first.statusCode).toBe(202);
    expect(again.statusCode).toBe(200);
    expect(again.json<{ id: string }>().id).toBe(first.json<{ id: string }>().id);
    const clash = await exportRequest(
      alice,
      { draftId: other, draftVersion: 1 },
      'export-replay-key',
    );
    expect(clash.statusCode).toBe(409);
    expect(clash.json<{ error: { code: string } }>().error.code).toBe('IDEMPOTENCY_CONFLICT');
    expect(queue.enqueued).toHaveLength(1);
  });

  it('refuses a draft version that is not the current one (409)', async () => {
    const draft = await newDraft(alice);
    const response = await exportRequest(alice, { draftId: draft, draftVersion: 2 });
    expect(response.statusCode).toBe(409);
    expect(queue.enqueued).toHaveLength(0);
  });

  it("refuses another workspace's draft with a plain validation error, and a read-only member with 403", async () => {
    const theirs = await newDraft(bob);
    const stranger = await exportRequest(alice, { draftId: theirs, draftVersion: 1 });
    expect(stranger.statusCode).toBe(400);
    const mine = await newDraft(alice);
    const forbidden = await app.inject({
      method: 'POST',
      url: `/api/v1/workspaces/${alice.workspaceId}/jobs/export-package`,
      headers: { authorization: `Bearer ${viewer.token}`, 'idempotency-key': 'viewer-export-key' },
      payload: { draftId: mine, draftVersion: 1 },
    });
    expect(forbidden.statusCode).toBe(403);
    expect(queue.enqueued).toHaveLength(0);
  });

  it('refuses when the attached files are over the size cap, and when the workspace holds 20 live packages', async () => {
    const draft = await newDraft(alice);
    const huge = await newFile(alice, { store: false });
    await testDb.pool.query('update assets set size_bytes = $1 where id = $2', [
      600 * 1024 * 1024,
      huge.id,
    ]);
    await attach(alice, draft, [{ assetId: huge.id }]);
    expect((await exportRequest(alice, { draftId: draft, draftVersion: 1 })).statusCode).toBe(409);

    const plain = await newDraft(alice);
    for (let i = 0; i < 20; i += 1) {
      const jobId = await one(
        `insert into jobs (workspace_id, type, status, input, output, created_by, idempotency_key, request_hash, draft_id, attempts, started_at, finished_at)
         values ($1, 'export_package', 'succeeded', '{}', '{}', $2, $3, repeat('b', 64), $4, 1, now(), now()) returning id`,
        [alice.workspaceId, alice.userId, `seed-live-${String(i)}-${randomUUID()}`, plain],
      );
      await testDb.pool.query(
        `insert into draft_exports (workspace_id, draft_id, job_id, created_by, draft_version, file_count, size_bytes, sha256, filename, storage_key, manifest, expires_at)
         values ($1, $2, $3, $4, 1, 1, 1, repeat('c', 64), 'x.zip', $5, '{}', now() + interval '1 day')`,
        [alice.workspaceId, plain, jobId, alice.userId, `exports/seed/${randomUUID()}.zip`],
      );
    }
    const capped = await exportRequest(alice, { draftId: plain, draftVersion: 1 });
    expect(capped.statusCode).toBe(429);
  });
});

describe('building the package', () => {
  it('writes a zip with the media and the Thai text, records the row in the settling transaction', async () => {
    const draft = await newDraft(alice);
    const cover = await newFile(alice);
    const clip = await newFile(alice, { mime: 'video/mp4' });
    await attach(alice, draft, [
      { assetId: cover.id, role: 'cover', scene: 'product_hero' },
      { assetId: clip.id, scene: 'usage', aiGenerated: true, generator: 'Meta AI' },
    ]);
    const jobId = await createExport(alice, draft);

    expect(await processJob(workerDeps(), jobId)).toBe('succeeded');

    const job = await jobRow(jobId);
    expect(job.status).toBe('succeeded');
    const rows = (await testDb.pool.query('select * from draft_exports where job_id = $1', [jobId]))
      .rows;
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row.status).toBe('ready');
    expect(row.draft_version).toBe(1);
    expect(row.storage_key).toBe(exportStorageKey(alice.workspaceId, jobId));
    expect(row.filename).toMatch(/^creatorops-\d{8}-[0-9a-f]{8}\.zip$/);
    expect(job.output).toMatchObject({ exportId: row.id, draftId: draft });
    const days = (new Date(row.expires_at).getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(6.9);
    expect(days).toBeLessThan(7.1);

    const zip = await readAll(await storage.read(row.storage_key));
    expect(zip.length).toBe(Number(row.size_bytes));
    expect(createHash('sha256').update(zip).digest('hex')).toBe(row.sha256);
    const entries = readZip(zip);
    const byName = new Map(entries.map((entry) => [entry.name, entry.data]));
    expect([...byName.keys()].sort()).toEqual(
      [
        'caption.txt',
        'draft.txt',
        'hashtags.txt',
        'manifest.json',
        'media/01-cover.png',
        'media/02-usage.mp4',
        'publishing-checklist.md',
      ].sort(),
    );
    expect(byName.get('media/01-cover.png')?.equals(cover.bytes)).toBe(true);
    expect(byName.get('media/02-usage.mp4')?.equals(clip.bytes)).toBe(true);
    expect(byName.get('caption.txt')?.toString('utf8')).toBe(SECTIONS.caption + '\n');
    expect(byName.get('hashtags.txt')?.toString('utf8')).toBe('#พัดลม #ของมันต้องมี\n');
    expect(byName.get('draft.txt')?.toString('utf8')).toContain('1. ฉากที่ 1 โชว์สินค้า');
    const checklist = byName.get('publishing-checklist.md')?.toString('utf8') ?? '';
    expect(checklist).toContain('Meta AI');
    expect(checklist).toContain('ยังไม่ได้รับการอนุมัติ');
    const manifest = JSON.parse(byName.get('manifest.json')?.toString('utf8') ?? '{}') as {
      media: { path: string; aiGenerated: boolean; generator: string | null }[];
    };
    expect(manifest.media.map((item) => [item.path, item.aiGenerated, item.generator])).toEqual([
      ['media/01-cover.png', false, null],
      ['media/02-usage.mp4', true, 'Meta AI'],
    ]);
  });

  it('exports a draft with no attachments (text only)', async () => {
    const draft = await newDraft(alice);
    const jobId = await createExport(alice, draft);
    expect(await processJob(workerDeps(), jobId)).toBe('succeeded');
    const key = exportStorageKey(alice.workspaceId, jobId);
    const names = readZip(await readAll(await storage.read(key))).map((entry) => entry.name);
    expect(names).toContain('caption.txt');
    expect(names.some((name) => name.startsWith('media/'))).toBe(false);
  });

  it('uses the text snapshotted at creation, not a later edit', async () => {
    const draft = await newDraft(alice);
    const jobId = await createExport(alice, draft);
    await testDb.pool.query(
      `update content_drafts set sections = jsonb_set(sections, '{caption}', '"แก้ทีหลัง"'), version = 2 where id = $1`,
      [draft],
    );
    expect(await processJob(workerDeps(), jobId)).toBe('succeeded');
    const entries = readZip(
      await readAll(await storage.read(exportStorageKey(alice.workspaceId, jobId))),
    );
    const caption = entries.find((entry) => entry.name === 'caption.txt')?.data.toString('utf8');
    expect(caption).toBe(SECTIONS.caption + '\n');
  });

  it('builds the same package again for a retry of the same job (same key, same bytes)', async () => {
    const draft = await newDraft(alice);
    const file = await newFile(alice);
    await attach(alice, draft, [{ assetId: file.id }]);
    const jobId = await createExport(alice, draft);
    const job = await testDb.db.query.jobs.findFirst({ where: (t, { eq }) => eq(t.id, jobId) });
    const signal = new AbortController().signal;
    const first = await buildExport(testDb.db, storage, job!, signal);
    const second = await buildExport(testDb.db, storage, job!, signal);
    expect(second.sha256).toBe(first.sha256);
    expect(second.storageKey).toBe(first.storageKey);
    expect((await storage.stat(first.storageKey))?.size).toBe(first.sizeBytes);
  });

  async function expectUnavailable(jobId: string, code = 'ASSET_UNAVAILABLE') {
    expect(await processJob(workerDeps(), jobId)).toBe('failed');
    const job = await jobRow(jobId);
    expect(job).toMatchObject({ status: 'failed', error_code: code, attempts: 1 });
    expect(
      (await testDb.pool.query('select 1 from draft_exports where job_id = $1', [jobId])).rowCount,
    ).toBe(0);
    expect(await storage.stat(exportStorageKey(alice.workspaceId, jobId))).toBeNull();
    expect(queue.enqueued).toHaveLength(1); // only the creation message: no retry
  }

  it('fails for good when a file is missing from storage', async () => {
    const draft = await newDraft(alice);
    const file = await newFile(alice, { store: false });
    await attach(alice, draft, [{ assetId: file.id }]);
    await expectUnavailable(await createExport(alice, draft));
  });

  it('fails for good when the stored bytes differ from the recorded hash', async () => {
    const draft = await newDraft(alice);
    const file = await newFile(alice);
    await attach(alice, draft, [{ assetId: file.id }]);
    const jobId = await createExport(alice, draft);
    await storage.delete(file.key);
    await storage.put(file.key, Readable.from([Buffer.alloc(file.bytes.length, 1)]));
    await expectUnavailable(jobId);
  });

  it.each([
    ['hash', `update assets set sha256 = repeat('d', 64) where id = $1`],
    ['size', `update assets set size_bytes = size_bytes + 1 where id = $1`],
  ])(
    'fails for good when the file record changed its %s after the job was created',
    async (_label, statement) => {
      const draft = await newDraft(alice);
      const file = await newFile(alice);
      await attach(alice, draft, [{ assetId: file.id }]);
      const jobId = await createExport(alice, draft);
      await testDb.pool.query(statement, [file.id]);
      await expectUnavailable(jobId);
    },
  );

  it('fails for good when a file was deleted after the job was created', async () => {
    const draft = await newDraft(alice);
    const file = await newFile(alice);
    await attach(alice, draft, [{ assetId: file.id }]);
    const jobId = await createExport(alice, draft);
    await testDb.pool.query(
      `update assets set status = 'deleted', deleted_at = now() where id = $1`,
      [file.id],
    );
    await expectUnavailable(jobId);
  });

  it('never reads a file of another workspace, even if the snapshot names it', async () => {
    const draft = await newDraft(alice);
    const theirs = await newFile(bob);
    const jobId = await createExport(alice, draft);
    const input = (await jobRow(jobId)).input as { media: unknown[] };
    input.media = [
      {
        assetId: theirs.id,
        role: 'media',
        scene: null,
        aiGenerated: false,
        generator: null,
        mimeType: 'image/png',
        sizeBytes: theirs.bytes.length,
        sha256: createHash('sha256').update(theirs.bytes).digest('hex'),
      },
    ];
    await testDb.pool.query('update jobs set input = $1 where id = $2', [
      JSON.stringify(input),
      jobId,
    ]);
    await expectUnavailable(jobId);
  });

  it('fails for good with EXPORT_TOO_LARGE when the snapshot is over the cap', async () => {
    const draft = await newDraft(alice);
    const jobId = await createExport(alice, draft);
    const input = (await jobRow(jobId)).input as { media: unknown[] };
    input.media = [
      {
        assetId: randomUUID(),
        role: 'media',
        scene: null,
        aiGenerated: false,
        generator: null,
        mimeType: 'video/mp4',
        sizeBytes: 600 * 1024 * 1024,
        sha256: 'a'.repeat(64),
      },
    ];
    await testDb.pool.query('update jobs set input = $1 where id = $2', [
      JSON.stringify(input),
      jobId,
    ]);
    await expectUnavailable(jobId, 'EXPORT_TOO_LARGE');
  });

  it('fails plainly when the worker has no storage, and when the snapshot does not match the job', async () => {
    const draft = await newDraft(alice);
    const noStorage = await createExport(alice, draft);
    expect(await processJob(workerDeps({ storage: undefined }), noStorage)).toBe('failed');
    expect(await jobRow(noStorage)).toMatchObject({ error_code: 'INTERNAL' });

    const mismatched = await createExport(alice, draft);
    await testDb.pool.query(
      `update jobs set input = jsonb_set(input, '{draftId}', to_jsonb($1::text)) where id = $2`,
      [randomUUID(), mismatched],
    );
    expect(await processJob(workerDeps(), mismatched)).toBe('failed');
    expect(await jobRow(mismatched)).toMatchObject({ error_code: 'INTERNAL' });
  });

  it('removes the file and records nothing when the job was cancelled while it ran', async () => {
    const draft = await newDraft(alice);
    const jobId = await createExport(alice, draft);
    await testDb.pool.query('update jobs set cancel_requested_at = now() where id = $1', [jobId]);
    expect(await processJob(workerDeps(), jobId)).toBe('cancelled');
    expect(
      (await testDb.pool.query('select 1 from draft_exports where job_id = $1', [jobId])).rowCount,
    ).toBe(0);
    expect(await storage.stat(exportStorageKey(alice.workspaceId, jobId))).toBeNull();
  });
});
