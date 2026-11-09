import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { APIRequestContext } from '@playwright/test';

import { expect } from './fixtures.js';

export const API_URL = 'http://localhost:3000';
const here = path.dirname(fileURLToPath(import.meta.url));
// `pg` belongs to the API package; the suite uses it only to put a finished draft in place,
// because this suite runs no worker.
const { Client } = createRequire(path.resolve(here, '..', '..', 'api', 'package.json'))('pg') as {
  Client: new (options: { connectionString: string }) => {
    connect(): Promise<void>;
    query(text: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
    end(): Promise<void>;
  };
};

export async function api<T>(
  request: APIRequestContext,
  token: string,
  method: 'GET' | 'POST',
  route: string,
  data?: unknown,
): Promise<T> {
  const response = await request.fetch(`${API_URL}${route}`, {
    method,
    headers: { authorization: `Bearer ${token}` },
    ...(data === undefined ? {} : { data }),
  });
  expect(response.ok(), await response.text()).toBe(true);
  return (await response.json()) as T;
}

const SECTIONS = {
  title: 'Title',
  hook: 'Hook',
  script: 'Script',
  storyboard: ['hero prompt', 'detail prompt', 'usage prompt', 'final prompt'],
  caption: 'Caption',
  hashtags: [],
  callToAction: 'Call to action',
};

/**
 * Does what the worker would do for a campaign: a draft with four storyboard lines, and its
 * generate job marked succeeded (creating the job first when the campaign has none).
 */
export async function finishGeneration(
  workspaceId: string,
  userId: string,
  campaignId: string,
  productId: string,
): Promise<string> {
  const sectionState = Object.fromEntries(
    Object.keys(SECTIONS).map((key) => [key, { rev: 1, origin: 'generated', jobId: null }]),
  );
  const db = new Client({ connectionString: process.env.DATABASE_URL as string });
  await db.connect();
  try {
    const draft = await db.query(
      `insert into content_drafts (workspace_id, campaign_id, product_id, sections, section_state)
       values ($1, $2, $3, $4, $5) returning id`,
      [workspaceId, campaignId, productId, SECTIONS, sectionState],
    );
    const output = { draftIds: [draft.rows[0]?.id] };
    const updated = await db.query(
      `update jobs set status = 'succeeded', output = $3, attempts = 1,
              started_at = now(), finished_at = now()
        where workspace_id = $1 and campaign_id = $2 and type = 'generate_brief'`,
      [workspaceId, campaignId, output],
    );
    if (updated.rowCount === 0) {
      await db.query(
        `insert into jobs (workspace_id, type, status, input, created_by, idempotency_key, request_hash,
                           campaign_id, attempts, started_at, finished_at, output)
         values ($1, 'generate_brief', 'succeeded', '{}', $2, $3, repeat('a', 64), $4, 1, now(), now(), $5)`,
        [workspaceId, userId, `seed-${campaignId}`, campaignId, output],
      );
    }
    return draft.rows[0]?.id as string;
  } finally {
    await db.end();
  }
}

/** A campaign whose generate job succeeded and whose draft holds four storyboard lines. */
export async function finishedCampaign(
  request: APIRequestContext,
  name: string,
): Promise<{ token: string; workspaceId: string; draftId: string }> {
  const { token } = (await (await request.post(`${API_URL}/api/v1/auth/mock-token`)).json()) as {
    token: string;
  };
  const me = await api<{ user: { id: string }; workspaces: { id: string }[] }>(
    request,
    token,
    'GET',
    '/api/v1/me',
  );
  const workspaceId = me.workspaces[0]?.id as string;
  const ws = `/api/v1/workspaces/${encodeURIComponent(workspaceId)}`;
  const product = await api<{ id: string }>(request, token, 'POST', `${ws}/products`, {
    name: `สินค้า ${name}`,
  });
  const templates = await api<{ items: { id: string; version: number }[] }>(
    request,
    token,
    'GET',
    `${ws}/templates`,
  );
  const template = templates.items[0] as { id: string; version: number };
  const campaign = await api<{ id: string }>(request, token, 'POST', `${ws}/campaigns`, {
    productId: product.id,
    templateId: template.id,
    templateVersion: template.version,
    name,
    language: 'th',
    platform: 'tiktok',
    variants: 1,
  });

  const draftId = await finishGeneration(workspaceId, me.user.id, campaign.id, product.id);
  return { token, workspaceId, draftId };
}
