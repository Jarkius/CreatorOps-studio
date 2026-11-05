import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';

import { ExportDownloadSchema, ExportListResponseSchema } from '@creatorops/contracts';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildApp } from '../../app.js';
import { createMediaSigner } from '../assets/media-urls.js';
import { loadConfig } from '../../platform/config.js';
import { createLogger } from '../../platform/logger.js';
import { requireDatabaseUrl, validEnv } from '../../test/db-url.js';
import { createPerson, type Person } from '../../test/people.js';
import { testStorage } from '../../test/storage.js';
import { createTestDb, type TestDb } from '../../test/test-db.js';
import { createExportSigner } from './export-urls.js';
import { exportStorageKey } from '../jobs/export-package.js';
import { sweepExports } from './service.js';

const config = loadConfig(validEnv());
const silent = createLogger({ level: 'silent' });
const storage = testStorage();

let testDb: TestDb;
let app: FastifyInstance;
let alice: Person;
let bob: Person;
let viewer: Person;
let draftId: string;
let counter = 0;

beforeAll(async () => {
  testDb = await createTestDb(requireDatabaseUrl());
  app = await buildApp({ config, logger: silent, db: testDb.db, storage, rateLimitMax: 100000 });
  alice = await createPerson(testDb.db, config.SESSION_SECRET, 'alice');
  bob = await createPerson(testDb.db, config.SESSION_SECRET, 'bob');
  viewer = await createPerson(testDb.db, config.SESSION_SECRET, 'viewer');
  await testDb.pool.query(
    'insert into workspace_members (workspace_id, user_id, role) values ($1, $2, $3)',
    [alice.workspaceId, viewer.userId, 'viewer'],
  );
  draftId = (await newDraft(alice)).draft;
});

afterAll(async () => {
  await app.close();
  await testDb.drop();
});

async function one(sql: string, values: unknown[]): Promise<string> {
  return (await testDb.pool.query<{ id: string }>(sql, values)).rows[0]!.id;
}

async function newDraft(person: Person) {
  const product = await one(
    'insert into products (workspace_id, name) values ($1, $2) returning id',
    [person.workspaceId, 'P'],
  );
  const campaign = await one(
    `insert into campaigns (workspace_id, product_id, name, template_id, template_version, language, duration_seconds, created_by)
     values ($1, $2, 'C', 'product-showcase', 1, 'th', 30, $3) returning id`,
    [person.workspaceId, product, person.userId],
  );
  const draft = await one(
    `insert into content_drafts (workspace_id, campaign_id, product_id, sections, section_state)
     values ($1, $2, $3, '{}', '{}') returning id`,
    [person.workspaceId, campaign, product],
  );
  return { draft };
}

/** A finished package with a real file in storage. */
async function seedExport(
  person: Person,
  draft: string,
  options: { expiresIn?: string; withFile?: boolean; content?: string } = {},
): Promise<{ id: string; key: string; jobId: string }> {
  counter += 1;
  const jobId = await one(
    `insert into jobs (workspace_id, type, status, input, output, created_by, idempotency_key, request_hash, draft_id, attempts, started_at, finished_at)
     values ($1, 'export_package', 'succeeded', '{}', '{}', $2, $3, repeat('b', 64), $4, 1, now(), now()) returning id`,
    [person.workspaceId, person.userId, `seed-${String(counter)}-${randomUUID()}`, draft],
  );
  const key = exportStorageKey(person.workspaceId, jobId);
  const content = options.content ?? `zip-bytes-${String(counter)}`;
  if (options.withFile !== false) await storage.put(key, Readable.from([Buffer.from(content)]));
  const id = await one(
    `insert into draft_exports (workspace_id, draft_id, job_id, created_by, draft_version, file_count, size_bytes, sha256, filename, storage_key, manifest, expires_at)
     values ($1, $2, $3, $4, 1, 1, $5, repeat('c', 64), $6, $7, '{}', now() + $8::interval) returning id`,
    [
      person.workspaceId,
      draft,
      jobId,
      person.userId,
      content.length,
      `creatorops-20261104-${String(counter).padStart(8, '0')}.zip`,
      key,
      options.expiresIn ?? '1 day',
    ],
  );
  return { id, key, jobId };
}

const call = (person: Person | null, method: 'GET' | 'POST', path: string) =>
  app.inject({
    method,
    url: path,
    headers: person ? { authorization: `Bearer ${person.token}` } : {},
  });
const base = (person: Person) => `/api/v1/workspaces/${person.workspaceId}/exports`;

/** The member calls the workspace's own routes; all test members belong to Alice's workspace. */
async function downloadLink(person: Person, id: string): Promise<string> {
  const response = await call(person, 'POST', `${base(alice)}/${id}/download-url`);
  expect(response.statusCode).toBe(200);
  return ExportDownloadSchema.parse(response.json()).url;
}

describe('listing and reading exports', () => {
  it('lists newest first with a cursor, filtered by draft, for any member', async () => {
    const other = (await newDraft(alice)).draft;
    const first = await seedExport(alice, draftId);
    await seedExport(alice, other);
    const third = await seedExport(alice, draftId);

    const all = ExportListResponseSchema.parse(
      (await call(viewer, 'GET', `${base(alice)}?limit=100`)).json(),
    );
    expect(all.items.length).toBeGreaterThanOrEqual(3);
    const page1 = ExportListResponseSchema.parse(
      (await call(alice, 'GET', `${base(alice)}?limit=1`)).json(),
    );
    expect(page1.items).toHaveLength(1);
    expect(page1.nextCursor).not.toBeNull();
    const page2 = ExportListResponseSchema.parse(
      (await call(alice, 'GET', `${base(alice)}?limit=1&cursor=${page1.nextCursor!}`)).json(),
    );
    expect(page2.items[0]!.id).not.toBe(page1.items[0]!.id);

    const filtered = ExportListResponseSchema.parse(
      (await call(alice, 'GET', `${base(alice)}?draftId=${draftId}&limit=100`)).json(),
    );
    expect(filtered.items.every((item) => item.draftId === draftId)).toBe(true);
    expect(filtered.items.map((item) => item.id)).toEqual(
      expect.arrayContaining([first.id, third.id]),
    );
    expect((await call(alice, 'GET', `${base(alice)}?draftId=not-a-uuid`)).json()).toMatchObject({
      items: [],
    });
  });

  it('shows a stranger nothing: list is empty and get is 404', async () => {
    const mine = await seedExport(alice, draftId);
    // Bob uses his own workspace id: nothing of Alice's appears.
    const list = ExportListResponseSchema.parse((await call(bob, 'GET', base(bob))).json());
    expect(list.items.map((item) => item.id)).not.toContain(mine.id);
    expect((await call(bob, 'GET', `${base(bob)}/${mine.id}`)).statusCode).toBe(404);
    // Bob naming Alice's workspace is refused as not found.
    expect((await call(bob, 'GET', `${base(alice)}/${mine.id}`)).statusCode).toBe(404);
    expect((await call(null, 'GET', `${base(alice)}/${mine.id}`)).statusCode).toBe(401);
    expect((await call(alice, 'GET', `${base(alice)}/nope`)).statusCode).toBe(404);
  });

  it('reports a package past its expiry as expired before the sweeper runs', async () => {
    const old = await seedExport(alice, draftId, { expiresIn: '-1 minute' });
    const got = (await call(alice, 'GET', `${base(alice)}/${old.id}`)).json() as { status: string };
    expect(got.status).toBe('expired');
  });
});

describe('signed download', () => {
  it('lets any member download the exact bytes with an ASCII name and no-store', async () => {
    const made = await seedExport(alice, draftId, { content: 'PK-hello' });
    for (const person of [alice, viewer]) {
      const link = await downloadLink(person, made.id);
      const response = await app.inject({ method: 'GET', url: link });
      expect(response.statusCode).toBe(200);
      expect(response.body).toBe('PK-hello');
      expect(response.headers['content-type']).toBe('application/zip');
      expect(response.headers['cache-control']).toBe('no-store');
      expect(response.headers['content-disposition']).toMatch(
        /^attachment; filename="creatorops-[0-9a-z-]+\.zip"; filename\*=UTF-8''creatorops-/,
      );
      expect(response.headers['content-disposition']).not.toMatch(/[^\x20-\x7e]/);
    }
  });

  it('refuses a stranger, an unauthenticated call and a missing package for the link', async () => {
    const made = await seedExport(alice, draftId);
    expect((await call(bob, 'POST', `${base(bob)}/${made.id}/download-url`)).statusCode).toBe(404);
    expect((await call(bob, 'POST', `${base(alice)}/${made.id}/download-url`)).statusCode).toBe(
      404,
    );
    expect((await call(null, 'POST', `${base(alice)}/${made.id}/download-url`)).statusCode).toBe(
      401,
    );
    expect(
      (await call(alice, 'POST', `${base(alice)}/${randomUUID()}/download-url`)).statusCode,
    ).toBe(404);
  });

  it('refuses a tampered signature, expiry, user or export id, and a link from another purpose', async () => {
    const made = await seedExport(alice, draftId);
    const other = await seedExport(alice, draftId);
    const link = await downloadLink(alice, made.id);
    const url = new URL(link, 'http://x');
    const get = (path: string) => app.inject({ method: 'GET', url: path });

    expect((await get(link)).statusCode).toBe(200);

    const sig = url.searchParams.get('sig')!;
    const exp = url.searchParams.get('exp')!;
    const u = url.searchParams.get('u')!;
    const flipped = `${sig.slice(0, -1)}${sig.endsWith('A') ? 'B' : 'A'}`;
    expect((await get(link.replace(sig, flipped))).statusCode).toBe(404);
    expect(
      (await get(link.replace(`exp=${exp}`, `exp=${String(Number(exp) + 60)}`))).statusCode,
    ).toBe(404);
    // The same signature on another member (even a real one) or another export does not work.
    expect((await get(link.replace(`u=${u}`, `u=${viewer.userId}`))).statusCode).toBe(404);
    expect((await get(link.replace(`/${made.id}/`, `/${other.id}/`))).statusCode).toBe(404);
    expect((await get(link.replace(`u=${u}`, 'u=junk'))).statusCode).toBe(404);
    expect(
      (await get(`/api/v1/exports/${made.id}/download?u=${u}&exp=${exp}&sig=short`)).statusCode,
    ).toBe(404);
    expect((await get(`/api/v1/exports/${made.id}/download`)).statusCode).toBe(400);

    // A signature made with the media key for the same parts is refused.
    const mediaUrl = createMediaSigner(config.SESSION_SECRET).url(
      { id: made.id, workspaceId: alice.workspaceId },
      'original',
      Math.floor(Date.now() / 1000),
    );
    const mediaSig = new URL(mediaUrl, 'http://x').searchParams.get('sig')!;
    expect(
      (await get(`/api/v1/exports/${made.id}/download?u=${u}&exp=${exp}&sig=${mediaSig}`))
        .statusCode,
    ).toBe(404);
  });

  it('refuses an expired link (clock past the five minutes)', async () => {
    const made = await seedExport(alice, draftId);
    const signer = createExportSigner(config.SESSION_SECRET);
    const past = Math.floor(Date.now() / 1000) - 3600;
    const { url } = signer.url(
      { exportId: made.id, workspaceId: alice.workspaceId, userId: alice.userId },
      past,
    );
    expect((await app.inject({ method: 'GET', url })).statusCode).toBe(404);
  });

  it('refuses a link after the member left the workspace', async () => {
    const leaver = await createPerson(testDb.db, config.SESSION_SECRET, 'leaver');
    await testDb.pool.query(
      'insert into workspace_members (workspace_id, user_id, role) values ($1, $2, $3)',
      [alice.workspaceId, leaver.userId, 'viewer'],
    );
    const made = await seedExport(alice, draftId);
    const link = await downloadLink(leaver, made.id);
    expect((await app.inject({ method: 'GET', url: link })).statusCode).toBe(200);
    await testDb.pool.query('delete from workspace_members where workspace_id=$1 and user_id=$2', [
      alice.workspaceId,
      leaver.userId,
    ]);
    expect((await app.inject({ method: 'GET', url: link })).statusCode).toBe(404);
  });

  it('refuses an expired package even with a fresh link, and when the file is gone', async () => {
    const stale = await seedExport(alice, draftId, { expiresIn: '1 second' });
    const link = await downloadLink(alice, stale.id);
    await testDb.pool.query(
      "update draft_exports set expires_at = now() - interval '1 second' where id = $1",
      [stale.id],
    );
    expect((await app.inject({ method: 'GET', url: link })).statusCode).toBe(404);
    expect((await call(alice, 'POST', `${base(alice)}/${stale.id}/download-url`)).statusCode).toBe(
      404,
    );

    const gone = await seedExport(alice, draftId, { withFile: false });
    const goneLink = await downloadLink(alice, gone.id);
    expect((await app.inject({ method: 'GET', url: goneLink })).statusCode).toBe(404);
  });

  it('never writes the signature to the audit trail', async () => {
    const made = await seedExport(alice, draftId);
    const link = await downloadLink(alice, made.id);
    const sig = new URL(link, 'http://x').searchParams.get('sig')!;
    const rows = await testDb.pool.query(
      "select metadata::text as m, resource_id from audit_events where action = 'export.download_link' and resource_id = $1",
      [made.id],
    );
    expect(rows.rowCount).toBe(1);
    expect(JSON.stringify(rows.rows)).not.toContain(sig);
  });
});

describe('sweeper', () => {
  const deps = () => ({
    db: testDb.db,
    storage,
    exports: createExportSigner(config.SESSION_SECRET),
  });

  it('expires a due package and deletes its file, and leaves live ones alone', async () => {
    const due = await seedExport(alice, draftId, { expiresIn: '1 day' });
    const live = await seedExport(alice, draftId, { expiresIn: '1 day' });
    await testDb.pool.query(
      "update draft_exports set expires_at = now() - interval '1 minute' where id = $1",
      [due.id],
    );
    await sweepExports(deps());
    expect(await storage.stat(due.key)).toBeNull();
    expect(await storage.stat(live.key)).not.toBeNull();
    const status = await testDb.pool.query<{ status: string }>(
      'select status from draft_exports where id = $1',
      [due.id],
    );
    expect(status.rows[0]!.status).toBe('expired');
    // The row survives with its metadata.
    expect((await call(alice, 'GET', `${base(alice)}/${due.id}`)).statusCode).toBe(200);
    // Running again is harmless.
    expect(await sweepExports(deps())).toBe(0);
  });

  it('removes a file left by a failed job, but not one a recent job may still be settling', async () => {
    const mk = async (finished: string) => {
      const jobId = await one(
        `insert into jobs (workspace_id, type, status, input, created_by, idempotency_key, request_hash, draft_id, attempts, started_at, finished_at, error_code, error_message)
         values ($1, 'export_package', 'failed', '{}', $2, $3, repeat('b', 64), $4, 1, now(), now() - $5::interval, 'INTERNAL', 'x') returning id`,
        [alice.workspaceId, alice.userId, `orphan-${randomUUID()}`, draftId, finished],
      );
      const key = exportStorageKey(alice.workspaceId, jobId);
      await storage.put(key, Readable.from([Buffer.from('orphan')]));
      return key;
    };
    const old = await mk('1 hour');
    const recent = await mk('1 minute');
    await sweepExports(deps());
    expect(await storage.stat(old)).toBeNull();
    expect(await storage.stat(recent)).not.toBeNull();
    // Packages that have a row are never treated as orphans.
    const kept = await seedExport(alice, draftId);
    await sweepExports(deps());
    expect(await storage.stat(kept.key)).not.toBeNull();
  });
});
