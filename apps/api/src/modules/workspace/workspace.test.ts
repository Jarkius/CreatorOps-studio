import { testStorage } from '../../test/storage.js';
import {
  ErrorBodySchema,
  WorkspaceListResponseSchema,
  WorkspaceSchema,
} from '@creatorops/contracts';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildApp } from '../../app.js';
import { schema } from '../../db/client.js';
import { loadConfig } from '../../platform/config.js';
import { createLogger } from '../../platform/logger.js';
import { requireDatabaseUrl, validEnv } from '../../test/db-url.js';
import { createPerson, type Person } from '../../test/people.js';
import { createTestDb, type TestDb } from '../../test/test-db.js';
import { MAX_WORKSPACES_PER_USER, createWorkspace } from './service.js';

const config = loadConfig(validEnv());
const silent = createLogger({ level: 'silent' });

let testDb: TestDb;
let alice: Person;
let bob: Person;

beforeAll(async () => {
  testDb = await createTestDb(requireDatabaseUrl());
  alice = await createPerson(testDb.db, config.SESSION_SECRET, 'alice');
  bob = await createPerson(testDb.db, config.SESSION_SECRET, 'bob');
});

afterAll(async () => {
  await testDb.drop();
});

async function app() {
  return buildApp({ config, logger: silent, db: testDb.db, storage: testStorage() });
}

const auth = (person: Person) => ({ authorization: `Bearer ${person.token}` });

describe('GET /api/v1/workspaces', () => {
  it("lists only the caller's own workspaces", async () => {
    const instance = await app();
    const response = await instance.inject({
      method: 'GET',
      url: '/api/v1/workspaces',
      headers: auth(alice),
    });
    expect(response.statusCode).toBe(200);
    const body = WorkspaceListResponseSchema.parse(response.json());
    expect(body.items.map((item) => item.id)).toEqual([alice.workspaceId]);
    expect(body.items[0]?.role).toBe('owner');
    await instance.close();
  });
});

describe('POST /api/v1/workspaces', () => {
  it('creates a workspace owned by the caller, with Thai defaults and an audit event', async () => {
    const instance = await app();
    const response = await instance.inject({
      method: 'POST',
      url: '/api/v1/workspaces',
      headers: auth(alice),
      payload: { name: '  ร้านสมชาย  ' },
    });
    expect(response.statusCode).toBe(201);
    const created = WorkspaceSchema.parse(response.json());
    expect(created).toMatchObject({
      name: 'ร้านสมชาย',
      defaultLanguage: 'th',
      brandVoice: null,
      role: 'owner',
    });

    const member = await testDb.db
      .select()
      .from(schema.workspaceMembers)
      .where(eq(schema.workspaceMembers.workspaceId, created.id));
    expect(member).toHaveLength(1);
    expect(member[0]).toMatchObject({ userId: alice.userId, role: 'owner' });

    const events = await testDb.db
      .select()
      .from(schema.auditEvents)
      .where(eq(schema.auditEvents.workspaceId, created.id));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ action: 'workspace.created', actorUserId: alice.userId });

    const list = WorkspaceListResponseSchema.parse(
      (
        await instance.inject({ method: 'GET', url: '/api/v1/workspaces', headers: auth(alice) })
      ).json(),
    );
    expect(list.items.map((item) => item.id)).toContain(created.id);
    await instance.close();
  });

  it('normalizes Thai text to NFC', async () => {
    const instance = await app();
    const decomposed = 'ก้า'.normalize('NFD');
    const response = await instance.inject({
      method: 'POST',
      url: '/api/v1/workspaces',
      headers: auth(bob),
      payload: { name: decomposed, brandVoice: ` ${decomposed} ` },
    });
    expect(response.statusCode).toBe(201);
    const created = WorkspaceSchema.parse(response.json());
    expect(created.name).toBe(decomposed.normalize('NFC'));
    expect(created.brandVoice).toBe(decomposed.normalize('NFC'));
    await instance.close();
  });

  it('rejects invalid input with field paths', async () => {
    const instance = await app();
    for (const payload of [
      { name: '' },
      { name: '   ' },
      { name: 'x'.repeat(101) },
      { name: 'ok', defaultLanguage: 'fr' },
      { name: 'ok', brandVoice: 'x'.repeat(2001) },
      {},
    ]) {
      const response = await instance.inject({
        method: 'POST',
        url: '/api/v1/workspaces',
        headers: auth(alice),
        payload,
      });
      expect(response.statusCode, JSON.stringify(payload).slice(0, 60)).toBe(400);
      const body = ErrorBodySchema.parse(response.json());
      expect(body.error.code).toBe('VALIDATION_ERROR');
      expect(body.error.details?.fields?.length).toBeGreaterThan(0);
    }
    await instance.close();
  });

  it('rejects unknown fields instead of ignoring them (no mass assignment)', async () => {
    const instance = await app();
    for (const extra of [
      { ownerUserId: bob.userId },
      { role: 'owner' },
      { id: bob.workspaceId },
      { workspaceId: bob.workspaceId },
    ]) {
      const response = await instance.inject({
        method: 'POST',
        url: '/api/v1/workspaces',
        headers: auth(alice),
        payload: { name: 'Sneaky', ...extra },
      });
      expect(response.statusCode, JSON.stringify(extra)).toBe(400);
    }
    const owned = await testDb.db
      .select()
      .from(schema.workspaces)
      .where(eq(schema.workspaces.name, 'Sneaky'));
    expect(owned).toHaveLength(0);
    await instance.close();
  });

  it('answers 401, not 400, for an unauthenticated request with an invalid body', async () => {
    const instance = await app();
    const response = await instance.inject({
      method: 'POST',
      url: '/api/v1/workspaces',
      payload: { bogus: true },
    });
    expect(response.statusCode).toBe(401);
    await instance.close();
  });

  it('enforces the per-user workspace limit, even under concurrent requests', async () => {
    const instance = await app();
    const carol = await createPerson(testDb.db, config.SESSION_SECRET, 'carol'); // already owns 1
    const attempts = MAX_WORKSPACES_PER_USER + 5;
    const responses = await Promise.all(
      Array.from({ length: attempts }, (_unused, i) =>
        instance.inject({
          method: 'POST',
          url: '/api/v1/workspaces',
          headers: auth(carol),
          payload: { name: `carol ${i}` },
        }),
      ),
    );
    const created = responses.filter((r) => r.statusCode === 201).length;
    const refused = responses.filter((r) => r.statusCode === 409);
    expect(created).toBe(MAX_WORKSPACES_PER_USER - 1);
    expect(refused).toHaveLength(attempts - created);
    expect(ErrorBodySchema.parse(refused[0]?.json()).error.code).toBe('CONFLICT');
    const owned = await testDb.db
      .select()
      .from(schema.workspaces)
      .where(eq(schema.workspaces.ownerUserId, carol.userId));
    expect(owned).toHaveLength(MAX_WORKSPACES_PER_USER);
    await instance.close();
  });

  it('creates nothing when the audit event cannot be written (one transaction)', async () => {
    const isolated = await createTestDb(requireDatabaseUrl());
    try {
      const dave = await createPerson(isolated.db, config.SESSION_SECRET, 'dave');
      await isolated.pool.query('drop table audit_events');
      await expect(
        createWorkspace(
          isolated.db,
          { userId: dave.userId, email: 'dave@example.test', displayName: 'dave' },
          { name: 'Will not exist', defaultLanguage: 'th' },
          'req-1',
        ),
      ).rejects.toThrow();
      const rows = await isolated.db
        .select()
        .from(schema.workspaces)
        .where(eq(schema.workspaces.name, 'Will not exist'));
      expect(rows).toHaveLength(0);
    } finally {
      await isolated.drop();
    }
  });
});

describe('GET /api/v1/workspaces/:workspaceId', () => {
  it('returns the workspace to a member with their role', async () => {
    const instance = await app();
    const response = await instance.inject({
      method: 'GET',
      url: `/api/v1/workspaces/${alice.workspaceId}`,
      headers: auth(alice),
    });
    expect(response.statusCode).toBe(200);
    expect(WorkspaceSchema.parse(response.json())).toMatchObject({
      id: alice.workspaceId,
      role: 'owner',
    });
    await instance.close();
  });

  it('gives a non-member exactly the same answer as for a workspace that does not exist', async () => {
    const instance = await app();
    const foreign = await instance.inject({
      method: 'GET',
      url: `/api/v1/workspaces/${bob.workspaceId}`,
      headers: auth(alice),
    });
    const unknown = await instance.inject({
      method: 'GET',
      url: '/api/v1/workspaces/00000000-0000-4000-8000-000000000000',
      headers: auth(alice),
    });
    const malformed = await instance.inject({
      method: 'GET',
      url: '/api/v1/workspaces/not-a-uuid',
      headers: auth(alice),
    });
    for (const response of [foreign, unknown, malformed]) {
      expect(response.statusCode).toBe(404);
      const body = ErrorBodySchema.parse(response.json());
      expect(body.error.code).toBe('NOT_FOUND');
      expect(body.error.message).toBe('Workspace not found.');
    }
    expect(foreign.body.replace(/"requestId":"[^"]+"/, '')).toBe(
      unknown.body.replace(/"requestId":"[^"]+"/, ''),
    );
    await instance.close();
  });
});
