import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { buffer as readAll } from 'node:stream/consumers';

import { MockTextProvider } from '@creatorops/provider-core';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildApp } from '../../app.js';
import { loadConfig } from '../../platform/config.js';
import { createLogger } from '../../platform/logger.js';
import { requireDatabaseUrl, validEnv } from '../../test/db-url.js';
import { RecordingJobQueue } from '../../test/job-queue.js';
import { createPerson, type Person } from '../../test/people.js';
import { testStorage } from '../../test/storage.js';
import { createTestDb, type TestDb } from '../../test/test-db.js';
import type { Storage } from '../../storage/storage.js';
import { processJob, type WorkerDeps } from './process.js';

const HAS_FFMPEG = (() => {
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();
if (!HAS_FFMPEG && process.env.SKIP_FFMPEG_TESTS !== '1') {
  throw new Error(
    'ffmpeg is not installed. Install it (see docs/USER_GUIDE.md) or set SKIP_FFMPEG_TESTS=1 to skip the video tests on purpose.',
  );
}

const config = loadConfig(validEnv());
const silent = createLogger({ level: 'silent' });
const quiet = { info: () => undefined, warn: () => undefined, error: () => undefined };
const TOOLS = { ffmpeg: 'ffmpeg', ffprobe: 'ffprobe', subtitleFont: 'Loma' };

let testDb: TestDb;
let app: FastifyInstance;
let queue: RecordingJobQueue;
const storage = testStorage();
let alice: Person;
let clipDir = '';
let silentClip: Buffer;
let soundClip: Buffer;
let counter = 0;

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
  alice = await createPerson(testDb.db, config.SESSION_SECRET, 'assemble-alice');
  if (HAS_FFMPEG) {
    clipDir = mkdtempSync(path.join(os.tmpdir(), 'assemble-clips-'));
    execFileSync('ffmpeg', [
      '-v',
      'error',
      '-f',
      'lavfi',
      '-i',
      'testsrc=size=640x360:rate=25:duration=1',
      '-pix_fmt',
      'yuv420p',
      path.join(clipDir, 'a.mp4'),
    ]);
    execFileSync('ffmpeg', [
      '-v',
      'error',
      '-f',
      'lavfi',
      '-i',
      'testsrc2=size=720x1280:rate=30:duration=1',
      '-f',
      'lavfi',
      '-i',
      'sine=duration=1',
      '-shortest',
      '-pix_fmt',
      'yuv420p',
      path.join(clipDir, 'b.mp4'),
    ]);
    silentClip = readFileSync(path.join(clipDir, 'a.mp4'));
    soundClip = readFileSync(path.join(clipDir, 'b.mp4'));
  }
});

afterAll(async () => {
  await app.close();
  await testDb.drop();
  if (clipDir !== '') rmSync(clipDir, { recursive: true, force: true });
});

const deps = (overrides: Partial<WorkerDeps> = {}): WorkerDeps => ({
  db: testDb.db,
  provider: new MockTextProvider(),
  queue,
  log: quiet,
  storage,
  videoTools: TOOLS,
  random: () => 0,
  ...overrides,
});

const sql = (text: string, values: unknown[] = []) => testDb.pool.query(text, values);
async function one(text: string, values: unknown[]): Promise<string> {
  return (await sql(text, values)).rows[0].id as string;
}

async function newDraft(): Promise<{ draftId: string; productId: string }> {
  const productId = await one(
    'insert into products (workspace_id, name) values ($1, $2) returning id',
    [alice.workspaceId, 'โคมไฟ'],
  );
  const campaign = await one(
    `insert into campaigns (workspace_id, product_id, name, template_id, template_version, language, duration_seconds, created_by)
     values ($1, $2, 'C', 'product-showcase', 1, 'th', 30, $3) returning id`,
    [alice.workspaceId, productId, alice.userId],
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
  const draftId = await one(
    `insert into content_drafts (workspace_id, campaign_id, product_id, sections, section_state) values ($1, $2, $3, $4, $5) returning id`,
    [alice.workspaceId, campaign, productId, JSON.stringify(sections), JSON.stringify(state)],
  );
  return { draftId, productId };
}

/** A real MP4 in storage, attached to the draft for a scene. */
async function attachClip(
  draftId: string,
  scene: string,
  bytes: Buffer,
  order: number,
): Promise<string> {
  const key = `ws/${alice.workspaceId}/${randomUUID()}/original.mp4`;
  await storage.put(key, Readable.from([bytes]));
  const assetId = await one(
    `insert into assets (workspace_id, type, status, mime_type, size_bytes, original_filename, sha256, storage_key, created_by)
     values ($1, 'video', 'ready', 'video/mp4', $2, 'clip.mp4', $3, $4, $5) returning id`,
    [
      alice.workspaceId,
      bytes.length,
      createHash('sha256').update(bytes).digest('hex'),
      key,
      alice.userId,
    ],
  );
  await sql(
    `insert into draft_assets (workspace_id, draft_id, asset_id, role, sort_order, scene, ai_generated, generator, created_by)
     values ($1, $2, $3, 'media', $4, $5, true, 'Google Flow', $6)`,
    [alice.workspaceId, draftId, assetId, order, scene, alice.userId],
  );
  return assetId;
}

async function savePrompts(draftId: string, draftVersion: number) {
  counter += 1;
  const scenes = ['product_hero', 'detail', 'usage', 'final_shot'].map((scene) => ({
    scene,
    prompt: `prompt ${scene}`,
    voiceover: scene === 'product_hero' ? 'แนะนำโคมไฟตั้งโต๊ะถนอมสายตา' : `เสียง ${scene}`,
  }));
  await sql(
    `insert into jobs (workspace_id, type, status, input, output, created_by, idempotency_key, request_hash, draft_id, attempts, started_at, finished_at)
     values ($1, 'generate_video_prompts', 'succeeded', '{}', $2, $3, $4, repeat('c', 64), $5, 1, now(), now())`,
    [
      alice.workspaceId,
      JSON.stringify({ draftId, draftVersion, model: 'm', scenes }),
      alice.userId,
      `vp-${String(counter)}-${randomUUID()}`,
      draftId,
    ],
  );
}

async function start(draftId: string, draftVersion = 1) {
  counter += 1;
  return app.inject({
    method: 'POST',
    url: `/api/v1/workspaces/${alice.workspaceId}/jobs/assemble-video`,
    headers: {
      authorization: `Bearer ${alice.token}`,
      'idempotency-key': `assemble-${String(counter)}-${randomUUID()}`,
    },
    payload: { draftId, draftVersion },
  });
}

const job = async (id: string) => (await sql('select * from jobs where id = $1', [id])).rows[0];
const links = async (draftId: string) =>
  (await sql('select * from draft_assets where draft_id = $1 order by sort_order', [draftId])).rows;

describe.skipIf(!HAS_FFMPEG)('assemble_video job (D-086)', () => {
  it('joins the scene clips in scene order, with subtitles, and attaches the final video last', async () => {
    const { draftId, productId } = await newDraft();
    await attachClip(draftId, 'detail', soundClip, 0);
    await attachClip(draftId, 'product_hero', silentClip, 1);
    await savePrompts(draftId, 1);
    const created = await start(draftId);
    expect(created.statusCode, created.body).toBe(202);
    const jobId = created.json().id as string;
    expect((await job(jobId)).input.clips.map((c: { scene: string }) => c.scene)).toEqual([
      'product_hero',
      'detail',
    ]);

    expect(await processJob(deps(), jobId)).toBe('succeeded');
    const row = await job(jobId);
    expect(row.output).toMatchObject({
      clipCount: 2,
      subtitles: true,
      skippedScenes: ['usage', 'final_shot'],
    });
    expect(String(row.output.srt).replace(/\n/g, '')).toContain('แนะนำโคมไฟตั้งโต๊ะถนอมสายตา');
    const asset = (await sql('select * from assets where id = $1', [row.output.assetId])).rows[0];
    expect(asset).toMatchObject({
      type: 'video',
      mime_type: 'video/mp4',
      width: 1080,
      height: 1920,
      source: 'generated',
      product_id: productId,
    });
    const stored = await readAll(await storage.read(asset.storage_key));
    expect(createHash('sha256').update(stored).digest('hex')).toBe(asset.sha256);
    const attached = await links(draftId);
    expect(attached.at(-1)).toMatchObject({
      asset_id: asset.id,
      scene: null,
      generator: 'CreatorOps',
      ai_generated: true,
    });
  });

  it('replaces the previous final video on the draft; the old one stays in the library', async () => {
    const { draftId } = await newDraft();
    await attachClip(draftId, 'product_hero', soundClip, 0);
    const first = (await start(draftId)).json().id as string;
    expect(await processJob(deps(), first)).toBe('succeeded');
    const second = (await start(draftId)).json().id as string;
    expect(await processJob(deps(), second)).toBe('succeeded');
    const finals = (await links(draftId)).filter((l) => l.generator === 'CreatorOps');
    expect(finals).toHaveLength(1);
    expect(finals[0].asset_id).toBe((await job(second)).output.assetId);
    const old = (
      await sql('select status from assets where id = $1', [(await job(first)).output.assetId])
    ).rows[0];
    expect(old.status).toBe('ready');
  });

  it('makes the video without subtitles when the voiceover lines are for an older draft version', async () => {
    const { draftId } = await newDraft();
    await attachClip(draftId, 'product_hero', soundClip, 0);
    await sql('update content_drafts set version = 2 where id = $1', [draftId]);
    await savePrompts(draftId, 1);
    const jobId = (await start(draftId, 2)).json().id as string;
    expect(await processJob(deps(), jobId)).toBe('succeeded');
    expect((await job(jobId)).output).toMatchObject({ subtitles: false, srt: '' });
  });

  it('refuses at once when the draft has no scene video', async () => {
    const { draftId } = await newDraft();
    const response = await start(draftId);
    expect(response.statusCode).toBe(409);
    expect(response.json().error.message).toContain('no scene videos');
  });

  it('fails for good when a clip was removed from the draft after the click, storing nothing', async () => {
    const { draftId } = await newDraft();
    const clip = await attachClip(draftId, 'product_hero', soundClip, 0);
    const jobId = (await start(draftId)).json().id as string;
    await sql('delete from draft_assets where asset_id = $1', [clip]);
    const before = Number(
      (await sql("select count(*) from assets where source = 'generated'")).rows[0].count,
    );
    expect(await processJob(deps(), jobId)).toBe('failed');
    expect(await job(jobId)).toMatchObject({ error_code: 'ASSET_UNAVAILABLE', attempts: 1 });
    expect(
      Number((await sql("select count(*) from assets where source = 'generated'")).rows[0].count),
    ).toBe(before);
  });

  it('fails for good, with a plain message, when ffmpeg is not installed', async () => {
    const { draftId } = await newDraft();
    await attachClip(draftId, 'product_hero', soundClip, 0);
    const jobId = (await start(draftId)).json().id as string;
    const outcome = await processJob(
      deps({ videoTools: { ...TOOLS, ffprobe: '/no/such/ffprobe', ffmpeg: '/no/such/ffmpeg' } }),
      jobId,
    );
    expect(outcome).toBe('failed');
    const row = await job(jobId);
    expect(row).toMatchObject({ error_code: 'VIDEO_TOOL_MISSING', attempts: 1 });
    expect(row.error_message).toContain('ffmpeg');
  });

  it('fails for good, naming the encoder, when the ffmpeg build has no libx264', async () => {
    const { draftId } = await newDraft();
    await attachClip(draftId, 'product_hero', soundClip, 0);
    const jobId = (await start(draftId)).json().id as string;
    const tools = { ...TOOLS, capabilities: { h264: false, subtitles: true } };
    expect(await processJob(deps({ videoTools: tools }), jobId)).toBe('failed');
    const row = await job(jobId);
    expect(row).toMatchObject({ error_code: 'VIDEO_FAILED', attempts: 1 });
    expect(row.error_message).toContain('libx264');
  });

  it('without the subtitles filter, still makes the video and offers the .srt', async () => {
    const { draftId } = await newDraft();
    await attachClip(draftId, 'product_hero', soundClip, 0);
    await savePrompts(draftId, 1);
    const jobId = (await start(draftId)).json().id as string;
    const tools = { ...TOOLS, capabilities: { h264: true, subtitles: false } };
    expect(await processJob(deps({ videoTools: tools }), jobId)).toBe('succeeded');
    const output = (await job(jobId)).output;
    expect(output).toMatchObject({ subtitles: false, subtitleIssue: 'no_subtitle_filter' });
    expect(String(output.srt).replace(/\n/g, '')).toContain('แนะนำโคมไฟตั้งโต๊ะถนอมสายตา');
  });

  it('running out of time fails for good with a video message, not a retried text-provider timeout', async () => {
    const { draftId } = await newDraft();
    await attachClip(draftId, 'product_hero', soundClip, 0);
    const jobId = (await start(draftId)).json().id as string;
    expect(await processJob(deps({ settings: { videoTimeoutMs: 1 } }), jobId)).toBe('failed');
    const row = await job(jobId);
    expect(row).toMatchObject({ error_code: 'VIDEO_FAILED', attempts: 1 });
    expect(row.error_message).toContain('took too long');
  });

  it('a worker that lost its lease attaches nothing and removes the file it wrote', async () => {
    const { draftId } = await newDraft();
    await attachClip(draftId, 'product_hero', soundClip, 0);
    const jobId = (await start(draftId)).json().id as string;
    let writtenKey = '';
    // Another worker takes the job over right when this one writes the final file.
    const takingOver: Storage = Object.assign(
      Object.create(Object.getPrototypeOf(storage)),
      storage,
      {
        put: async (key: string, source: Readable) => {
          writtenKey = key;
          const stored = await storage.put(key, source);
          await sql(
            "update jobs set attempts = 2, locked_until = now() + interval '10 minutes' where id = $1",
            [jobId],
          );
          return stored;
        },
      },
    );
    expect(await processJob(deps({ storage: takingOver }), jobId)).toBe('lost');
    expect(writtenKey).not.toBe('');
    await expect(storage.read(writtenKey)).rejects.toThrow();
    expect((await links(draftId)).filter((l) => l.generator === 'CreatorOps')).toHaveLength(0);
  });
});
