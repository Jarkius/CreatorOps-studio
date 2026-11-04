import type { Draft, DraftSections, Job, SectionName, Workspace } from '@creatorops/contracts';

import { createFakeApi, json, WORKSPACE } from '../../test/fakeApi.js';
import type { RecordedCall } from '../../test/fakeApi.js';
import {
  createContentFetch,
  createFakeContentApi,
  makeCampaign,
  makeDraft,
} from '../../test/fakeContentApi.js';
import { renderWeb } from '../../test/renderWeb.js';

export const WS = WORKSPACE.id;
export const CAMPAIGN_ID = 'camp_1';
export const DRAFT_ID = 'draft_1';
export const DRAFT_PATH = `/w/${WS}/drafts/${DRAFT_ID}`;
const DRAFT_API = `/api/v1/workspaces/${WS}/drafts/${DRAFT_ID}`;

/** Thai and mixed Thai/Latin text. "ที่ น้ำ" keeps its combining marks and a space. */
export const SECTIONS: DraftSections = {
  title: 'พัดลมตั้งโต๊ะ Desk Fan ลมเย็นสบาย',
  hook: 'ร้อนแบบนี้ ต้องมีพัดลมที่ น้ำหนักเบา',
  script: 'เปิดด้วยการใช้งานจริงบนโต๊ะทำงาน แล้วแสดงระดับลมที่ปรับได้',
  storyboard: ['ฉากที่ 1: วางพัดลมบนโต๊ะ', 'ฉากที่ 2: ปรับระดับลม'],
  caption: 'พัดลมตั้งโต๊ะ ลมเย็น เสียงเบา ใช้ได้ทั้งวัน',
  hashtags: ['#พัดลม', '#DeskFan'],
  callToAction: 'กดดูรายละเอียดสินค้า',
};

/** A fresh draft (the fake mutates the objects it holds, so every test gets its own). */
export function makeScreenDraft(overrides: Partial<Draft> = {}): Draft {
  return makeDraft({
    id: DRAFT_ID,
    campaignId: CAMPAIGN_ID,
    variantIndex: 1,
    ...overrides,
    sections: overrides.sections ?? {
      ...SECTIONS,
      storyboard: [...SECTIONS.storyboard],
      hashtags: [...SECTIONS.hashtags],
    },
  });
}

export interface DraftSetupOptions {
  role?: Workspace['role'];
  draft?: Draft;
  path?: string;
  jobs?: Job[];
  regenerateValue?: Parameters<typeof createFakeContentApi>[0] extends infer O
    ? O extends { regenerateValue?: infer F }
      ? F
      : never
    : never;
  /** Holds every PATCH until the promise resolves (to see the saving state). */
  gate?: Promise<void>;
  /** Answers the draft GET with a 500 (to see the error state). */
  failDraftGet?: boolean;
  /** Answers the regenerate POST with a 500. */
  failRegenerate?: boolean;
}

/** The draft screen wired to the content fake, with every request's Idempotency-Key recorded. */
export function renderDraft(options: DraftSetupOptions = {}) {
  const draft = options.draft ?? makeScreenDraft();
  const content = createFakeContentApi({
    campaigns: [makeCampaign({ id: CAMPAIGN_ID, name: 'แคมเปญพัดลม', productId: 'prod_1' })],
    drafts: [draft],
    jobs: options.jobs,
    regenerateValue: options.regenerateValue,
  });
  const intercept = async (call: RecordedCall) => {
    if (call.method === 'GET' && options.failDraftGet && call.path.startsWith(DRAFT_API)) {
      return json(
        { error: { code: 'INTERNAL_ERROR', message: 'Boom.', requestId: 'req-test' } },
        500,
      );
    }
    if (
      call.method === 'POST' &&
      options.failRegenerate &&
      call.path.endsWith('/jobs/regenerate-section')
    ) {
      return json(
        {
          error: { code: 'INTERNAL_ERROR', message: 'Regenerate is down.', requestId: 'req-test' },
        },
        500,
      );
    }
    if (call.method === 'PATCH' && options.gate !== undefined) await options.gate;
    return content.intercept(call);
  };
  const api = createFakeApi({
    workspaces: [{ ...WORKSPACE, role: options.role ?? 'owner' }],
    intercept,
  });
  const wire = createContentFetch(api.fetch);
  const view = renderWeb(options.path ?? DRAFT_PATH, { ...api, fetch: wire.fetch });
  return { ...view, api, content, keys: wire.keys, draft };
}

/** The card of one section (its heading is a level-3 heading named by the section label). */
export function sectionCard(label: string): HTMLElement {
  const found = Array.from(document.querySelectorAll('h3')).find(
    (item) => item.textContent === label,
  );
  if (found === undefined) throw new Error(`no card ${label}`);
  const card = found.closest('section');
  if (card === null) throw new Error(`no section for ${label}`);
  return card;
}

export const SECTION_LABEL: Record<SectionName, string> = {
  title: 'Title',
  hook: 'Hook',
  script: 'Script',
  storyboard: 'Storyboard',
  caption: 'Caption',
  hashtags: 'Hashtags',
  callToAction: 'Call to action',
};
