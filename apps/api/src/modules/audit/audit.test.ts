import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { schema } from '../../db/client.js';
import { seedDevData, type SeedResult } from '../../db/seed.js';
import { brandWorkspaceId, type RequestContext } from '../identity/context.js';
import { resolveWorkspaceContext } from '../identity/service.js';
import { requireDatabaseUrl } from '../../test/db-url.js';
import { createTestDb, type TestDb } from '../../test/test-db.js';
import { listAuditEvents, recordAuditEvent } from './repo.js';

let testDb: TestDb;
let seeded: SeedResult;
let ctx: RequestContext;

beforeAll(async () => {
  testDb = await createTestDb(requireDatabaseUrl());
  seeded = await seedDevData(testDb.db);
  const resolved = await resolveWorkspaceContext(testDb.db, seeded.userId, seeded.workspaceId, 'r');
  if (resolved === null) throw new Error('seed did not create a membership');
  ctx = resolved;
});

afterAll(async () => {
  await testDb.drop();
});

describe('audit repository', () => {
  it('commits the audit event together with the change it describes', async () => {
    await testDb.db.transaction(async (tx) => {
      await tx.update(schema.workspaces).set({ name: 'Renamed' }).where(eqId(seeded.workspaceId));
      await recordAuditEvent(tx, ctx, {
        action: 'workspace.renamed',
        resourceType: 'workspace',
        resourceId: seeded.workspaceId,
        metadata: { name: 'Renamed' },
      });
    });
    const events = await listAuditEvents(testDb.db, ctx);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      action: 'workspace.renamed',
      actorUserId: seeded.userId,
      workspaceId: seeded.workspaceId,
    });
  });

  it('rolls the audit event back when the transaction fails', async () => {
    const before = (await listAuditEvents(testDb.db, ctx)).length;
    await expect(
      testDb.db.transaction(async (tx) => {
        await recordAuditEvent(tx, ctx, {
          action: 'workspace.deleted',
          resourceType: 'workspace',
          resourceId: seeded.workspaceId,
        });
        throw new Error('forced rollback');
      }),
    ).rejects.toThrow('forced rollback');
    expect(await listAuditEvents(testDb.db, ctx)).toHaveLength(before);
  });

  it('lists only the events of the context workspace', async () => {
    const [other] = await testDb.db
      .insert(schema.workspaces)
      .values({ name: 'Other', ownerUserId: seeded.userId })
      .returning({ id: schema.workspaces.id });
    const otherCtx: RequestContext = { ...ctx, workspaceId: brandWorkspaceId(other!.id) };
    await recordAuditEvent(testDb.db, otherCtx, {
      action: 'other.event',
      resourceType: 'workspace',
      resourceId: other!.id,
    });

    const mine = await listAuditEvents(testDb.db, ctx);
    const theirs = await listAuditEvents(testDb.db, otherCtx);
    expect(mine.every((event) => event.workspaceId === seeded.workspaceId)).toBe(true);
    expect(theirs.map((event) => event.action)).toEqual(['other.event']);
  });
});

describe('workspace scoping is enforced by the type system', () => {
  it('does not compile without a resolved context', () => {
    // These calls are never executed; they exist so `tsc` proves the compile-time guarantee.
    const compileOnly = (): void => {
      // @ts-expect-error a bare workspace id string is not a RequestContext
      void listAuditEvents(testDb.db, seeded.workspaceId);
      void listAuditEvents(testDb.db, {
        userId: 'u',
        // @ts-expect-error an unchecked id cannot be passed off as a branded WorkspaceId
        workspaceId: 'not-branded',
        role: 'owner',
        requestId: 'r',
      });
      // @ts-expect-error the context is required
      void listAuditEvents(testDb.db);
    };
    expect(typeof compileOnly).toBe('function');
  });
});

import { eq } from 'drizzle-orm';

function eqId(id: string) {
  return eq(schema.workspaces.id, id);
}
