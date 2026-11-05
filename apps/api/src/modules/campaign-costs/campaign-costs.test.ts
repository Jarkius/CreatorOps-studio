import { CampaignCostSchema, DEFAULT_THB_PER_USD } from '@creatorops/contracts';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildApp } from '../../app.js';
import { loadConfig } from '../../platform/config.js';
import { createLogger } from '../../platform/logger.js';
import { requireDatabaseUrl, validEnv } from '../../test/db-url.js';
import { createPerson, type Person } from '../../test/people.js';
import { testStorage } from '../../test/storage.js';
import { createTestDb, type TestDb } from '../../test/test-db.js';

const config = loadConfig(validEnv());
const silent = createLogger({ level: 'silent' });

let testDb: TestDb;
let app: FastifyInstance;
let alice: Person; // owner of workspace A
let bob: Person; // owner of workspace B
let viewer: Person;
let editor: Person;

beforeAll(async () => {
  testDb = await createTestDb(requireDatabaseUrl());
  app = await buildApp({
    config,
    logger: silent,
    db: testDb.db,
    storage: testStorage(),
    rateLimitMax: 100000,
  });
  alice = await createPerson(testDb.db, config.SESSION_SECRET, 'alice');
  bob = await createPerson(testDb.db, config.SESSION_SECRET, 'bob');
  viewer = await createPerson(testDb.db, config.SESSION_SECRET, 'viewer');
  editor = await createPerson(testDb.db, config.SESSION_SECRET, 'editor');
  for (const [person, role] of [
    [viewer, 'viewer'],
    [editor, 'editor'],
  ] as const) {
    await testDb.pool.query(
      'insert into workspace_members (workspace_id, user_id, role) values ($1, $2, $3)',
      [alice.workspaceId, person.userId, role],
    );
  }
});

afterAll(async () => {
  await app.close();
  await testDb.drop();
});

async function one(sql: string, values: unknown[]): Promise<string> {
  return (await testDb.pool.query<{ id: string }>(sql, values)).rows[0]!.id;
}

async function newCampaign(person: Person): Promise<string> {
  const product = await one(
    'insert into products (workspace_id, name) values ($1, $2) returning id',
    [person.workspaceId, 'P'],
  );
  return one(
    `insert into campaigns (workspace_id, product_id, name, template_id, template_version, language, duration_seconds, created_by)
     values ($1, $2, 'C', 'product-showcase', 1, 'th', 30, $3) returning id`,
    [person.workspaceId, product, person.userId],
  );
}

let jobCounter = 0;
/** A generate job of the campaign with one usage event of the given state and cost. */
async function usage(
  person: Person,
  campaignId: string,
  options: { status?: string; costUsd?: number | null; anomaly?: boolean; callIndex?: number } = {},
): Promise<void> {
  jobCounter += 1;
  const job = await one(
    `insert into jobs (workspace_id, type, input, created_by, idempotency_key, request_hash, campaign_id)
     values ($1, 'generate_brief', '{}'::jsonb, $2, $3, repeat('d', 64), $4) returning id`,
    [person.workspaceId, person.userId, `campaign-cost-test-${String(jobCounter)}-key`, campaignId],
  );
  const status = options.status ?? 'settled';
  await testDb.pool.query(
    `insert into usage_events (workspace_id, job_id, attempt, call_index, provider, model, status, reserved_usd, cost_usd, anomaly, settled_at)
     values ($1, $2, 1, $3, 'custom', 'm', $4, 0.5, $5, $6, case when $4 = 'settled' then now() end)`,
    [
      person.workspaceId,
      job,
      options.callIndex ?? 1,
      status,
      options.costUsd === undefined ? 0.08 : options.costUsd,
      options.anomaly ?? false,
    ],
  );
}

async function setRate(person: Person, thbPerUsd: number | undefined): Promise<void> {
  await testDb.pool.query(`delete from provider_credentials where workspace_id = $1`, [
    person.workspaceId,
  ]);
  if (thbPerUsd === undefined) return;
  await testDb.pool.query(
    `insert into provider_credentials (workspace_id, provider, base_url, model, key_encrypted, pricing, created_by, updated_by)
     values ($1, 'custom', 'https://example.com/v1', 'm', 'x', $2::jsonb, $3, $3)`,
    [
      person.workspaceId,
      JSON.stringify({ inputPerMillionUsd: 1, outputPerMillionUsd: 1, thbPerUsd }),
      person.userId,
    ],
  );
}

const base = (person: Person, campaignId: string) =>
  `/api/v1/workspaces/${person.workspaceId}/campaigns/${campaignId}`;

const call = (
  person: Person | null,
  method: 'GET' | 'POST' | 'DELETE',
  path: string,
  payload?: unknown,
) =>
  app.inject({
    method,
    url: path,
    headers: person ? { authorization: `Bearer ${person.token}` } : {},
    ...(payload === undefined ? {} : { payload: payload as object }),
  });

const cost = async (person: Person, campaignId: string) =>
  CampaignCostSchema.parse((await call(person, 'GET', `${base(person, campaignId)}/cost`)).json());

describe('campaign cost in baht', () => {
  it('is zero for a campaign with no calls and no manual lines', async () => {
    await setRate(alice, undefined);
    const result = await cost(alice, await newCampaign(alice));
    expect(result.aiText).toEqual({ calls: 0, costUsd: 0, costThb: 0, anomalies: 0 });
    expect(result.manual).toEqual({ items: [], totalThb: 0 });
    expect(result.totalThb).toBe(0);
    expect(result.currency).toBe('THB');
  });

  it('adds settled calls of this campaign only and converts at the saved rate', async () => {
    await setRate(alice, 0.3333);
    const mine = await newCampaign(alice);
    const other = await newCampaign(alice);
    await usage(alice, mine, { costUsd: 0.08, callIndex: 1 });
    await usage(alice, mine, { costUsd: 0.12, anomaly: true, callIndex: 2 });
    await usage(alice, mine, { status: 'reserved', costUsd: null }); // not a cost yet
    await usage(alice, other, { costUsd: 9 }); // another campaign
    const result = await cost(alice, mine);
    expect(result.rateSource).toBe('settings');
    expect(result.thbPerUsd).toBe(0.3333);
    expect(result.aiText.calls).toBe(2);
    expect(result.aiText.costUsd).toBeCloseTo(0.2, 6);
    expect(result.aiText.costThb).toBe(0.07); // 0.2 USD x 0.3333, rounded to satang
    expect(result.aiText.anomalies).toBe(1);
  });

  it('uses the default rate when none was entered, and says so', async () => {
    await setRate(alice, undefined);
    const campaign = await newCampaign(alice);
    await usage(alice, campaign, { costUsd: 1 });
    const result = await cost(alice, campaign);
    expect(result.rateSource).toBe('default');
    expect(result.thbPerUsd).toBe(DEFAULT_THB_PER_USD);
    expect(result.aiText.costThb).toBe(DEFAULT_THB_PER_USD);
  });

  it('adds hand-typed lines to the total, removes them, and records an audit trail without the label', async () => {
    await setRate(alice, 35);
    const campaign = await newCampaign(alice);
    await usage(alice, campaign, { costUsd: 0.1 }); // 3.50 THB
    const added = await call(alice, 'POST', `${base(alice, campaign)}/costs`, {
      label: 'ค่า Meta AI รายเดือน (ส่วนแบ่ง)',
      scene: 'usage',
      amountThb: 12.5,
    });
    expect(added.statusCode).toBe(201);
    const line = added.json<{ id: string; amountThb: number; scene: string }>();
    expect(line.amountThb).toBe(12.5);
    expect(line.scene).toBe('usage');
    await call(alice, 'POST', `${base(alice, campaign)}/costs`, {
      label: 'ทั้งแคมเปญ',
      amountThb: 0.1,
    });
    await call(alice, 'POST', `${base(alice, campaign)}/costs`, {
      label: 'อีกบรรทัด',
      amountThb: 0.2,
    });

    let result = await cost(alice, campaign);
    expect(result.manual.items).toHaveLength(3);
    expect(result.manual.totalThb).toBe(12.8); // 12.5 + 0.1 + 0.2 without float drift
    expect(result.totalThb).toBe(16.3);

    const removed = await call(alice, 'DELETE', `${base(alice, campaign)}/costs/${line.id}`);
    expect(removed.statusCode).toBe(200);
    result = await cost(alice, campaign);
    expect(result.manual.totalThb).toBe(0.3);

    const audit = await testDb.pool.query<{ action: string; metadata: unknown }>(
      `select action, metadata from audit_events where resource_id = $1 and action like 'campaign.cost.%' order by created_at`,
      [campaign],
    );
    expect(audit.rows.map((row) => row.action)).toEqual([
      'campaign.cost.added',
      'campaign.cost.added',
      'campaign.cost.added',
      'campaign.cost.removed',
    ]);
    expect(JSON.stringify(audit.rows)).not.toContain('Meta AI');
  });

  it('validates the amount, the label and the scene', async () => {
    const campaign = await newCampaign(alice);
    const post = (payload: unknown) =>
      call(alice, 'POST', `${base(alice, campaign)}/costs`, payload);
    expect((await post({ label: 'x', amountThb: 0 })).statusCode).toBe(400);
    expect((await post({ label: 'x', amountThb: -5 })).statusCode).toBe(400);
    expect((await post({ label: 'x', amountThb: 1.234 })).statusCode).toBe(400);
    expect((await post({ label: 'x', amountThb: 1_000_000.01 })).statusCode).toBe(400);
    expect((await post({ label: '   ', amountThb: 5 })).statusCode).toBe(400);
    expect((await post({ label: 'a'.repeat(81), amountThb: 5 })).statusCode).toBe(400);
    expect((await post({ label: 'x', amountThb: 5, scene: 'closeup' })).statusCode).toBe(400);
    expect((await post({ label: 'x', amountThb: 5, extra: 1 })).statusCode).toBe(400);
    expect((await post({ label: 'x', amountThb: 5, scene: null })).statusCode).toBe(201);
  });

  it('caps the number of hand-typed lines per campaign', async () => {
    const campaign = await newCampaign(alice);
    for (let i = 0; i < 50; i += 1) {
      await testDb.pool.query(
        `insert into campaign_costs (workspace_id, campaign_id, label, amount_thb, created_by) values ($1, $2, 'x', 1, $3)`,
        [alice.workspaceId, campaign, alice.userId],
      );
    }
    const response = await call(alice, 'POST', `${base(alice, campaign)}/costs`, {
      label: 'one too many',
      amountThb: 1,
    });
    expect(response.statusCode).toBe(409);
  });
});

describe('who may see and change campaign costs', () => {
  it('lets any member read, editors write, viewers not write', async () => {
    const campaign = await newCampaign(alice);
    expect((await call(viewer, 'GET', `${base(alice, campaign)}/cost`)).statusCode).toBe(200);
    const body = { label: 'x', amountThb: 5 };
    expect((await call(viewer, 'POST', `${base(alice, campaign)}/costs`, body)).statusCode).toBe(
      403,
    );
    const made = await call(editor, 'POST', `${base(alice, campaign)}/costs`, body);
    expect(made.statusCode).toBe(201);
    const id = made.json<{ id: string }>().id;
    expect((await call(viewer, 'DELETE', `${base(alice, campaign)}/costs/${id}`)).statusCode).toBe(
      403,
    );
    expect((await call(editor, 'DELETE', `${base(alice, campaign)}/costs/${id}`)).statusCode).toBe(
      200,
    );
  });

  it('answers 401 without a token', async () => {
    const campaign = await newCampaign(alice);
    expect((await call(null, 'GET', `${base(alice, campaign)}/cost`)).statusCode).toBe(401);
  });

  it("gives a stranger 404 for another workspace's campaign, lines and costs", async () => {
    const campaign = await newCampaign(alice);
    await usage(alice, campaign, { costUsd: 5 });
    const made = await call(alice, 'POST', `${base(alice, campaign)}/costs`, {
      label: 'x',
      amountThb: 5,
    });
    const id = made.json<{ id: string }>().id;
    // Bob asks through his own workspace path.
    const ask = (method: 'GET' | 'POST' | 'DELETE', path: string, payload?: unknown) =>
      call(
        bob,
        method,
        `/api/v1/workspaces/${bob.workspaceId}/campaigns/${campaign}${path}`,
        payload,
      );
    expect((await ask('GET', '/cost')).statusCode).toBe(404);
    expect((await ask('POST', '/costs', { label: 'x', amountThb: 5 })).statusCode).toBe(404);
    expect((await ask('DELETE', `/costs/${id}`)).statusCode).toBe(404);
    // Bob inside Alice's workspace path is refused as well.
    expect((await call(bob, 'GET', `${base(alice, campaign)}/cost`)).statusCode).toBe(404);
    // Nothing of Alice's changed.
    expect((await cost(alice, campaign)).manual.items).toHaveLength(1);
  });

  it('does not delete a line through a different campaign of the same workspace', async () => {
    const one1 = await newCampaign(alice);
    const two = await newCampaign(alice);
    const made = await call(alice, 'POST', `${base(alice, one1)}/costs`, {
      label: 'x',
      amountThb: 5,
    });
    const id = made.json<{ id: string }>().id;
    expect((await call(alice, 'DELETE', `${base(alice, two)}/costs/${id}`)).statusCode).toBe(404);
    expect((await cost(alice, one1)).manual.items).toHaveLength(1);
  });

  it('answers 404 for a malformed id', async () => {
    const campaign = await newCampaign(alice);
    expect((await call(alice, 'GET', `${base(alice, 'nope')}/cost`)).statusCode).toBe(404);
    expect((await call(alice, 'DELETE', `${base(alice, campaign)}/costs/nope`)).statusCode).toBe(
      404,
    );
  });
});
