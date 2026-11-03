import { createHash } from 'node:crypto';

import {
  AssetListResponseSchema,
  AssetSchema,
  ErrorBodySchema,
  ProductSchema,
  UploadIntentSchema,
  type Asset,
} from '@creatorops/contracts';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildApp } from '../../app.js';
import { schema } from '../../db/client.js';
import { loadConfig } from '../../platform/config.js';
import { createLogger } from '../../platform/logger.js';
import { requireDatabaseUrl, validEnv } from '../../test/db-url.js';
import { createPerson, type Person } from '../../test/people.js';
import { testStorage } from '../../test/storage.js';
import { createTestDb, type TestDb } from '../../test/test-db.js';
import { resolveWorkspaceContext } from '../identity/service.js';
import { createAssetDeps } from './deps.js';
import { createUploadIntent, purgeDeletedAssets, sweepUploads, type AssetDeps } from './service.js';

const config = loadConfig(validEnv());
const silent = createLogger({ level: 'silent' });
const storage = testStorage();

let testDb: TestDb;
let app: FastifyInstance;
let deps: AssetDeps;
let alice: Person;
let bob: Person;
let viewer: Person;
let editor: Person;

beforeAll(async () => {
  testDb = await createTestDb(requireDatabaseUrl());
  // The default upload limit (30 a minute) would trip over this suite's many uploads.
  app = await buildApp({
    config,
    logger: silent,
    db: testDb.db,
    storage,
    uploadRateLimitMax: 100_000,
  });
  deps = createAssetDeps({ db: testDb.db, storage, sessionSecret: config.SESSION_SECRET });
  alice = await createPerson(testDb.db, config.SESSION_SECRET, 'alice');
  bob = await createPerson(testDb.db, config.SESSION_SECRET, 'bob');
  viewer = await createPerson(testDb.db, config.SESSION_SECRET, 'viewer');
  editor = await createPerson(testDb.db, config.SESSION_SECRET, 'editor');
  await testDb.db.insert(schema.workspaceMembers).values([
    { workspaceId: alice.workspaceId, userId: viewer.userId, role: 'viewer' },
    { workspaceId: alice.workspaceId, userId: editor.userId, role: 'editor' },
  ]);
});

afterAll(async () => {
  await app.close();
  await testDb.drop();
});

// ---- helpers -----------------------------------------------------------------------------------

const auth = (person: Person) => ({ authorization: `Bearer ${person.token}` });
const assetsUrl = (workspaceId: string) => `/api/v1/workspaces/${workspaceId}/assets`;
const productsUrl = (workspaceId: string) => `/api/v1/workspaces/${workspaceId}/products`;

async function png(width = 40, height = 30): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: { r: 200, g: 20, b: 20 } } })
    .png()
    .toBuffer();
}
async function jpeg(width = 40, height = 30): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: { r: 20, g: 200, b: 20 } } })
    .jpeg()
    .toBuffer();
}
const mp4 = (): Buffer =>
  Buffer.concat([
    Buffer.from([0, 0, 0, 0x18]),
    Buffer.from('ftypisom', 'latin1'),
    Buffer.alloc(300, 7),
  ]);

async function intent(
  person: Person,
  body: Record<string, unknown>,
  workspaceId = person.workspaceId,
) {
  return app.inject({
    method: 'POST',
    url: `${assetsUrl(workspaceId)}/upload-intent`,
    headers: auth(person),
    payload: body,
  });
}

async function declare(
  person: Person,
  mimeType: string,
  bytes: Buffer,
  extra: Record<string, unknown> = {},
) {
  const response = await intent(person, {
    filename: 'photo.png',
    mimeType,
    sizeBytes: bytes.length,
    ...extra,
  });
  expect(response.statusCode, response.body).toBe(201);
  return UploadIntentSchema.parse(response.json());
}

const put = (url: string, bytes: Buffer, contentType: string | undefined) =>
  app.inject({
    method: 'PUT',
    url,
    headers: contentType ? { 'content-type': contentType } : {},
    payload: bytes,
  });

async function complete(person: Person, intentId: string, workspaceId = person.workspaceId) {
  return app.inject({
    method: 'POST',
    url: `${assetsUrl(workspaceId)}/complete-upload`,
    headers: auth(person),
    payload: { intentId },
  });
}

/** Declares, uploads and completes in one go. */
async function upload(
  person: Person,
  mimeType: string,
  bytes: Buffer,
  extra: Record<string, unknown> = {},
): Promise<Asset> {
  const declared = await declare(person, mimeType, bytes, extra);
  const sent = await put(declared.uploadUrl, bytes, mimeType);
  expect(sent.statusCode, sent.body).toBe(204);
  const done = await complete(person, declared.intentId);
  expect(done.statusCode, done.body).toBe(200);
  return AssetSchema.parse(done.json());
}

const strip = (text: string) => text.replace(/"requestId":"[^"]+"/, '');

// ---- the happy path ------------------------------------------------------------------------------

describe('uploading an image', () => {
  it('goes declare -> PUT -> complete, then serves the original and a WebP thumbnail', async () => {
    const bytes = await png(1200, 800);
    const asset = await upload(alice, 'image/png', bytes, { filename: 'ผลิตภัณฑ์.png' });

    expect(asset).toMatchObject({
      workspaceId: alice.workspaceId,
      productId: null,
      type: 'image',
      status: 'ready',
      mimeType: 'image/png',
      sizeBytes: bytes.length,
      width: 1200,
      height: 800,
      originalFilename: 'ผลิตภัณฑ์.png',
      sha256: createHash('sha256').update(bytes).digest('hex'),
    });
    expect(asset.url).toMatch(
      /^\/api\/v1\/media\/[0-9a-f-]{36}\/original\?exp=\d+&sig=[A-Za-z0-9_-]{43}$/,
    );
    expect(asset.thumbUrl).toMatch(/\/thumb\?exp=\d+&sig=/);

    const original = await app.inject({ method: 'GET', url: asset.url });
    expect(original.statusCode).toBe(200);
    expect(original.rawPayload.equals(bytes)).toBe(true);
    expect(original.headers['content-type']).toBe('image/png');
    expect(original.headers['x-content-type-options']).toBe('nosniff');
    expect(original.headers['content-disposition']).toBe('inline; filename="asset.png"');
    expect(original.headers['cache-control']).toMatch(/^private, max-age=\d+$/);
    expect(original.headers['cross-origin-resource-policy']).toBe('cross-origin');
    expect(original.headers['accept-ranges']).toBe('bytes');

    const thumb = await app.inject({ method: 'GET', url: asset.thumbUrl ?? '' });
    expect(thumb.statusCode).toBe(200);
    expect(thumb.headers['content-type']).toBe('image/webp');
    const thumbInfo = await sharp(thumb.rawPayload).metadata();
    expect(thumbInfo.format).toBe('webp');
    expect(Math.max(thumbInfo.width ?? 0, thumbInfo.height ?? 0)).toBeLessThanOrEqual(512);
    expect(thumbInfo.exif).toBeUndefined();
  });

  it('stores files under server-chosen keys that never contain the user filename', async () => {
    const asset = await upload(alice, 'image/png', await png(), {
      filename: '../../etc/passwd; rm -rf.png',
    });
    const row = (
      await testDb.db.select().from(schema.assets).where(eq(schema.assets.id, asset.id))
    )[0];
    expect(row?.storageKey).toBe(`ws/${alice.workspaceId}/${asset.id}/original.png`);
    expect(row?.thumbnailKey).toBe(`ws/${alice.workspaceId}/${asset.id}/thumb.webp`);
    expect(row?.storageKey).not.toMatch(/passwd|rm|\.\./);
    expect(asset.originalFilename).toBe('passwd; rm -rf.png');
  });

  it('records an audit event for the new asset', async () => {
    const asset = await upload(alice, 'image/png', await png());
    const events = await testDb.db
      .select()
      .from(schema.auditEvents)
      .where(eq(schema.auditEvents.resourceId, asset.id));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      action: 'asset.created',
      actorUserId: alice.userId,
      workspaceId: alice.workspaceId,
    });
  });

  it('applies EXIF orientation to the reported size and strips metadata from the thumbnail', async () => {
    const rotated = await sharp({
      create: { width: 400, height: 200, channels: 3, background: { r: 1, g: 2, b: 3 } },
    })
      .jpeg()
      .withMetadata({ orientation: 6 })
      .toBuffer();
    const asset = await upload(alice, 'image/jpeg', rotated);
    expect([asset.width, asset.height]).toEqual([200, 400]);
    const thumb = await app.inject({ method: 'GET', url: asset.thumbUrl ?? '' });
    const info = await sharp(thumb.rawPayload).metadata();
    expect([info.width, info.height]).toEqual([200, 400]);
    expect(info.exif).toBeUndefined();
  });

  it('uses only the first frame of an animated GIF', async () => {
    const frame = (color: { r: number; g: number; b: number }) =>
      sharp({ create: { width: 30, height: 20, channels: 3, background: color } })
        .png()
        .toBuffer();
    const frames = await sharp(
      [await frame({ r: 255, g: 0, b: 0 }), await frame({ r: 0, g: 0, b: 255 })],
      {
        join: { animated: true },
      },
    )
      .gif()
      .toBuffer();
    expect((await sharp(frames, { animated: true }).metadata()).pages).toBe(2);
    const asset = await upload(alice, 'image/gif', frames);
    expect(asset.type).toBe('image');
    expect([asset.width, asset.height]).toEqual([30, 20]); // one frame, not the whole stack
    expect(asset.thumbUrl).not.toBeNull();
  });

  it('accepts JPEG and WebP too', async () => {
    expect((await upload(alice, 'image/jpeg', await jpeg())).mimeType).toBe('image/jpeg');
    const webp = await sharp({
      create: { width: 20, height: 20, channels: 3, background: { r: 5, g: 5, b: 5 } },
    })
      .webp()
      .toBuffer();
    expect((await upload(alice, 'image/webp', webp)).mimeType).toBe('image/webp');
  });
});

describe('uploading a video', () => {
  it('stores an MP4 without a thumbnail and serves byte ranges', async () => {
    const bytes = mp4();
    const asset = await upload(alice, 'video/mp4', bytes);
    expect(asset).toMatchObject({
      type: 'video',
      mimeType: 'video/mp4',
      width: null,
      height: null,
      thumbUrl: null,
    });

    const whole = await app.inject({ method: 'GET', url: asset.url });
    expect(whole.statusCode).toBe(200);
    expect(whole.headers['content-type']).toBe('video/mp4');

    const part = await app.inject({
      method: 'GET',
      url: asset.url,
      headers: { range: 'bytes=0-9' },
    });
    expect(part.statusCode).toBe(206);
    expect(part.headers['content-range']).toBe(`bytes 0-9/${bytes.length}`);
    expect(part.rawPayload.equals(bytes.subarray(0, 10))).toBe(true);

    const suffix = await app.inject({
      method: 'GET',
      url: asset.url,
      headers: { range: 'bytes=-5' },
    });
    expect(suffix.statusCode).toBe(206);
    expect(suffix.rawPayload.equals(bytes.subarray(bytes.length - 5))).toBe(true);

    const open = await app.inject({
      method: 'GET',
      url: asset.url,
      headers: { range: `bytes=${bytes.length - 4}-` },
    });
    expect(open.statusCode).toBe(206);
    expect(open.rawPayload.length).toBe(4);

    const beyond = await app.inject({
      method: 'GET',
      url: asset.url,
      headers: { range: `bytes=${bytes.length + 10}-` },
    });
    expect(beyond.statusCode).toBe(416);
    expect(beyond.headers['content-range']).toBe(`bytes */${bytes.length}`);

    const several = await app.inject({
      method: 'GET',
      url: asset.url,
      headers: { range: 'bytes=0-1,5-6' },
    });
    expect(several.statusCode).toBe(200); // unsupported form: everything is sent
    expect(several.rawPayload.length).toBe(bytes.length);

    const thumb = await app.inject({
      method: 'GET',
      url: asset.url.replace('/original', '/thumb'),
    });
    expect(thumb.statusCode).toBe(404);
  });
});

// ---- the file must be what it claims to be --------------------------------------------------------

describe('type and size checks while receiving', () => {
  async function expectRejected(
    declaredMime: string,
    bytes: Buffer,
    sentAs: string,
    status: number,
    declaredSize = bytes.length,
  ) {
    const response = await intent(alice, {
      filename: 'x',
      mimeType: declaredMime,
      sizeBytes: declaredSize,
    });
    const declared = UploadIntentSchema.parse(response.json());
    const sent = await put(declared.uploadUrl, bytes, sentAs);
    expect(sent.statusCode, sent.body).toBe(status);
    // Nothing is left behind, and the intent cannot be completed.
    const row = (
      await testDb.db
        .select()
        .from(schema.uploadIntents)
        .where(eq(schema.uploadIntents.id, declared.intentId))
    )[0];
    expect(row?.status).toBe('failed');
    expect((await complete(alice, declared.intentId)).statusCode).toBe(409);
    expect(
      await storage.stat(
        `ws/${alice.workspaceId}/${row?.assetId}/original.${declaredMime === 'video/mp4' ? 'mp4' : declaredMime.split('/')[1] === 'jpeg' ? 'jpg' : declaredMime.split('/')[1]}`,
      ),
    ).toBeNull();
  }
  it('rejects a JPEG sent as a PNG', async () => {
    await expectRejected('image/png', await jpeg(), 'image/png', 415);
  });

  it('rejects SVG, HTML and script content whatever type was declared', async () => {
    for (const text of [
      '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"></svg>'.padEnd(64, ' '),
      '<!DOCTYPE html><html><script>alert(1)</script></html>'.padEnd(64, ' '),
      '#!/bin/sh\nrm -rf /\n'.padEnd(64, ' '),
    ]) {
      await expectRejected('image/png', Buffer.from(text), 'image/png', 415);
    }
  });

  it('rejects an image sent as a video and a video sent as an image', async () => {
    await expectRejected('video/mp4', await png(), 'video/mp4', 415);
    await expectRejected('image/png', mp4(), 'image/png', 415);
  });

  it('rejects a file that is too short to identify', async () => {
    await expectRejected('image/png', Buffer.from('tiny'), 'image/png', 415);
  });

  it('rejects more bytes than were declared', async () => {
    const bytes = await png(60, 60);
    await expectRejected('image/png', bytes, 'image/png', 400, bytes.length - 10); // content-length differs from declared
  });

  it('rejects when the Content-Type header differs from the declared type', async () => {
    await expectRejected('image/png', await png(), 'image/jpeg', 415);
  });

  it('refuses a content type nobody declared (no parser), leaving the upload usable', async () => {
    const bytes = await png();
    const declared = await declare(alice, 'image/png', bytes);
    for (const type of ['application/octet-stream', 'text/html', 'image/svg+xml', undefined]) {
      const sent = await put(declared.uploadUrl, bytes, type);
      expect([415, 400], String(type)).toContain(sent.statusCode);
    }
    expect((await put(declared.uploadUrl, bytes, 'image/png')).statusCode).toBe(204);
  });

  it('refuses to declare disallowed types or oversized files', async () => {
    const bad: Record<string, unknown>[] = [
      { filename: 'a.svg', mimeType: 'image/svg+xml', sizeBytes: 100 },
      { filename: 'a.html', mimeType: 'text/html', sizeBytes: 100 },
      { filename: 'a.exe', mimeType: 'application/octet-stream', sizeBytes: 100 },
      { filename: 'a.png', mimeType: 'image/png', sizeBytes: 0 },
      { filename: 'a.png', mimeType: 'image/png', sizeBytes: 16 * 1024 * 1024 },
      { filename: 'a.mp4', mimeType: 'video/mp4', sizeBytes: 201 * 1024 * 1024 },
      { filename: '', mimeType: 'image/png', sizeBytes: 100 },
      { filename: 'x'.repeat(256), mimeType: 'image/png', sizeBytes: 100 },
      { filename: 'a.png', mimeType: 'image/png', sizeBytes: 100, workspaceId: bob.workspaceId },
      { filename: 'a.png', mimeType: 'image/png', sizeBytes: 100, userId: bob.userId },
    ];
    for (const body of bad) {
      const response = await intent(alice, body);
      expect(response.statusCode, JSON.stringify(body)).toBe(400);
    }
  });

  it('rejects an image that decodes to an absurd number of pixels (decompression bomb)', async () => {
    // 8000 x 8000 = 64 million pixels, over the 40 million limit, but tiny on disk.
    const bomb = await sharp({
      create: { width: 8000, height: 8000, channels: 3, background: { r: 0, g: 0, b: 0 } },
    })
      .png({ compressionLevel: 9 })
      .toBuffer();
    const declared = await declare(alice, 'image/png', bomb);
    expect((await put(declared.uploadUrl, bomb, 'image/png')).statusCode).toBe(204);
    const done = await complete(alice, declared.intentId);
    expect(done.statusCode).toBe(415);
    expect(ErrorBodySchema.parse(done.json()).error.message).toBe('The image could not be read.');
    const row = (
      await testDb.db
        .select()
        .from(schema.uploadIntents)
        .where(eq(schema.uploadIntents.id, declared.intentId))
    )[0];
    expect(row?.status).toBe('failed');
    expect(await storage.stat(row?.storageKey ?? 'x/none')).toBeNull();
  });

  it('rejects a corrupt image that has valid magic bytes', async () => {
    const corrupt = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.alloc(200, 1),
    ]);
    const declared = await declare(alice, 'image/png', corrupt);
    expect((await put(declared.uploadUrl, corrupt, 'image/png')).statusCode).toBe(204);
    expect((await complete(alice, declared.intentId)).statusCode).toBe(415);
  });
});

// ---- the signed upload URL ----------------------------------------------------------------------------

describe('signed upload URL', () => {
  it('rejects a tampered signature, a changed expiry, and malformed parameters', async () => {
    const bytes = await png();
    const declared = await declare(alice, 'image/png', bytes);
    const url = new URL(declared.uploadUrl, 'http://x');
    const sig = url.searchParams.get('sig') ?? '';
    const exp = Number(url.searchParams.get('exp'));

    const variants = [
      `${url.pathname}?exp=${exp}&sig=${sig.slice(0, -1)}${sig.endsWith('A') ? 'B' : 'A'}`,
      `${url.pathname}?exp=${exp + 3600}&sig=${sig}`,
      `${url.pathname}?exp=${exp}&sig=${'A'.repeat(43)}`,
      `${url.pathname}?exp=abc&sig=${sig}`,
      `${url.pathname}?exp=${exp}&sig=`,
      `${url.pathname}?exp=${exp}`,
      `${url.pathname}`,
    ];
    for (const variant of variants) {
      const response = await put(variant, bytes, 'image/png');
      expect([400, 403], variant).toContain(response.statusCode);
    }
    // The intent was never consumed by those attempts.
    expect((await put(declared.uploadUrl, bytes, 'image/png')).statusCode).toBe(204);
  });

  it('cannot be replayed against a different intent', async () => {
    const bytes = await png();
    const first = await declare(alice, 'image/png', bytes);
    const second = await declare(alice, 'image/png', bytes);
    const sig = new URL(first.uploadUrl, 'http://x').searchParams.get('sig');
    const exp = new URL(first.uploadUrl, 'http://x').searchParams.get('exp');
    const forged = `/api/v1/uploads/${second.intentId}?exp=${exp}&sig=${sig}`;
    expect((await put(forged, bytes, 'image/png')).statusCode).toBe(403);
  });

  it('refuses an expired link even though its signature is genuine', async () => {
    const ctx = await resolveWorkspaceContext(testDb.db, alice.userId, alice.workspaceId, 'r');
    if (!ctx) throw new Error('no context');
    const long_ago = () => new Date(Date.now() - 60 * 60 * 1000);
    const bytes = await png();
    const stale = await createUploadIntent({ ...deps, now: long_ago }, ctx, {
      filename: 'old.png',
      mimeType: 'image/png',
      sizeBytes: bytes.length,
    });
    const response = await put(stale.uploadUrl, bytes, 'image/png');
    expect(response.statusCode).toBe(403);
  });

  it('is single use: a second PUT with the same URL fails, and a double-click race has one winner', async () => {
    const bytes = await png();
    const declared = await declare(alice, 'image/png', bytes);
    expect((await put(declared.uploadUrl, bytes, 'image/png')).statusCode).toBe(204);
    const again = await put(declared.uploadUrl, bytes, 'image/png');
    expect(again.statusCode).toBe(409);
    expect(ErrorBodySchema.parse(again.json()).error.code).toBe('CONFLICT');

    const racing = await declare(alice, 'image/png', bytes);
    const results = await Promise.all(
      Array.from({ length: 5 }, () => put(racing.uploadUrl, bytes, 'image/png')),
    );
    expect(results.filter((r) => r.statusCode === 204)).toHaveLength(1);
    expect(results.filter((r) => r.statusCode === 409)).toHaveLength(4);
  });

  it('needs no bearer token, and a bearer token does not replace the signature', async () => {
    const bytes = await png();
    const declared = await declare(alice, 'image/png', bytes);
    const url = new URL(declared.uploadUrl, 'http://x');
    const withoutSig = await app.inject({
      method: 'PUT',
      url: url.pathname,
      headers: { ...auth(alice), 'content-type': 'image/png' },
      payload: bytes,
    });
    expect([400, 403]).toContain(withoutSig.statusCode);
  });

  it('allows the dashboard origin to PUT cross-origin (CORS preflight)', async () => {
    const bytes = await png();
    const declared = await declare(alice, 'image/png', bytes);
    const response = await app.inject({
      method: 'OPTIONS',
      url: declared.uploadUrl,
      headers: {
        origin: config.WEB_ORIGIN,
        'access-control-request-method': 'PUT',
        'access-control-request-headers': 'content-type',
      },
    });
    expect(response.statusCode).toBeLessThan(300);
    expect(response.headers['access-control-allow-origin']).toBe(config.WEB_ORIGIN);
    expect(String(response.headers['access-control-allow-methods'])).toContain('PUT');
  });

  it('never logs the signature', async () => {
    const lines: string[] = [];
    const logged = await buildApp({
      config,
      logger: createLogger({ level: 'info', stream: { write: (c: string) => void lines.push(c) } }),
      db: testDb.db,
      storage,
    });
    const bytes = await png();
    const declared = await declare(alice, 'image/png', bytes);
    const sig = new URL(declared.uploadUrl, 'http://x').searchParams.get('sig') ?? '';
    await logged.inject({
      method: 'PUT',
      url: declared.uploadUrl,
      headers: { 'content-type': 'image/png' },
      payload: bytes,
    });
    await logged.close();
    expect(sig).toHaveLength(43);
    expect(lines.join('')).not.toContain(sig);
  });
});

// ---- who may do what ---------------------------------------------------------------------------------

describe('authorization', () => {
  it('lets only the user who declared an upload complete it, in the right workspace', async () => {
    const bytes = await png();
    const declared = await declare(alice, 'image/png', bytes);
    expect((await put(declared.uploadUrl, bytes, 'image/png')).statusCode).toBe(204);

    // another member of the same workspace, a stranger in the victim workspace, a stranger via their own
    expect((await complete(editor, declared.intentId, alice.workspaceId)).statusCode).toBe(404);
    expect((await complete(bob, declared.intentId, alice.workspaceId)).statusCode).toBe(404);
    expect((await complete(bob, declared.intentId, bob.workspaceId)).statusCode).toBe(404);
    expect((await complete(alice, declared.intentId, bob.workspaceId)).statusCode).toBe(404);
    expect((await complete(alice, declared.intentId)).statusCode).toBe(200);
  });

  it('forbids viewers from declaring, completing or deleting', async () => {
    expect(
      (
        await intent(
          viewer,
          { filename: 'a.png', mimeType: 'image/png', sizeBytes: 10 },
          alice.workspaceId,
        )
      ).statusCode,
    ).toBe(403);
    const asset = await upload(alice, 'image/png', await png());
    const forbidden = await app.inject({
      method: 'DELETE',
      url: `${assetsUrl(alice.workspaceId)}/${asset.id}`,
      headers: auth(viewer),
    });
    expect(forbidden.statusCode).toBe(403);
    expect(
      (
        await app.inject({
          method: 'GET',
          url: `${assetsUrl(alice.workspaceId)}/${asset.id}`,
          headers: auth(viewer),
        })
      ).statusCode,
    ).toBe(200);
  });

  it("never lets a stranger read, list or delete another workspace's files", async () => {
    const asset = await upload(alice, 'image/png', await png(), { filename: 'secret-plan.png' });
    const attempts: [string, string][] = [
      ['GET', `${assetsUrl(alice.workspaceId)}/${asset.id}`],
      ['GET', assetsUrl(alice.workspaceId)],
      ['DELETE', `${assetsUrl(alice.workspaceId)}/${asset.id}`],
      ['GET', `${assetsUrl(bob.workspaceId)}/${asset.id}`],
      ['DELETE', `${assetsUrl(bob.workspaceId)}/${asset.id}`],
    ];
    for (const [method, url] of attempts) {
      const response = await app.inject({ method: method as 'GET', url, headers: auth(bob) });
      expect(response.statusCode, `${method} ${url}`).toBe(404);
      expect(response.body).not.toContain('secret-plan');
    }
    const theirs = AssetListResponseSchema.parse(
      (
        await app.inject({ method: 'GET', url: assetsUrl(bob.workspaceId), headers: auth(bob) })
      ).json(),
    );
    expect(theirs.items.some((item) => item.id === asset.id)).toBe(false);
    const still = await app.inject({
      method: 'GET',
      url: `${assetsUrl(alice.workspaceId)}/${asset.id}`,
      headers: auth(alice),
    });
    expect(still.statusCode).toBe(200);
  });

  it("refuses an upload into someone else's product, and links a file to its own product", async () => {
    const bobsProduct = ProductSchema.parse(
      (
        await app.inject({
          method: 'POST',
          url: productsUrl(bob.workspaceId),
          headers: auth(bob),
          payload: { name: 'Bob product' },
        })
      ).json(),
    );
    const refused = await intent(alice, {
      filename: 'a.png',
      mimeType: 'image/png',
      sizeBytes: 10,
      productId: bobsProduct.id,
    });
    expect(refused.statusCode).toBe(404);

    const mine = ProductSchema.parse(
      (
        await app.inject({
          method: 'POST',
          url: productsUrl(alice.workspaceId),
          headers: auth(alice),
          payload: { name: 'Alice product' },
        })
      ).json(),
    );
    const asset = await upload(alice, 'image/png', await png(), { productId: mine.id });
    expect(asset.productId).toBe(mine.id);
    const list = AssetListResponseSchema.parse(
      (
        await app.inject({
          method: 'GET',
          url: `${assetsUrl(alice.workspaceId)}?productId=${mine.id}`,
          headers: auth(alice),
        })
      ).json(),
    );
    expect(list.items.map((item) => item.id)).toEqual([asset.id]);
    // A foreign product id as a filter yields an empty list, never a count or an error.
    const foreign = await app.inject({
      method: 'GET',
      url: `${assetsUrl(alice.workspaceId)}?productId=${bobsProduct.id}`,
      headers: auth(alice),
    });
    expect(AssetListResponseSchema.parse(foreign.json()).items).toEqual([]);
  });
});

describe('completing an upload', () => {
  it('needs the file to have been sent first', async () => {
    const declared = await declare(alice, 'image/png', await png());
    const early = await complete(alice, declared.intentId);
    expect(early.statusCode).toBe(409);
    expect(await complete(alice, 'not-a-uuid').then((r) => r.statusCode)).toBe(404);
    expect(
      await complete(alice, '00000000-0000-4000-8000-000000000000').then((r) => r.statusCode),
    ).toBe(404);
  });

  it('is idempotent: repeating it, even simultaneously, gives the same asset and one record', async () => {
    const bytes = await png();
    const declared = await declare(alice, 'image/png', bytes);
    await put(declared.uploadUrl, bytes, 'image/png');
    const results = await Promise.all(
      Array.from({ length: 4 }, () => complete(alice, declared.intentId)),
    );
    expect(results.map((r) => r.statusCode)).toEqual([200, 200, 200, 200]);
    const ids = new Set(results.map((r) => AssetSchema.parse(r.json()).id));
    expect(ids.size).toBe(1);
    const rows = await testDb.db
      .select()
      .from(schema.assets)
      .where(eq(schema.assets.id, [...ids][0] ?? ''));
    expect(rows).toHaveLength(1);
    const events = await testDb.db
      .select()
      .from(schema.auditEvents)
      .where(eq(schema.auditEvents.resourceId, [...ids][0] ?? ''));
    expect(events.filter((event) => event.action === 'asset.created')).toHaveLength(1);
  });
});

// ---- quotas ---------------------------------------------------------------------------------------------

describe('workspace limits', () => {
  it('caps the number of uploads in progress', async () => {
    const dana = await createPerson(testDb.db, config.SESSION_SECRET, 'dana');
    const bytes = 10;
    for (let i = 0; i < 20; i += 1) {
      expect(
        (await intent(dana, { filename: `${i}.png`, mimeType: 'image/png', sizeBytes: bytes }))
          .statusCode,
      ).toBe(201);
    }
    const over = await intent(dana, { filename: 'x.png', mimeType: 'image/png', sizeBytes: bytes });
    expect(over.statusCode).toBe(409);
    expect(ErrorBodySchema.parse(over.json()).error.message).toContain('Too many uploads');
  });

  it('caps stored files and stored bytes, counting uploads still on their way', async () => {
    const erin = await createPerson(testDb.db, config.SESSION_SECRET, 'erin');
    await testDb.pool.query(
      `insert into assets (workspace_id, type, mime_type, size_bytes, original_filename, sha256, storage_key, created_by)
       select $1, 'image', 'image/png', 1, 'f.png', repeat('a', 64), 'ws/x/' || g, $2 from generate_series(1, 500) g`,
      [erin.workspaceId, erin.userId],
    );
    const full = await intent(erin, { filename: 'x.png', mimeType: 'image/png', sizeBytes: 10 });
    expect(full.statusCode).toBe(409);
    expect(ErrorBodySchema.parse(full.json()).error.message).toContain('file limit');

    const finn = await createPerson(testDb.db, config.SESSION_SECRET, 'finn');
    await testDb.pool.query(
      `insert into assets (workspace_id, type, mime_type, size_bytes, original_filename, sha256, storage_key, created_by)
       values ($1, 'video', 'video/mp4', $2, 'big.mp4', repeat('b', 64), 'ws/x/big', $3)`,
      [finn.workspaceId, 2 * 1024 * 1024 * 1024 - 5, finn.userId],
    );
    expect(
      (await intent(finn, { filename: 'ok.png', mimeType: 'image/png', sizeBytes: 5 })).statusCode,
    ).toBe(201);
    const tooBig = await intent(finn, { filename: 'no.png', mimeType: 'image/png', sizeBytes: 1 });
    expect(tooBig.statusCode).toBe(409);
    expect(ErrorBodySchema.parse(tooBig.json()).error.message).toContain('storage limit');
  });
});

// ---- cover image ----------------------------------------------------------------------------------------

describe('cover image', () => {
  async function newProduct(person: Person, name: string) {
    return ProductSchema.parse(
      (
        await app.inject({
          method: 'POST',
          url: productsUrl(person.workspaceId),
          headers: auth(person),
          payload: { name },
        })
      ).json(),
    );
  }
  const patch = (person: Person, productId: string, body: Record<string, unknown>) =>
    app.inject({
      method: 'PATCH',
      url: `${productsUrl(person.workspaceId)}/${productId}`,
      headers: auth(person),
      payload: body,
    });

  it('sets an image as the cover, clears it with null, and refuses videos, foreign or deleted files', async () => {
    const product = await newProduct(alice, 'Cover test');
    const image = await upload(alice, 'image/png', await png());
    const video = await upload(alice, 'video/mp4', mp4());
    const foreign = await upload(bob, 'image/png', await png());

    const ok = await patch(alice, product.id, { version: 1, primaryAssetId: image.id });
    expect(ok.statusCode, ok.body).toBe(200);
    expect(ProductSchema.parse(ok.json())).toMatchObject({ primaryAssetId: image.id, version: 2 });

    for (const bad of [video.id, foreign.id, '00000000-0000-4000-8000-000000000000', 'nope']) {
      const response = await patch(alice, product.id, { version: 2, primaryAssetId: bad });
      expect(response.statusCode, bad).toBe(400);
      expect(ErrorBodySchema.parse(response.json()).error.details?.fields?.[0]?.path).toBe(
        'primaryAssetId',
      );
    }

    const cleared = await patch(alice, product.id, { version: 2, primaryAssetId: null });
    expect(ProductSchema.parse(cleared.json()).primaryAssetId).toBeNull();
  });

  it('removes the cover automatically when its file is deleted, and bumps the product version', async () => {
    const product = await newProduct(alice, 'Cover delete');
    const image = await upload(alice, 'image/png', await png());
    await patch(alice, product.id, { version: 1, primaryAssetId: image.id });

    const deleted = await app.inject({
      method: 'DELETE',
      url: `${assetsUrl(alice.workspaceId)}/${image.id}`,
      headers: auth(alice),
    });
    expect(deleted.statusCode).toBe(200);
    const after = ProductSchema.parse(
      (
        await app.inject({
          method: 'GET',
          url: `${productsUrl(alice.workspaceId)}/${product.id}`,
          headers: auth(alice),
        })
      ).json(),
    );
    expect(after.primaryAssetId).toBeNull();
    expect(after.version).toBe(3);

    const events = await testDb.db
      .select()
      .from(schema.auditEvents)
      .where(eq(schema.auditEvents.resourceId, image.id));
    expect(events.find((e) => e.action === 'asset.deleted')?.metadata).toEqual({
      clearedPrimaryFor: [product.id],
    });

    // A deleted file can no longer be chosen as a cover.
    const again = await patch(alice, product.id, { version: 3, primaryAssetId: image.id });
    expect(again.statusCode).toBe(400);
  });
});

// ---- the library -----------------------------------------------------------------------------------------

describe('library', () => {
  it('lists newest first with a cursor, filters by type, and hides deleted files', async () => {
    const gail = await createPerson(testDb.db, config.SESSION_SECRET, 'gail');
    const first = await upload(gail, 'image/png', await png());
    const second = await upload(gail, 'image/png', await png(50, 50));
    const video = await upload(gail, 'video/mp4', mp4());

    const pageOne = AssetListResponseSchema.parse(
      (
        await app.inject({
          method: 'GET',
          url: `${assetsUrl(gail.workspaceId)}?limit=2`,
          headers: auth(gail),
        })
      ).json(),
    );
    expect(pageOne.items).toHaveLength(2);
    expect(pageOne.nextCursor).not.toBeNull();
    const pageTwo = AssetListResponseSchema.parse(
      (
        await app.inject({
          method: 'GET',
          url: `${assetsUrl(gail.workspaceId)}?limit=2&cursor=${pageOne.nextCursor}`,
          headers: auth(gail),
        })
      ).json(),
    );
    expect([...pageOne.items, ...pageTwo.items].map((a) => a.id).sort()).toEqual(
      [first.id, second.id, video.id].sort(),
    );
    expect(pageTwo.nextCursor).toBeNull();

    const videos = AssetListResponseSchema.parse(
      (
        await app.inject({
          method: 'GET',
          url: `${assetsUrl(gail.workspaceId)}?type=video`,
          headers: auth(gail),
        })
      ).json(),
    );
    expect(videos.items.map((a) => a.id)).toEqual([video.id]);

    await app.inject({
      method: 'DELETE',
      url: `${assetsUrl(gail.workspaceId)}/${second.id}`,
      headers: auth(gail),
    });
    const remaining = AssetListResponseSchema.parse(
      (
        await app.inject({ method: 'GET', url: assetsUrl(gail.workspaceId), headers: auth(gail) })
      ).json(),
    );
    expect(remaining.items.map((a) => a.id).sort()).toEqual([first.id, video.id].sort());

    for (const query of [
      'cursor=garbage!!',
      'limit=0',
      'limit=101',
      'type=audio',
      'workspaceId=x',
    ]) {
      expect(
        (
          await app.inject({
            method: 'GET',
            url: `${assetsUrl(gail.workspaceId)}?${query}`,
            headers: auth(gail),
          })
        ).statusCode,
        query,
      ).toBe(400);
    }
  });

  it('deleting is idempotent and removes the file from the media route immediately', async () => {
    const asset = await upload(alice, 'image/png', await png());
    const url = `${assetsUrl(alice.workspaceId)}/${asset.id}`;
    expect((await app.inject({ method: 'GET', url: asset.url })).statusCode).toBe(200);
    expect((await app.inject({ method: 'DELETE', url, headers: auth(alice) })).statusCode).toBe(
      200,
    );
    expect((await app.inject({ method: 'DELETE', url, headers: auth(alice) })).statusCode).toBe(
      200,
    );
    const events = await testDb.db
      .select()
      .from(schema.auditEvents)
      .where(eq(schema.auditEvents.resourceId, asset.id));
    expect(events.filter((e) => e.action === 'asset.deleted')).toHaveLength(1);
    expect((await app.inject({ method: 'GET', url: asset.url })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url, headers: auth(alice) })).statusCode).toBe(404);
    expect(
      (
        await app.inject({
          method: 'DELETE',
          url: `${assetsUrl(alice.workspaceId)}/00000000-0000-4000-8000-000000000000`,
          headers: auth(alice),
        })
      ).statusCode,
    ).toBe(404);
  });

  it('purges deleted files from storage and the database after the retention window', async () => {
    const asset = await upload(alice, 'image/png', await png());
    await app.inject({
      method: 'DELETE',
      url: `${assetsUrl(alice.workspaceId)}/${asset.id}`,
      headers: auth(alice),
    });
    const key = `ws/${alice.workspaceId}/${asset.id}/original.png`;
    expect(await storage.stat(key)).not.toBeNull(); // still there: retention
    expect(
      await purgeDeletedAssets(deps, new Date(Date.now() - 24 * 3600 * 1000)),
    ).toBeGreaterThanOrEqual(0);
    expect(await storage.stat(key)).not.toBeNull(); // deleted just now, inside the window
    await purgeDeletedAssets(deps, new Date(Date.now() + 1000));
    expect(await storage.stat(key)).toBeNull();
    expect(await storage.stat(`ws/${alice.workspaceId}/${asset.id}/thumb.webp`)).toBeNull();
    expect(
      await testDb.db.select().from(schema.assets).where(eq(schema.assets.id, asset.id)),
    ).toHaveLength(0);
  });
});

// ---- the signed media URL ------------------------------------------------------------------------------------

describe('signed media URL', () => {
  it('answers a forged, expired, swapped or deleted link exactly like a missing file', async () => {
    const a = await upload(alice, 'image/png', await png());
    const b = await upload(alice, 'image/png', await png());
    const parts = (url: string) => {
      const u = new URL(url, 'http://x');
      return {
        path: u.pathname,
        exp: u.searchParams.get('exp') ?? '',
        sig: u.searchParams.get('sig') ?? '',
      };
    };
    const pa = parts(a.url);
    const pb = parts(b.url);

    const missing = await app.inject({
      method: 'GET',
      url: `/api/v1/media/00000000-0000-4000-8000-000000000000/original?exp=${pa.exp}&sig=${pa.sig}`,
    });
    expect(missing.statusCode).toBe(404);

    const attempts = [
      `${pa.path}?exp=${pa.exp}&sig=${pa.sig.slice(0, -1)}${pa.sig.endsWith('A') ? 'B' : 'A'}`, // tampered
      `${pa.path}?exp=${Number(pa.exp) + 600}&sig=${pa.sig}`, // later expiry
      `${pb.path}?exp=${pa.exp}&sig=${pa.sig}`, // signature of another asset
      `${pa.path.replace('/original', '/thumb')}?exp=${pa.exp}&sig=${pa.sig}`, // signature of another variant
      `${pa.path}?exp=${pa.exp}&sig=${'A'.repeat(43)}`,
    ];
    for (const url of attempts) {
      const response = await app.inject({ method: 'GET', url });
      expect(response.statusCode, url).toBe(404);
      expect(strip(response.body), url).toBe(strip(missing.body));
    }

    const expired = deps.media.url(
      { id: a.id, workspaceId: a.workspaceId },
      'original',
      Math.floor(Date.now() / 1000) - 3600,
    );
    const late = await app.inject({ method: 'GET', url: expired });
    expect(late.statusCode).toBe(404);
    expect(strip(late.body)).toBe(strip(missing.body));
  });

  it('is bound to the workspace of the file, and a URL for another workspace gets nothing', async () => {
    const mine = await upload(alice, 'image/png', await png());
    const theirs = await upload(bob, 'image/png', await png());
    // Signing with the wrong workspace id (as an attacker who knew the secret-free parts might try).
    const forged = deps.media.url(
      { id: theirs.id, workspaceId: alice.workspaceId },
      'original',
      Math.floor(Date.now() / 1000),
    );
    expect((await app.inject({ method: 'GET', url: forged })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: mine.url })).statusCode).toBe(200);
  });

  it('serves content types from the database, not from the file, and never as HTML', async () => {
    const asset = await upload(alice, 'image/png', await png());
    const response = await app.inject({ method: 'GET', url: asset.url });
    expect(response.headers['content-type']).toBe('image/png');
    expect(response.headers['content-type']).not.toMatch(/html|svg|javascript/);
  });
});

// ---- cleaning up unfinished uploads -----------------------------------------------------------------------------

describe('sweeping unfinished uploads', () => {
  it('removes old unfinished intents and their files, and keeps fresh ones', async () => {
    const hana = await createPerson(testDb.db, config.SESSION_SECRET, 'hana');
    const bytes = await png();
    const stale = await declare(hana, 'image/png', bytes);
    const staleRow = (
      await testDb.db
        .select()
        .from(schema.uploadIntents)
        .where(eq(schema.uploadIntents.id, stale.intentId))
    )[0];
    await put(stale.uploadUrl, bytes, 'image/png'); // received but never completed
    await testDb.pool.query(
      "update upload_intents set updated_at = now() - interval '3 hours' where id = $1",
      [stale.intentId],
    );
    const fresh = await declare(hana, 'image/png', bytes);

    const staleKey = `ws/${hana.workspaceId}/${staleRow?.assetId}/original.png`;
    expect(await storage.stat(staleKey)).not.toBeNull();
    expect(await sweepUploads(deps)).toBeGreaterThanOrEqual(1);
    expect(await storage.stat(staleKey)).toBeNull();
    const remaining = await testDb.db
      .select()
      .from(schema.uploadIntents)
      .where(eq(schema.uploadIntents.workspaceId, hana.workspaceId));
    expect(remaining.map((row) => row.id)).toEqual([fresh.intentId]);
  });
});

describe('upload rate limit', () => {
  it('limits uploads per client address with the standard error', async () => {
    const limited = await buildApp({
      config,
      logger: silent,
      db: testDb.db,
      storage,
      uploadRateLimitMax: 3,
    });
    const bytes = await png();
    const statuses: number[] = [];
    for (let i = 0; i < 5; i += 1) {
      const declared = UploadIntentSchema.parse(
        (
          await intent(alice, { filename: 'r.png', mimeType: 'image/png', sizeBytes: bytes.length })
        ).json(),
      );
      const response = await limited.inject({
        method: 'PUT',
        url: declared.uploadUrl,
        headers: { 'content-type': 'image/png' },
        payload: bytes,
      });
      statuses.push(response.statusCode);
      if (response.statusCode === 429)
        expect(ErrorBodySchema.parse(response.json()).error.code).toBe('RATE_LIMITED');
    }
    expect(statuses).toEqual([204, 204, 204, 429, 429]);
    await limited.close();
  });
});
