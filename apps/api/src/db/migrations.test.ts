import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDb, schema } from './client.js';
import { runMigrations } from './migrate.js';
import { seedDevData } from './seed.js';
import { requireDatabaseUrl } from '../test/db-url.js';
import { createPerson } from '../test/people.js';
import { createTestDb, type TestDb } from '../test/test-db.js';
import { SECRET_FOR_TESTS } from '../test/db-url.js';

// One entry per committed SQL migration in infra/migrations.
const MIGRATION_COUNT = 11;

let testDb: TestDb;

beforeAll(async () => {
  testDb = await createTestDb(requireDatabaseUrl());
});

afterAll(async () => {
  await testDb.drop();
});

describe('database schema', () => {
  it('exists only because the committed migrations created it', async () => {
    const tables = await testDb.pool.query<{ table_name: string }>(
      "select table_name from information_schema.tables where table_schema = 'public' order by 1",
    );
    expect(tables.rows.map((row) => row.table_name)).toEqual([
      'assets',
      'audit_events',
      'campaigns',
      'content_drafts',
      'draft_assets',
      'draft_exports',
      'jobs',
      'products',
      'provider_credentials',
      'upload_intents',
      'usage_events',
      'users',
      'workspace_members',
      'workspaces',
    ]);
    const applied = await testDb.pool.query(
      'select count(*)::int as n from drizzle.__drizzle_migrations',
    );
    expect(applied.rows[0]).toEqual({ n: MIGRATION_COUNT });
  });

  it('applying migrations twice is a no-op', async () => {
    await runMigrations(createDb(testDb.pool));
    const applied = await testDb.pool.query(
      'select count(*)::int as n from drizzle.__drizzle_migrations',
    );
    expect(applied.rows[0]).toEqual({ n: MIGRATION_COUNT });
  });

  it('rejects an unknown membership role', async () => {
    const seeded = await seedDevData(testDb.db);
    await expect(
      testDb.pool.query("update workspace_members set role = 'god' where workspace_id = $1", [
        seeded.workspaceId,
      ]),
    ).rejects.toThrow(/workspace_members_role_check/);
  });

  it('enforces unique emails', async () => {
    await expect(
      testDb.db.insert(schema.users).values({ email: 'dev@creatorops.local', displayName: 'Dup' }),
    ).rejects.toThrow();
  });

  it('seeding is idempotent', async () => {
    const first = await seedDevData(testDb.db);
    const second = await seedDevData(testDb.db);
    expect(second).toEqual(first);
    const counts = await testDb.pool.query<{ users: number; workspaces: number }>(
      'select (select count(*) from users)::int as users, (select count(*) from workspaces)::int as workspaces',
    );
    expect(counts.rows[0]).toEqual({ users: 1, workspaces: 1 });
  });

  it('deleting a workspace is refused while audit history exists', async () => {
    const seeded = await seedDevData(testDb.db);
    await testDb.pool.query(
      "insert into audit_events (workspace_id, actor_user_id, action, resource_type, resource_id) values ($1, $2, 'x', 'workspace', $3)",
      [seeded.workspaceId, seeded.userId, seeded.workspaceId],
    );
    await expect(
      testDb.pool.query('delete from workspaces where id = $1', [seeded.workspaceId]),
    ).rejects.toThrow();
  });
});

describe('assets and cross-workspace integrity (D-037)', () => {
  const sha = 'a'.repeat(64);

  async function setup() {
    const alice = await createPerson(
      testDb.db,
      SECRET_FOR_TESTS,
      `alice-${Math.random().toString(36).slice(2, 7)}`,
    );
    const bob = await createPerson(
      testDb.db,
      SECRET_FOR_TESTS,
      `bob-${Math.random().toString(36).slice(2, 7)}`,
    );
    const product = async (workspaceId: string) =>
      (
        await testDb.pool.query<{ id: string }>(
          'insert into products (workspace_id, name) values ($1, $2) returning id',
          [workspaceId, 'P'],
        )
      ).rows[0]!.id;
    const asset = async (
      person: { workspaceId: string; userId: string },
      productId: string | null = null,
      extra: Partial<Record<string, unknown>> = {},
    ) =>
      (
        await testDb.pool.query<{ id: string }>(
          `insert into assets (workspace_id, product_id, type, mime_type, size_bytes, original_filename, sha256, storage_key, created_by)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9) returning id`,
          [
            person.workspaceId,
            productId,
            extra.type ?? 'image',
            extra.mime ?? 'image/png',
            extra.size ?? 10,
            extra.filename ?? 'a.png',
            extra.sha ?? sha,
            `ws/${person.workspaceId}/x/original.png`,
            person.userId,
          ],
        )
      ).rows[0]!.id;
    return { alice, bob, product, asset };
  }

  it('refuses an asset linked to a product of another workspace', async () => {
    const { alice, bob, product, asset } = await setup();
    const bobsProduct = await product(bob.workspaceId);
    await expect(asset(alice, bobsProduct)).rejects.toThrow(/assets_product_fk/);
    await expect(asset(bob, bobsProduct)).resolves.toBeTruthy();
  });

  it("refuses a product whose cover image is another workspace's asset", async () => {
    const { alice, bob, product, asset } = await setup();
    const aliceProduct = await product(alice.workspaceId);
    const bobsAsset = await asset(bob);
    await expect(
      testDb.pool.query('update products set primary_asset_id = $1 where id = $2', [
        bobsAsset,
        aliceProduct,
      ]),
    ).rejects.toThrow(/products_primary_asset_fk/);
    const ownAsset = await asset(alice);
    await expect(
      testDb.pool.query('update products set primary_asset_id = $1 where id = $2', [
        ownAsset,
        aliceProduct,
      ]),
    ).resolves.toBeTruthy();
  });

  it('refuses to hard-delete an asset that is still a product cover image', async () => {
    const { alice, product, asset } = await setup();
    const p = await product(alice.workspaceId);
    const a = await asset(alice);
    await testDb.pool.query('update products set primary_asset_id = $1 where id = $2', [a, p]);
    await expect(testDb.pool.query('delete from assets where id = $1', [a])).rejects.toThrow(
      /products_primary_asset_fk/,
    );
  });

  it('refuses an upload intent for a product of another workspace', async () => {
    const { alice, bob, product } = await setup();
    const bobsProduct = await product(bob.workspaceId);
    const insert = (productId: string | null) =>
      testDb.pool.query(
        `insert into upload_intents (workspace_id, user_id, product_id, asset_id, declared_mime, declared_size, original_filename, expires_at)
         values ($1, $2, $3, gen_random_uuid(), 'image/png', 10, 'a.png', now() + interval '10 minutes')`,
        [alice.workspaceId, alice.userId, productId],
      );
    await expect(insert(bobsProduct)).rejects.toThrow(/upload_intents_product_fk/);
    await expect(insert(null)).resolves.toBeTruthy();
  });

  it('refuses rows that break the asset rules', async () => {
    const { alice, asset } = await setup();
    await expect(asset(alice, null, { mime: 'image/svg+xml' })).rejects.toThrow(
      /assets_mime_check/,
    );
    await expect(asset(alice, null, { type: 'video', mime: 'image/png' })).rejects.toThrow(
      /assets_type_matches_mime/,
    );
    await expect(asset(alice, null, { size: 0 })).rejects.toThrow(/assets_size_positive/);
    await expect(asset(alice, null, { sha: 'XYZ' })).rejects.toThrow(/assets_sha256_format/);
    await expect(asset(alice, null, { filename: '' })).rejects.toThrow(/assets_filename_length/);
    await expect(asset(alice, null, { filename: 'x'.repeat(256) })).rejects.toThrow(
      /assets_filename_length/,
    );
  });

  it('refuses a soft-deleted state that is inconsistent', async () => {
    const { alice, asset } = await setup();
    const a = await asset(alice);
    await expect(
      testDb.pool.query("update assets set status = 'deleted' where id = $1", [a]),
    ).rejects.toThrow(/assets_deleted_consistent/);
    await expect(
      testDb.pool.query("update assets set status = 'deleted', deleted_at = now() where id = $1", [
        a,
      ]),
    ).resolves.toBeTruthy();
  });

  it('refuses two assets that share a storage key, and a received size of zero', async () => {
    const { alice, asset } = await setup();
    await asset(alice);
    await expect(asset(alice)).rejects.toThrow(/assets_storage_key_unique/);
    await expect(
      testDb.pool.query(
        `insert into upload_intents (workspace_id, user_id, asset_id, declared_mime, declared_size, original_filename, expires_at, received_size)
         values ($1, $2, gen_random_uuid(), 'image/png', 10, 'a.png', now(), 0)`,
        [alice.workspaceId, alice.userId],
      ),
    ).rejects.toThrow(/upload_intents_received_size_positive/);
  });
});

describe('campaigns, drafts and jobs integrity (S3.2, D-037, D-045, D-047)', () => {
  const hash = 'b'.repeat(64);
  const sections = JSON.stringify({ title: 't' });
  const state = JSON.stringify({});

  async function insert(table: string, row: Record<string, unknown>): Promise<string> {
    const columns = Object.keys(row);
    const values = Object.values(row).map((value) =>
      value !== null && typeof value === 'object' ? JSON.stringify(value) : value,
    );
    const result = await testDb.pool.query<{ id: string }>(
      `insert into ${table} (${columns.join(', ')}) values (${columns
        .map((_c, i) => `$${i + 1}`)
        .join(', ')}) returning id`,
      values,
    );
    return result.rows[0]!.id;
  }

  async function setup() {
    const tag = Math.random().toString(36).slice(2, 7);
    const alice = await createPerson(testDb.db, SECRET_FOR_TESTS, `alice-${tag}`);
    const bob = await createPerson(testDb.db, SECRET_FOR_TESTS, `bob-${tag}`);
    const product = (workspaceId: string) =>
      insert('products', { workspace_id: workspaceId, name: 'P' });
    const campaign = (
      person: { workspaceId: string; userId: string },
      productId: string,
      extra: Record<string, unknown> = {},
    ) =>
      insert('campaigns', {
        workspace_id: person.workspaceId,
        product_id: productId,
        name: 'C',
        template_id: 'product-showcase',
        template_version: 1,
        language: 'th',
        duration_seconds: 30,
        created_by: person.userId,
        ...extra,
      });
    const draft = (
      workspaceId: string,
      campaignId: string,
      productId: string,
      extra: Record<string, unknown> = {},
    ) =>
      insert('content_drafts', {
        workspace_id: workspaceId,
        campaign_id: campaignId,
        product_id: productId,
        sections,
        section_state: state,
        ...extra,
      });
    let counter = 0;
    const job = (
      person: { workspaceId: string; userId: string },
      extra: Record<string, unknown> = {},
    ) => {
      counter += 1;
      return insert('jobs', {
        workspace_id: person.workspaceId,
        type: 'generate_brief',
        input: { campaignId: 'x' },
        created_by: person.userId,
        idempotency_key: `key-${tag}-${counter}-abcdef`,
        request_hash: hash,
        ...extra,
      });
    };
    return { alice, bob, product, campaign, draft, job, tag };
  }

  it('refuses a campaign for a product of another workspace', async () => {
    const { alice, bob, product, campaign } = await setup();
    const bobsProduct = await product(bob.workspaceId);
    await expect(campaign(alice, bobsProduct)).rejects.toThrow(/campaigns_product_fk/);
    await expect(campaign(alice, await product(alice.workspaceId))).resolves.toBeTruthy();
  });

  it('refuses campaign values outside the allowed ranges and lists', async () => {
    const { alice, product, campaign } = await setup();
    const productId = await product(alice.workspaceId);
    const bad: [Record<string, unknown>, RegExp][] = [
      [{ duration_seconds: 4 }, /campaigns_duration_check/],
      [{ duration_seconds: 181 }, /campaigns_duration_check/],
      [{ variants: 0 }, /campaigns_variants_check/],
      [{ variants: 4 }, /campaigns_variants_check/],
      [{ platform: 'myspace' }, /campaigns_platform_check/],
      [{ language: 'fr' }, /campaigns_language_check/],
      [{ status: 'deleted' }, /campaigns_status_check/],
      [{ name: '' }, /campaigns_name_length/],
      [{ name: 'x'.repeat(121) }, /campaigns_name_length/],
      [{ template_version: 0 }, /campaigns_template_version_positive/],
    ];
    for (const [extra, pattern] of bad) {
      await expect(campaign(alice, productId, extra)).rejects.toThrow(pattern);
    }
    await expect(
      campaign(alice, productId, { duration_seconds: 5, variants: 3 }),
    ).resolves.toBeTruthy();
    await expect(
      campaign(alice, productId, { duration_seconds: 180, platform: 'shopee' }),
    ).resolves.toBeTruthy();
  });

  it("refuses a draft that is not inside its campaign's workspace and product", async () => {
    const { alice, bob, product, campaign, draft } = await setup();
    const p1 = await product(alice.workspaceId);
    const p2 = await product(alice.workspaceId);
    const c1 = await campaign(alice, p1);
    await expect(draft(alice.workspaceId, c1, p1)).resolves.toBeTruthy();
    // Same workspace, but a different product than the campaign's.
    await expect(draft(alice.workspaceId, c1, p2)).rejects.toThrow(/content_drafts_campaign_fk/);
    // A campaign of another workspace.
    await expect(draft(bob.workspaceId, c1, p1)).rejects.toThrow(/content_drafts_campaign_fk/);
  });

  it('refuses drafts whose JSON has the wrong shape, an unknown status or a bad variant', async () => {
    const { alice, product, campaign, draft } = await setup();
    const p = await product(alice.workspaceId);
    const c = await campaign(alice, p);
    const w = alice.workspaceId;
    await expect(draft(w, c, p, { sections: ['a'] })).rejects.toThrow(
      /content_drafts_sections_object/,
    );
    await expect(draft(w, c, p, { section_state: '"x"' })).rejects.toThrow(
      /content_drafts_section_state_object/,
    );
    await expect(draft(w, c, p, { claim_warnings: {} })).rejects.toThrow(
      /content_drafts_claim_warnings_array/,
    );
    await expect(draft(w, c, p, { status: 'published' })).rejects.toThrow(
      /content_drafts_status_check/,
    );
    await expect(draft(w, c, p, { variant_index: 3 })).rejects.toThrow(
      /content_drafts_variant_check/,
    );
    await expect(draft(w, c, p, { variant_index: 2, version: 0 })).rejects.toThrow(
      /content_drafts_version_positive/,
    );
  });

  it('makes job creation idempotent per workspace, user and key', async () => {
    const { alice, bob, product, campaign, job } = await setup();
    const c = await campaign(alice, await product(alice.workspaceId));
    const key = 'same-key-12345678';
    await job(alice, { campaign_id: c, idempotency_key: key });
    await expect(job(alice, { campaign_id: c, idempotency_key: key })).rejects.toThrow(
      /jobs_idempotency_unique/,
    );
    // Another user may use the same key string; keys never collide across users.
    const bobCampaign = await campaign(bob, await product(bob.workspaceId));
    await expect(
      job(bob, { campaign_id: bobCampaign, idempotency_key: key }),
    ).resolves.toBeTruthy();
  });

  it('refuses malformed idempotency keys and request hashes', async () => {
    const { alice, product, campaign, job } = await setup();
    const c = await campaign(alice, await product(alice.workspaceId));
    for (const key of ['short', 'has space 12345678', '../../etc/passwd', 'a'.repeat(129)]) {
      await expect(job(alice, { campaign_id: c, idempotency_key: key })).rejects.toThrow(
        /jobs_idempotency_key_format/,
      );
    }
    for (const bad of ['B'.repeat(64), 'b'.repeat(63), 'g'.repeat(64)]) {
      await expect(job(alice, { campaign_id: c, request_hash: bad })).rejects.toThrow(
        /jobs_request_hash_format/,
      );
    }
  });

  it('refuses a job that points at a campaign or draft of another workspace', async () => {
    const { alice, bob, product, campaign, draft, job } = await setup();
    const bobProduct = await product(bob.workspaceId);
    const bobCampaign = await campaign(bob, bobProduct);
    const bobDraft = await draft(bob.workspaceId, bobCampaign, bobProduct);
    await expect(job(alice, { campaign_id: bobCampaign })).rejects.toThrow(/jobs_campaign_fk/);
    await expect(job(alice, { type: 'regenerate_section', draft_id: bobDraft })).rejects.toThrow(
      /jobs_draft_fk/,
    );
  });

  it('refuses job rows that break the state rules, and accepts the real lifecycle', async () => {
    const { alice, product, campaign, draft, job } = await setup();
    const p = await product(alice.workspaceId);
    const c = await campaign(alice, p);
    const d = await draft(alice.workspaceId, c, p);
    const finished = { finished_at: new Date().toISOString() };
    const lease = { locked_until: new Date(Date.now() + 60000).toISOString() };

    const bad: [Record<string, unknown>, RegExp][] = [
      // An unknown type also fails the target rule, so either constraint may be the one reported.
      [{ type: 'summon' }, /jobs_(type_check|target_matches_type)/],
      [{ status: 'paused' }, /jobs_status_check/],
      [{ input: [1] }, /jobs_input_object/],
      [{ max_attempts: 6 }, /jobs_max_attempts_check/],
      [{ attempts: 4 }, /jobs_attempts_check/],
      [{ error_message: 'x'.repeat(501) }, /jobs_error_message_length/],
      // finished without a finish time, and a finish time on an unfinished job
      [{ status: 'cancelled' }, /jobs_finished_consistent/],
      [{ status: 'queued', ...finished }, /jobs_finished_consistent/],
      // a lease on a job that is not running
      [{ status: 'queued', ...lease }, /jobs_lease_only_when_running/],
      // succeeded needs output; output needs succeeded
      [{ status: 'succeeded', ...finished }, /jobs_output_only_when_succeeded/],
      [{ status: 'queued', output: {} }, /jobs_output_only_when_succeeded/],
      // failed needs a code and a message; a code on a queued job is refused
      [{ status: 'failed', ...finished }, /jobs_failed_has_error/],
      [{ status: 'queued', error_code: 'INTERNAL' }, /jobs_error_only_when_unsuccessful/],
      [
        { status: 'failed', ...finished, error_code: 'MELTDOWN', error_message: 'x' },
        /jobs_error_code_check/,
      ],
      // the target must match the type
      [{ type: 'generate_brief', campaign_id: null }, /jobs_target_matches_type/],
      [{ type: 'regenerate_section', campaign_id: c }, /jobs_target_matches_type/],
    ];
    for (const [extra, pattern] of bad) {
      await expect(job(alice, { campaign_id: c, ...extra }), JSON.stringify(extra)).rejects.toThrow(
        pattern,
      );
    }

    // The real lifecycle is accepted.
    const queued = await job(alice, { campaign_id: c });
    await expect(
      testDb.pool.query(
        "update jobs set status = 'running', attempts = 1, started_at = now(), locked_until = now() + interval '1 minute' where id = $1",
        [queued],
      ),
    ).resolves.toBeTruthy();
    await expect(
      testDb.pool.query(
        `update jobs set status = 'succeeded', locked_until = null, finished_at = now(), output = '{"draftId":"x"}'::jsonb where id = $1`,
        [queued],
      ),
    ).resolves.toBeTruthy();
    await expect(
      job(alice, {
        type: 'regenerate_section',
        draft_id: d,
        status: 'failed',
        ...finished,
        error_code: 'SECTION_CHANGED',
        error_message: 'The section changed while the job was waiting.',
        attempts: 1,
      }),
    ).resolves.toBeTruthy();
    await expect(
      job(alice, { campaign_id: c, status: 'cancelled', ...finished, error_code: 'CANCELLED' }),
    ).resolves.toBeTruthy();
  });

  it('refuses to delete a product, campaign or draft that jobs or drafts still reference', async () => {
    const { alice, product, campaign, draft, job } = await setup();
    const p = await product(alice.workspaceId);
    const c = await campaign(alice, p);
    const d = await draft(alice.workspaceId, c, p);
    await job(alice, { type: 'regenerate_section', draft_id: d });
    await expect(
      testDb.pool.query('delete from content_drafts where id = $1', [d]),
    ).rejects.toThrow(/jobs_draft_fk/);
    await expect(testDb.pool.query('delete from campaigns where id = $1', [c])).rejects.toThrow(
      /content_drafts_campaign_fk/,
    );
    await expect(testDb.pool.query('delete from products where id = $1', [p])).rejects.toThrow(
      /campaigns_product_fk/,
    );
  });
});

describe('draft assets and exports integrity (S5.2, D-067)', () => {
  const hash = 'c'.repeat(64);

  async function one(sql: string, values: unknown[]): Promise<string> {
    return (await testDb.pool.query<{ id: string }>(sql, values)).rows[0]!.id;
  }

  async function setup() {
    const tag = Math.random().toString(36).slice(2, 7);
    const alice = await createPerson(testDb.db, SECRET_FOR_TESTS, `alice-${tag}`);
    const bob = await createPerson(testDb.db, SECRET_FOR_TESTS, `bob-${tag}`);
    let n = 0;
    const product = (workspaceId: string) =>
      one('insert into products (workspace_id, name) values ($1, $2) returning id', [
        workspaceId,
        'P',
      ]);
    const asset = (person: { workspaceId: string; userId: string }) => {
      n += 1;
      return one(
        `insert into assets (workspace_id, type, mime_type, size_bytes, original_filename, sha256, storage_key, created_by)
         values ($1, 'image', 'image/png', 10, 'a.png', $2, $3, $4) returning id`,
        [
          person.workspaceId,
          'a'.repeat(64),
          `ws/${person.workspaceId}/${tag}-${n}/original.png`,
          person.userId,
        ],
      );
    };
    const draft = async (person: { workspaceId: string; userId: string }) => {
      const productId = await product(person.workspaceId);
      const campaignId = await one(
        `insert into campaigns (workspace_id, product_id, name, template_id, template_version, language, duration_seconds, created_by)
         values ($1, $2, 'C', 'product-showcase', 1, 'th', 30, $3) returning id`,
        [person.workspaceId, productId, person.userId],
      );
      return one(
        `insert into content_drafts (workspace_id, campaign_id, product_id, sections, section_state)
         values ($1, $2, $3, '{}', '{}') returning id`,
        [person.workspaceId, campaignId, productId],
      );
    };
    const attach = (
      person: { workspaceId: string; userId: string },
      draftId: string,
      assetId: string,
      sortOrder: number,
      role = 'media',
      workspaceId = person.workspaceId,
    ) =>
      testDb.pool.query(
        `insert into draft_assets (workspace_id, draft_id, asset_id, role, sort_order, created_by)
         values ($1, $2, $3, $4, $5, $6)`,
        [workspaceId, draftId, assetId, role, sortOrder, person.userId],
      );
    const exportJob = (person: { workspaceId: string; userId: string }, draftId: string) =>
      one(
        `insert into jobs (workspace_id, type, input, created_by, idempotency_key, request_hash, draft_id)
         values ($1, 'export_package', '{}', $2, $3, $4, $5) returning id`,
        [person.workspaceId, person.userId, `key-${tag}-${(n += 1)}-abcdef`, hash, draftId],
      );
    const exportRow = (
      person: { workspaceId: string; userId: string },
      draftId: string,
      jobId: string,
      extra: {
        status?: string;
        size?: number;
        sha?: string;
        key?: string;
        workspaceId?: string;
      } = {},
    ) =>
      testDb.pool.query(
        `insert into draft_exports (workspace_id, draft_id, job_id, created_by, status, draft_version, file_count, size_bytes, sha256, filename, storage_key, manifest, expires_at)
         values ($1, $2, $3, $4, $5, 1, 1, $6, $7, 'p.zip', $8, '{}', now() + interval '7 days')`,
        [
          extra.workspaceId ?? person.workspaceId,
          draftId,
          jobId,
          person.userId,
          extra.status ?? 'ready',
          extra.size ?? 5,
          extra.sha ?? hash,
          extra.key ?? `exports/${tag}-${(n += 1)}.zip`,
        ],
      );
    return { alice, bob, asset, draft, attach, exportJob, exportRow };
  }

  it('links an asset to a draft inside one workspace, and refuses any cross-workspace link', async () => {
    const { alice, bob, asset, draft, attach } = await setup();
    const aliceDraft = await draft(alice);
    const aliceAsset = await asset(alice);
    const bobAsset = await asset(bob);
    const bobDraft = await draft(bob);
    await attach(alice, aliceDraft, aliceAsset, 0);
    await expect(attach(alice, aliceDraft, bobAsset, 1)).rejects.toThrow(/draft_assets_asset_fk/);
    await expect(attach(alice, bobDraft, aliceAsset, 0)).rejects.toThrow(/draft_assets_draft_fk/);
    // Even when the row claims Bob's workspace, Alice's draft and asset are not Bob's.
    const spare = await asset(alice);
    await expect(attach(bob, aliceDraft, spare, 2, 'media', bob.workspaceId)).rejects.toThrow(
      /draft_assets_(draft|asset)_fk/,
    );
  });

  it('allows one cover per draft, one row per asset and per position, and positions 0 to 9', async () => {
    const { alice, asset, draft, attach } = await setup();
    const d = await draft(alice);
    const [a, b, c] = [await asset(alice), await asset(alice), await asset(alice)];
    await attach(alice, d, a, 0, 'cover');
    await expect(attach(alice, d, b, 1, 'cover')).rejects.toThrow(/draft_assets_one_cover_idx/);
    await expect(attach(alice, d, a, 2)).rejects.toThrow(/draft_assets_pk/);
    await expect(attach(alice, d, b, 0)).rejects.toThrow(/draft_assets_order_unique/);
    await expect(attach(alice, d, c, 10)).rejects.toThrow(/draft_assets_sort_order_check/);
    await expect(attach(alice, d, c, -1)).rejects.toThrow(/draft_assets_sort_order_check/);
    await expect(attach(alice, d, c, 1, 'poster')).rejects.toThrow(/draft_assets_role_check/);
    await attach(alice, d, c, 9);
  });

  it('accepts only the four storyboard scenes and a generator name of at most 60 characters', async () => {
    const { alice, asset, draft } = await setup();
    const d = await draft(alice);
    const insert = (
      assetId: string,
      order: number,
      scene: string | null,
      generator: string | null,
    ) =>
      testDb.pool.query(
        `insert into draft_assets (workspace_id, draft_id, asset_id, sort_order, scene, ai_generated, generator, created_by)
         values ($1, $2, $3, $4, $5, true, $6, $7)`,
        [alice.workspaceId, d, assetId, order, scene, generator, alice.userId],
      );
    await insert(await asset(alice), 0, 'product_hero', 'Meta AI');
    await insert(await asset(alice), 1, null, null);
    await expect(insert(await asset(alice), 2, 'intro', null)).rejects.toThrow(
      /draft_assets_scene_check/,
    );
    await expect(insert(await asset(alice), 3, 'usage', 'x'.repeat(61))).rejects.toThrow(
      /draft_assets_generator_length/,
    );
  });

  it('refuses to hard-delete an attached asset', async () => {
    const { alice, asset, draft, attach } = await setup();
    const d = await draft(alice);
    const a = await asset(alice);
    await attach(alice, d, a, 0);
    await expect(testDb.pool.query('delete from assets where id = $1', [a])).rejects.toThrow(
      /draft_assets_asset_fk/,
    );
  });

  it('accepts an export job only with a draft, and an export row only for its own draft and job', async () => {
    const { alice, bob, draft, exportJob, exportRow } = await setup();
    const d = await draft(alice);
    const bobDraft = await draft(bob);
    await expect(
      testDb.pool.query(
        `insert into jobs (workspace_id, type, input, created_by, idempotency_key, request_hash)
         values ($1, 'export_package', '{}', $2, 'key-nodraft-abcdef', $3)`,
        [alice.workspaceId, alice.userId, hash],
      ),
    ).rejects.toThrow(/jobs_target_matches_type/);
    const job = await exportJob(alice, d);
    await exportRow(alice, d, job);
    await expect(exportRow(alice, d, job)).rejects.toThrow(/draft_exports_job_unique/);
    const other = await exportJob(alice, d);
    await expect(exportRow(alice, bobDraft, other)).rejects.toThrow(/draft_exports_draft_fk/);
    await expect(exportRow(alice, d, other, { key: 'exports/same.zip' })).resolves.toBeDefined();
    const third = await exportJob(alice, d);
    await expect(exportRow(alice, d, third, { key: 'exports/same.zip' })).rejects.toThrow(
      /draft_exports_storage_key_unique/,
    );
  });

  it('refuses export rows with a bad status, size or hash', async () => {
    const { alice, draft, exportJob, exportRow } = await setup();
    const d = await draft(alice);
    await expect(
      exportRow(alice, d, await exportJob(alice, d), { status: 'gone' }),
    ).rejects.toThrow(/draft_exports_status_check/);
    await expect(exportRow(alice, d, await exportJob(alice, d), { size: -1 })).rejects.toThrow(
      /draft_exports_counts_check/,
    );
    await expect(exportRow(alice, d, await exportJob(alice, d), { sha: 'xyz' })).rejects.toThrow(
      /draft_exports_sha_format|value too long/,
    );
  });

  it('refuses to hard-delete a draft or job that an export references', async () => {
    const { alice, draft, exportJob, exportRow } = await setup();
    const d = await draft(alice);
    const job = await exportJob(alice, d);
    await exportRow(alice, d, job);
    await expect(testDb.pool.query('delete from jobs where id = $1', [job])).rejects.toThrow(
      /draft_exports_job_fk/,
    );
    await expect(
      testDb.pool.query('delete from content_drafts where id = $1', [d]),
    ).rejects.toThrow(/draft_exports_draft_fk|jobs_draft_fk/);
  });
});
