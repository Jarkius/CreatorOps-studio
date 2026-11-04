import type {
  Campaign,
  Draft,
  DraftSections,
  DraftStatus,
  Job,
  JobStatus,
  SectionName,
  Template,
} from '@creatorops/contracts';
import { SECTION_NAMES } from '@creatorops/contracts';

import { json } from './fakeApi.js';
import type { RecordedCall } from './fakeApi.js';

const T = '2026-11-03T00:00:00.000Z';

export function makeTemplate(overrides: Partial<Template> & { id: string }): Template {
  return {
    version: 1,
    name: { th: 'โชว์สินค้า', en: 'Product showcase' },
    description: {
      th: 'โชว์สินค้า การใช้งาน และจุดเด่นตามข้อมูลที่กรอกไว้',
      en: 'Shows the product, how it is used, and its listed selling points.',
    },
    defaultDurationSeconds: 30,
    ...overrides,
  };
}

export function makeCampaign(overrides: Partial<Campaign> & { id: string }): Campaign {
  return {
    workspaceId: 'ws_1',
    productId: 'prod_1',
    name: 'Campaign',
    templateId: 'product-showcase',
    templateVersion: 1,
    language: 'th',
    tone: null,
    platform: 'generic',
    durationSeconds: 30,
    variants: 1,
    status: 'active',
    version: 1,
    createdAt: T,
    updatedAt: T,
    ...overrides,
  };
}

export function makeDraft(overrides: Partial<Draft> & { id: string; campaignId: string }): Draft {
  const sectionState = Object.fromEntries(
    SECTION_NAMES.map((name) => [name, { rev: 1, origin: 'generated', jobId: null }]),
  ) as Draft['sectionState'];
  return {
    workspaceId: 'ws_1',
    productId: 'prod_1',
    variantIndex: 0,
    sections: {
      title: 'พัดลมตั้งโต๊ะ Desk Fan ลมเย็นสบาย',
      hook: 'ร้อนแบบนี้ ต้องมีพัดลมที่น้ำหนักเบา',
      script: 'เปิดด้วยการใช้งานจริงบนโต๊ะทำงาน แล้วแสดงระดับลมที่ปรับได้',
      storyboard: ['ฉากที่ 1: วางพัดลมบนโต๊ะ', 'ฉากที่ 2: ปรับระดับลม'],
      caption: 'พัดลมตั้งโต๊ะ ลมเย็น เสียงเบา ใช้ได้ทั้งวัน',
      hashtags: ['#พัดลม', '#DeskFan'],
      callToAction: 'กดดูรายละเอียดสินค้า',
    },
    sectionState,
    claimWarnings: [],
    needsReview: false,
    status: 'draft',
    version: 1,
    createdAt: T,
    updatedAt: T,
    ...overrides,
  };
}

export function makeJob(overrides: Partial<Job> & { id: string }): Job {
  const campaignId = overrides.campaignId ?? null;
  return {
    workspaceId: 'ws_1',
    type: 'generate_brief',
    status: 'queued',
    input: campaignId === null ? {} : { campaignId },
    output: null,
    errorCode: null,
    errorMessage: null,
    provider: null,
    attempts: 0,
    maxAttempts: 3,
    campaignId,
    draftId: null,
    createdAt: T,
    startedAt: null,
    finishedAt: null,
    ...overrides,
  };
}

export interface ContentFakeOptions {
  campaigns?: Campaign[];
  drafts?: Draft[];
  jobs?: Job[];
  /** Defaults to product-showcase v1 and review-style v2 (the second one is a fake version). */
  templates?: Template[];
  /** Rows per page for lists. The request's own `limit` also applies. Defaults to 25. */
  pageSize?: number;
  /** The drafts a succeeded brief job writes. Defaults to one draft per variant. */
  draftsOnSuccess?: (job: Job, campaign: Campaign) => Draft[];
  /** The next N generate-brief requests create their job, then the connection drops (no response). */
  loseBriefResponses?: number;
  /** The next N generate-brief requests (after the key check) get this error and create nothing. */
  briefErrors?: { status: number; code: string; message: string }[];
  /** The value a succeeded regenerate-section job writes. Defaults to a Thai placeholder per section. */
  regenerateValue?: (draft: Draft, section: SectionName) => DraftSections[SectionName];
}

export interface ContentFakeApi {
  intercept: (call: RecordedCall) => Promise<Response | undefined>;
  campaigns: Campaign[];
  drafts: Draft[];
  jobs: Job[];
  templates: Template[];
  /** Moves a job to a new status (what the worker would do) and returns a copy. */
  advanceJob(id: string, status: JobStatus, patch?: Partial<Job>): Job;
  /** Simulates another editor saving one section: rev + 1, origin edited, version + 1, status rules as in PATCH. */
  editElsewhere(draftId: string, section: SectionName, value: DraftSections[SectionName]): void;
}

export const PRODUCT_SHOWCASE = makeTemplate({ id: 'product-showcase' });
export const REVIEW_STYLE = makeTemplate({
  id: 'review-style',
  version: 2,
  name: { th: 'รีวิวสไตล์ผู้ใช้จริง', en: 'Real user review style' },
  description: {
    th: 'เล่าประสบการณ์การใช้งานแบบคนใช้จริง',
    en: 'A first-person account of using the product.',
  },
  defaultDurationSeconds: 45,
});

/**
 * createFakeApi calls `intercept` without the request headers. createContentFetch (below) stores
 * the Idempotency-Key of the request in flight here, synchronously, just before it delegates.
 * The intercept reads it on its first line, before any await, so it always sees its own request.
 */
let activeKey: string | null = null;

export interface ContentFetchRecord {
  method: string;
  path: string;
  /** The Idempotency-Key header as sent, or null when the request had none. */
  key: string | null;
}

/** Wraps the fake fetch and records every request's Idempotency-Key header in `keys`. */
export function createContentFetch(baseFetch: typeof fetch): {
  fetch: typeof fetch;
  keys: ContentFetchRecord[];
} {
  const keys: ContentFetchRecord[] = [];
  const recordingFetch = async (
    input: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> => {
    const url = new URL(
      typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
    );
    const key = new Headers(init?.headers).get('idempotency-key');
    keys.push({ method: init?.method ?? 'GET', path: `${url.pathname}${url.search}`, key });
    activeKey = key;
    try {
      return await baseFetch(input, init);
    } finally {
      activeKey = null;
    }
  };
  return { fetch: recordingFetch as typeof fetch, keys };
}

function fail(status: number, code: string, message: string, details?: unknown): Response {
  return json(
    {
      error: {
        code,
        message,
        requestId: 'req-test',
        ...(details === undefined ? {} : { details }),
      },
    },
    status,
  );
}

/** The value a regenerate job writes when the test does not choose one. */
function defaultRegenerated(section: SectionName): DraftSections[SectionName] {
  switch (section) {
    case 'storyboard':
      return ['ฉากใหม่'];
    case 'hashtags':
      return ['#ใหม่'];
    default:
      return `ข้อความใหม่ ${section}`;
  }
}

/** Writes the sections whose value really changes (rev + 1, origin edited). Returns whether any did. */
function applySectionChanges(draft: Draft, changes: Partial<DraftSections>): boolean {
  let changed = false;
  for (const name of SECTION_NAMES) {
    const value = changes[name];
    if (value === undefined) continue;
    if (JSON.stringify(value) === JSON.stringify(draft.sections[name])) continue;
    (draft.sections as Record<string, unknown>)[name] = value;
    draft.sectionState[name] = {
      rev: draft.sectionState[name].rev + 1,
      origin: 'edited',
      jobId: null,
    };
    changed = true;
  }
  return changed;
}

function page<T>(items: T[], limit: number, cursor: string | null) {
  const offset = Number(cursor ?? '0');
  const slice = items.slice(offset, offset + limit);
  const more = offset + limit < items.length;
  return { items: slice, nextCursor: more ? String(offset + limit) : null };
}

/** Fake content endpoints: templates, campaigns, drafts and jobs, with the job rules of the API. */
export function createFakeContentApi(options: ContentFakeOptions = {}): ContentFakeApi {
  const campaigns = [...(options.campaigns ?? [])];
  const drafts = [...(options.drafts ?? [])];
  const jobs = [...(options.jobs ?? [])];
  const templates = options.templates ?? [PRODUCT_SHOWCASE, REVIEW_STYLE];
  const pageSize = options.pageSize ?? 25;
  const keyed = new Map<string, { body: string; job: Job }>();
  const briefErrors = [...(options.briefErrors ?? [])];
  let loseBriefResponses = options.loseBriefResponses ?? 0;
  let nextId = 1;

  const listLimit = (url: URL) => Math.min(Number(url.searchParams.get('limit') ?? '25'), pageSize);

  const defaultDrafts = (job: Job, campaign: Campaign): Draft[] =>
    Array.from({ length: campaign.variants }, (_, index) =>
      makeDraft({
        id: `draft_${campaign.id}_${index + 1}`,
        campaignId: campaign.id,
        productId: campaign.productId,
        workspaceId: job.workspaceId,
        variantIndex: index,
      }),
    );

  const generateBrief = (
    ws: string,
    url: URL,
    body: unknown,
    key: string | null,
    bodyText: string,
  ): Response | Error => {
    void url;
    if (!key) return fail(400, 'VALIDATION_ERROR', 'Send an Idempotency-Key header.');
    const campaignId = (body as { campaignId?: unknown } | undefined)?.campaignId;
    const campaign = campaigns.find((item) => item.workspaceId === ws && item.id === campaignId);
    if (campaign === undefined) return fail(404, 'NOT_FOUND', 'Campaign not found.');
    const stored = keyed.get(key);
    if (stored !== undefined) {
      if (stored.body === bodyText) return json(stored.job, 200);
      return fail(
        409,
        'IDEMPOTENCY_CONFLICT',
        'This Idempotency-Key was already used for a different request.',
      );
    }
    if (campaign.status === 'archived') {
      return fail(409, 'CONFLICT', 'Archived campaigns cannot be generated.');
    }
    const briefError = briefErrors.shift();
    if (briefError !== undefined) {
      return fail(briefError.status, briefError.code, briefError.message);
    }
    const job = makeJob({
      id: `job_${nextId++}`,
      workspaceId: ws,
      campaignId: campaign.id,
    });
    jobs.push(job);
    keyed.set(key, { body: bodyText, job });
    if (loseBriefResponses > 0) {
      loseBriefResponses -= 1;
      return new TypeError('connection lost');
    }
    return json(job, 202);
  };

  const regenerateSection = (ws: string, body: unknown, key: string | null, bodyText: string) => {
    if (!key) return fail(400, 'VALIDATION_ERROR', 'Send an Idempotency-Key header.');
    const input = (body ?? {}) as { draftId?: unknown; section?: unknown; expectedRev?: unknown };
    const draft = drafts.find((item) => item.workspaceId === ws && item.id === input.draftId);
    if (draft === undefined) return fail(400, 'VALIDATION_ERROR', 'Draft not found.');
    const stored = keyed.get(key);
    if (stored !== undefined) {
      if (stored.body === bodyText) return json(stored.job, 200);
      return fail(
        409,
        'IDEMPOTENCY_CONFLICT',
        'This Idempotency-Key was already used for a different request.',
      );
    }
    const section = input.section as SectionName;
    if (draft.sectionState[section].rev !== input.expectedRev) {
      return fail(409, 'CONFLICT', 'This section changed since you loaded it.');
    }
    const job = makeJob({
      id: `job_${nextId++}`,
      workspaceId: ws,
      type: 'regenerate_section',
      campaignId: null,
      draftId: draft.id,
      input: { draftId: draft.id, section, expectedRev: input.expectedRev },
    });
    jobs.push(job);
    keyed.set(key, { body: bodyText, job });
    return json(job, 202);
  };

  const intercept = async (call: RecordedCall): Promise<Response | undefined> => {
    const key = activeKey;
    const url = new URL(call.path, 'http://fake.test');
    const parts = url.pathname.split('/');
    if (parts[1] !== 'api' || parts[2] !== 'v1' || parts[3] !== 'workspaces') return undefined;
    const ws = decodeURIComponent(parts[4] ?? '');
    const resource = parts[5];
    const id = parts[6] === undefined ? undefined : decodeURIComponent(parts[6]);
    const action = parts[7];
    const method = call.method;

    if (resource === 'templates' && method === 'GET' && id === undefined) {
      return json({ items: templates });
    }

    if (resource === 'campaigns') {
      if (id === undefined && method === 'GET') {
        const status = url.searchParams.get('status');
        const matching = campaigns.filter(
          (item) => item.workspaceId === ws && (status === null || item.status === status),
        );
        return json(page(matching, listLimit(url), url.searchParams.get('cursor')));
      }
      if (id === undefined && method === 'POST') {
        const input = call.body as Record<string, unknown>;
        const template = templates.find((item) => item.id === input.templateId);
        const created = makeCampaign({
          id: `camp_${nextId++}`,
          workspaceId: ws,
          productId: String(input.productId),
          name: typeof input.name === 'string' ? input.name : (template?.name.en ?? 'Campaign'),
          templateId: String(input.templateId),
          templateVersion: Number(input.templateVersion),
          language: (input.language as Campaign['language'] | undefined) ?? 'th',
          tone: typeof input.tone === 'string' ? input.tone : null,
          platform: (input.platform as Campaign['platform'] | undefined) ?? 'generic',
          durationSeconds:
            typeof input.durationSeconds === 'number'
              ? input.durationSeconds
              : (template?.defaultDurationSeconds ?? 30),
          variants: Number(input.variants ?? 1),
        });
        campaigns.push(created);
        return json(created, 201);
      }
      const campaign = campaigns.find((item) => item.workspaceId === ws && item.id === id);
      if (campaign === undefined) return fail(404, 'NOT_FOUND', 'Campaign not found.');
      if (action === undefined && method === 'GET') return json(campaign);
      if (action === undefined && method === 'PATCH') {
        const { version, ...changes } = call.body as Record<string, unknown> & { version: number };
        if (version !== campaign.version) {
          return fail(409, 'CONFLICT', 'The campaign was changed by someone else.', {
            currentVersion: campaign.version,
          });
        }
        Object.assign(campaign, changes, { version: campaign.version + 1 });
        return json(campaign);
      }
      return undefined;
    }

    if (resource === 'drafts' && method === 'GET' && id === undefined) {
      const campaignId = url.searchParams.get('campaignId');
      const matching = drafts.filter(
        (item) =>
          item.workspaceId === ws && (campaignId === null || item.campaignId === campaignId),
      );
      return json(page(matching, listLimit(url), url.searchParams.get('cursor')));
    }
    if (resource === 'drafts' && method === 'GET' && id !== undefined) {
      const draft = drafts.find((item) => item.workspaceId === ws && item.id === id);
      return draft === undefined ? fail(404, 'NOT_FOUND', 'Draft not found.') : json(draft);
    }
    if (resource === 'drafts' && method === 'PATCH' && id !== undefined && action === undefined) {
      const draft = drafts.find((item) => item.workspaceId === ws && item.id === id);
      if (draft === undefined) return fail(404, 'NOT_FOUND', 'Draft not found.');
      const body = call.body as {
        version: number;
        sections?: Partial<DraftSections>;
        status?: DraftStatus;
      };
      if (body.version !== draft.version) {
        return fail(409, 'CONFLICT', 'The draft was changed by someone else.', {
          currentVersion: draft.version,
        });
      }
      const contentChanged = applySectionChanges(draft, body.sections ?? {});
      const statusChanged = body.status !== undefined && body.status !== draft.status;
      if (!contentChanged && !statusChanged) return json(draft);
      if (body.status !== undefined) {
        draft.status = body.status;
      } else if (contentChanged) {
        draft.status = 'draft';
      }
      draft.version += 1;
      return json(draft);
    }

    if (resource === 'jobs') {
      if (id === 'generate-brief' && method === 'POST') {
        const bodyText = JSON.stringify(call.body);
        const result = generateBrief(ws, url, call.body, key, bodyText);
        if (result instanceof Error) throw result;
        return result;
      }
      if (id === 'regenerate-section' && method === 'POST') {
        return regenerateSection(ws, call.body, key, JSON.stringify(call.body));
      }
      if (id === undefined && method === 'GET') {
        return json(
          page(
            jobs.filter((item) => item.workspaceId === ws),
            listLimit(url),
            null,
          ),
        );
      }
      const job = jobs.find((item) => item.workspaceId === ws && item.id === id);
      if (job === undefined) return fail(404, 'NOT_FOUND', 'Job not found.');
      if (action === undefined && method === 'GET') return json(job);
      if (action === 'cancel' && method === 'POST') {
        // A queued job is cancelled at once. A running job is only asked to stop: the worker decides.
        if (job.status === 'queued') {
          job.status = 'cancelled';
          job.finishedAt = T;
          return json(job);
        }
        if (job.status === 'running') return json(job);
        return fail(409, 'CONFLICT', 'This job has already finished.');
      }
    }

    return undefined;
  };

  const advanceJob = (id: string, status: JobStatus, patch: Partial<Job> = {}): Job => {
    const job = jobs.find((item) => item.id === id);
    if (job === undefined) throw new Error(`no job ${id}`);
    Object.assign(job, patch, { status });
    if (status === 'running') job.attempts = Math.max(job.attempts, 1);
    if (status === 'succeeded' || status === 'failed' || status === 'cancelled') {
      job.finishedAt = T;
    }
    if (status === 'succeeded' && job.type === 'generate_brief') {
      const campaign = campaigns.find((item) => item.id === job.campaignId);
      if (campaign !== undefined) {
        drafts.push(...(options.draftsOnSuccess ?? defaultDrafts)(job, campaign));
      }
    }
    if (status === 'succeeded' && job.type === 'regenerate_section') {
      const draft = drafts.find((item) => item.id === job.draftId);
      const section = job.input.section as SectionName;
      if (draft !== undefined) {
        const value = options.regenerateValue?.(draft, section) ?? defaultRegenerated(section);
        (draft.sections as Record<string, unknown>)[section] = value;
        draft.sectionState[section] = {
          rev: draft.sectionState[section].rev + 1,
          origin: 'generated',
          jobId: job.id,
        };
        // The worker moves the draft back to Draft when it writes a section (D-058).
        draft.status = 'draft';
        draft.version += 1;
      }
    }
    return { ...job };
  };

  const editElsewhere = (
    draftId: string,
    section: SectionName,
    value: DraftSections[SectionName],
  ) => {
    const draft = drafts.find((item) => item.id === draftId);
    if (draft === undefined) throw new Error(`no draft ${draftId}`);
    const changes = { [section]: value } as Partial<DraftSections>;
    if (applySectionChanges(draft, changes)) {
      if (draft.status !== 'draft') draft.status = 'draft';
      draft.version += 1;
    }
  };

  return { intercept, campaigns, drafts, jobs, templates, advanceJob, editElsewhere };
}
