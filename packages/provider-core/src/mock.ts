import {
  validateVideoPrompts,
  type VideoPromptRequest,
  type VideoPromptScene,
} from './video-prompts.js';
import { ProviderError, type ProviderErrorCode } from './errors.js';
import {
  SECTION_LIMITS,
  SECTION_NAMES,
  isSectionName,
  type DraftSections,
  type SectionName,
  type SectionValue,
} from './sections.js';
import { graphemeLength, normalizeNfc, truncateGraphemes } from './text.js';
import { getTemplate, type ProductTemplate, type TemplateId } from './templates.js';
import type {
  GenerateBriefRequest,
  Language,
  ProductFacts,
  ProviderCallOptions,
  ProviderUsage,
  RegenerateSectionRequest,
  TextProvider,
} from './types.js';
import { validateDraftSections, validateSectionValue } from './validate-output.js';

export const MOCK_PROVIDER_ID = 'mock-text';
export const MOCK_MODEL_ID = 'mock-text-1';

const NAME_MAX_GRAPHEMES = 60;
const TAG_BODY_MAX_GRAPHEMES = 49;
const SELLING_POINTS_IN_SCRIPT_MAX = 5;
const SCRIPT_GRAPHEMES_PER_SECOND = 12;
const MAX_DURATION_SECONDS = 600;
const REGENERATE_ATTEMPTS = 8;
const REGENERATE_OFFSET_SPAN = 5;
const RATE_LIMIT_RETRY_AFTER_MS = 2000;

/** Fault injection lives only in this file. Markers are stripped from all other user text. */
const FAULT_MARKERS: readonly { marker: string; code: ProviderErrorCode }[] = [
  { marker: '[[mock:timeout]]', code: 'TIMEOUT' },
  { marker: '[[mock:5xx]]', code: 'UPSTREAM_5XX' },
  { marker: '[[mock:rate-limited]]', code: 'RATE_LIMITED' },
  { marker: '[[mock:refused]]', code: 'CONTENT_REFUSED' },
];
const INVALID_OUTPUT_MARKER = '[[mock:invalid-output]]';
const ANY_MARKER = /\[\[mock:[^\]]*\]\]/gu;
const TAG_STRIP = /[#!?.,;:'"“”‘’()[\]{}<>/\\|]/gu;

interface LanguageCopy {
  variantLabel: (variantNumber: number) => string;
  hooks: Record<TemplateId, readonly string[]>;
  ctas: readonly string[];
  fillers: readonly string[];
  scenes: readonly string[];
  noPoint: string;
  hashtagFallbacks: readonly string[];
  sceneLabel: (sceneNumber: number) => string;
  audienceLine: (value: string) => string;
  priceLine: (value: string) => string;
  toneLine: (value: string) => string;
}

const COPY: Record<Language, LanguageCopy> = {
  th: {
    variantLabel: (n) => `แบบที่ ${n}`,
    hooks: {
      'product-showcase': [
        'มาดู {name} ให้เห็นกับตาก่อนตัดสินใจ',
        'ถ้ากำลังมองหา {name} คลิปนี้มีรายละเอียดให้ดู',
        'ของชิ้นนี้น่าดูการใช้งานจริงก่อนซื้อ',
      ],
      'problem-solution': [
        'เคยเจอปัญหานี้ไหม ลองดูว่า {name} ช่วยได้หรือเปล่า',
        'ปัญหาแบบนี้กวนใจใช่ไหม คลิปนี้มีแนวทางจาก {name}',
        'ถ้ายังหาวิธีแก้ปัญหาไม่ได้ ลองเริ่มดูจาก {name}',
      ],
      'review-style': [
        'ใช้ {name} มาสักพักแล้ว เลยอยากเล่าให้ฟังตรง ๆ',
        'ขอรีวิว {name} แบบคนใช้จริง ไม่เกินข้อมูลที่มี',
        'ก่อนซื้อ {name} ลองดูประสบการณ์นี้ก่อน',
      ],
    },
    ctas: [
      'กดดูรายละเอียดในลิงก์ได้เลย',
      'เช็กราคาและรายละเอียดก่อนตัดสินใจ',
      'บันทึกคลิปนี้ไว้ดูอีกที',
    ],
    fillers: [
      'ลองดูการใช้งานจริงในชีวิตประจำวันว่าเข้ากับไลฟ์สไตล์ของคุณหรือเปล่า',
      'ดูรายละเอียดตัวสินค้าให้ชัดเจนก่อนตัดสินใจ เพื่อไม่ให้เลือกผิดรุ่น',
      'เทียบความต้องการของคุณกับสิ่งที่สินค้ามีให้ แล้วค่อยเลือก',
      'ถ้ามีคำถามเรื่องการใช้งาน ทิ้งคอมเมนต์ไว้ได้เลย',
      'เก็บคลิปนี้ไว้เป็นข้อมูลประกอบการตัดสินใจ',
      'ขอบคุณที่ดูจนจบ ติดตามคลิปรีวิวอื่น ๆ ได้ที่ช่องนี้',
    ],
    scenes: [
      'เปิดด้วยการโชว์ {name} ให้เห็นภาพรวมทั้งชิ้น',
      'สาธิตการใช้งาน {name} ทีละขั้นตอนให้เห็นกับตา',
      'ซูมไปที่จุดเด่น: {point}',
      'แสดงกลุ่มเป้าหมายและราคาบนหน้าจอ',
      'ปิดด้วยการชวนให้ดูรายละเอียดเพิ่มเติม',
    ],
    noPoint: 'รายละเอียดการใช้งานของ {name}',
    hashtagFallbacks: ['#รีวิว', '#สินค้าแนะนำ', '#ของดีบอกต่อ'],
    sceneLabel: (n) => `ฉาก ${n}: `,
    audienceLine: (value) => `กลุ่มเป้าหมาย: ${value}`,
    priceLine: (value) => `ราคา: ${value}`,
    toneLine: (value) => `โทนการพูด: ${value}`,
  },
  en: {
    variantLabel: (n) => `Variant ${n}`,
    hooks: {
      'product-showcase': [
        'Take a closer look at {name} before you decide',
        'If you are shopping for {name}, watch this first',
        'Here is {name} in action, shown step by step',
      ],
      'problem-solution': [
        'Tired of this problem? See whether {name} can help',
        'That everyday annoyance has a simple starting point: {name}',
        'Still searching for a fix? Start with {name}',
      ],
      'review-style': [
        'I have been using {name} for a while, so here is my honest take',
        'A real-user look at {name}, without the hype',
        'Before you buy {name}, hear about the experience first',
      ],
    },
    ctas: [
      'Check the details in the link below',
      'Compare the price and details before you decide',
      'Save this video for later',
    ],
    fillers: [
      'See how it fits into everyday use and whether it suits your routine.',
      'Look at the details closely before you decide so you pick the right option.',
      'Match what you need against what the product offers, then choose.',
      'If you have questions about how it works, leave a comment below.',
      'Keep this video as a reference when you compare your options.',
      'Thanks for watching to the end, and follow along for more reviews.',
    ],
    scenes: [
      'Open by showing {name} as a whole',
      'Demonstrate how {name} is used, step by step',
      'Zoom in on this point: {point}',
      'Show the target audience and price on screen',
      'Close by inviting viewers to check the details',
    ],
    noPoint: 'How {name} is used day to day',
    hashtagFallbacks: ['#review', '#recommended', '#musthave'],
    sceneLabel: (n) => `Scene ${n}: `,
    audienceLine: (value) => `Target audience: ${value}`,
    priceLine: (value) => `Price: ${value}`,
    toneLine: (value) => `Tone: ${value}`,
  },
};

interface FactsInput {
  name: string;
  points: string[];
  price: string | null;
  audience: string | null;
  tone: string | null;
}

interface BuildArgs {
  language: Language;
  template: ProductTemplate;
  variant: number;
  duration: number;
  input: FactsInput;
}

function throwIfAborted(opts: ProviderCallOptions): void {
  if (opts.signal?.aborted) {
    throw new ProviderError('TIMEOUT');
  }
}

function resolveTemplate(req: GenerateBriefRequest): ProductTemplate {
  const template = getTemplate(req.template.id, req.template.version);
  const validLanguage = req.language === 'th' || req.language === 'en';
  const validDuration =
    Number.isInteger(req.durationSeconds) &&
    req.durationSeconds >= 1 &&
    req.durationSeconds <= MAX_DURATION_SECONDS;
  const validVariant = Number.isSafeInteger(req.variantIndex) && req.variantIndex >= 0;
  if (!template || !validLanguage || !validDuration || !validVariant) {
    throw new ProviderError('INVALID_REQUEST');
  }
  return template;
}

function injectedError(name: string): ProviderError | undefined {
  const hit = FAULT_MARKERS.find((fault) => name.includes(fault.marker));
  if (!hit) {
    return undefined;
  }
  return hit.code === 'RATE_LIMITED'
    ? new ProviderError('RATE_LIMITED', { retryAfterMs: RATE_LIMIT_RETRY_AFTER_MS })
    : new ProviderError(hit.code);
}

function cleanFact(value: string): string {
  return normalizeNfc(value.replace(ANY_MARKER, '')).trim();
}

function nonEmpty(value: string | null): string | null {
  if (value === null) {
    return null;
  }
  const cleaned = cleanFact(value);
  return cleaned.length > 0 ? cleaned : null;
}

/** Name used when the name is only a fault marker, so the invalid-output fault can still run. */
const FALLBACK_NAME = 'Mock product';

function toFactsInput(product: ProductFacts, requestTone: string | null): FactsInput {
  const cleanedName = cleanFact(product.name);
  const fallback = product.name.includes(INVALID_OUTPUT_MARKER) ? FALLBACK_NAME : '';
  const name = truncateGraphemes(cleanedName || fallback, NAME_MAX_GRAPHEMES);
  if (name.length === 0) {
    throw new ProviderError('INVALID_REQUEST');
  }
  return {
    name,
    points: product.sellingPoints.map(cleanFact).filter((point) => point.length > 0),
    price:
      product.priceAmount !== null && product.currency !== null
        ? nonEmpty(`${product.priceAmount} ${product.currency}`)
        : null,
    audience: nonEmpty(product.targetAudience),
    tone: nonEmpty(requestTone) ?? nonEmpty(product.brandTone),
  };
}

/** Replaces each {name} and {point} in one pass, so inserted user text is never re-scanned. */
function fill(template: string, name: string, point = ''): string {
  return template.replace(/\{(name|point)\}/gu, (_match, key: string) =>
    key === 'name' ? name : point,
  );
}

function cyclic<T>(items: readonly T[], index: number): T {
  const item = items[((index % items.length) + items.length) % items.length];
  if (item === undefined) {
    throw new RangeError('cannot pick from an empty list');
  }
  return item;
}

/** FNV-1a, 32-bit. Used only to derive a per-call offset from request content. */
function fnv1a(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}

function hashtagsFor(input: FactsInput, language: Language, variant: number): string[] {
  const bodies = [
    input.name.replace(/\s+/gu, ''),
    ...input.points.map((point) => point.split(/\s+/u).slice(0, 3).join('')),
  ];
  const seen = new Set<string>();
  const tags: string[] = [];
  const push = (tag: string): void => {
    const key = tag.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      tags.push(tag);
    }
  };

  for (const raw of bodies) {
    const body = truncateGraphemes(raw.replace(TAG_STRIP, ''), TAG_BODY_MAX_GRAPHEMES);
    if (body.length > 0) {
      push(`#${body}`);
    }
  }
  const derivedCount = tags.length;
  for (const fallback of COPY[language].hashtagFallbacks) {
    push(fallback);
  }

  const count = Math.min(6, Math.max(3, derivedCount));
  const start = variant % tags.length;
  return [...tags.slice(start), ...tags.slice(0, start)].slice(0, count);
}

function buildSections({ language, template, variant, duration, input }: BuildArgs): DraftSections {
  const copy = COPY[language];
  const name = input.name;

  const hook = fill(cyclic(copy.hooks[template.id], variant), name);
  const cta = cyclic(copy.ctas, variant);

  const pointCount = Math.min(
    input.points.length,
    SELLING_POINTS_IN_SCRIPT_MAX,
    Math.max(1, Math.ceil(duration / 10)),
  );
  const extras: string[] = [];
  if (input.audience !== null) {
    extras.push(copy.audienceLine(truncateGraphemes(input.audience, 200)));
  }
  if (input.price !== null) {
    extras.push(copy.priceLine(truncateGraphemes(input.price, 60)));
  }
  if (input.tone !== null) {
    extras.push(copy.toneLine(truncateGraphemes(input.tone, 120)));
  }
  extras.push(...copy.fillers);

  const target = Math.min(SECTION_LIMITS.script, duration * SCRIPT_GRAPHEMES_PER_SECOND);
  // Extras are cycled when the target is longer than the pool, so the script keeps growing
  // with duration up to the section limit. Each pass adds at least one grapheme, so this ends.
  let script = [hook, ...input.points.slice(0, pointCount)].join('\n');
  for (let index = 0; graphemeLength(script) < target; index += 1) {
    script = `${script}\n${cyclic(extras, index)}`;
  }

  const sceneCount = Math.min(5, Math.max(3, Math.round(duration / 15)));
  const storyboard = Array.from({ length: sceneCount }, (_unused, index) => {
    const point = input.points.length > 0 ? cyclic(input.points, index) : fill(copy.noPoint, name);
    const scene = `${copy.sceneLabel(index + 1)}${fill(cyclic(copy.scenes, index + variant), name, point)}`;
    return truncateGraphemes(scene, SECTION_LIMITS.storyboardScene);
  });

  return {
    title: truncateGraphemes(
      `${name} | ${template.name[language]} (${copy.variantLabel(variant + 1)})`,
      SECTION_LIMITS.title,
    ),
    hook: truncateGraphemes(hook, SECTION_LIMITS.hook),
    script: truncateGraphemes(script, SECTION_LIMITS.script),
    storyboard,
    caption: truncateGraphemes(
      [hook, ...input.points.slice(0, 3), cta].join(' '),
      SECTION_LIMITS.caption,
    ),
    hashtags: hashtagsFor(input, language, variant),
    callToAction: truncateGraphemes(cta, SECTION_LIMITS.callToAction),
  };
}

function sectionUnits(value: SectionValue): number {
  return Array.isArray(value)
    ? value.reduce((total, item) => total + graphemeLength(item), 0)
    : graphemeLength(value);
}

function invalidValue(section: SectionName): SectionValue {
  switch (section) {
    case 'storyboard':
      return [];
    case 'hashtags':
      return ['missing-hash-prefix'];
    default:
      return '';
  }
}

function validateCurrent(current: DraftSections): DraftSections {
  try {
    return validateDraftSections(current);
  } catch {
    throw new ProviderError('INVALID_REQUEST');
  }
}

const MOCK_SHOT_END = 'No on-screen text, no logos, no watermarks.';

/** One calm, single-shot English prompt per scene, from the product name and its selling points. */
function mockVideoScenes(
  req: VideoPromptRequest,
): { scene: string; prompt: string; voiceover: string }[] {
  const name = truncateGraphemes(cleanFact(req.product.name), NAME_MAX_GRAPHEMES) || FALLBACK_NAME;
  const subject = `the product "${name}"`;
  const point = (index: number) =>
    truncateGraphemes(cleanFact(req.product.sellingPoints[index] ?? ''), 60) || name;
  const seconds = req.clipSeconds ?? 8;
  const say = (th: string, en: string) => (req.language === 'th' ? th : en);
  const prompt = (body: string) =>
    `Vertical 9:16 video. ${body} One continuous ${seconds}-second shot. ${MOCK_SHOT_END}`;
  return [
    {
      scene: 'product_hero',
      prompt: prompt(
        `${subject} stands alone on a clean surface in a bright studio, the camera slowly pushing in, soft directional light, premium modern style.`,
      ),
      voiceover: say(`แนะนำ ${name}`, `Meet ${name}`),
    },
    {
      scene: 'detail',
      prompt: prompt(
        `A macro close-up of ${subject} focusing on this feature: ${point(0)}. The camera pans slowly across it, soft rim light, sharp detailed style.`,
      ),
      voiceover: say(point(0), point(0)),
    },
    {
      scene: 'usage',
      prompt: prompt(
        `A person in everyday clothes uses ${subject} naturally in a bright home setting, the camera gently orbiting, warm daylight, relaxed lifestyle style.`,
      ),
      voiceover: say(`ใช้งานง่ายในชีวิตประจำวัน`, `Easy to use every day`),
    },
    {
      scene: 'final_shot',
      prompt: prompt(
        `${subject} centred on a light wooden table, the camera calm and still, golden window light, leaving clean space for a call to action.`,
      ),
      voiceover: say(`สนใจกดดูรายละเอียดได้เลย`, `Tap to see the details`),
    },
  ];
}

/**
 * Deterministic text provider for development without paid credentials.
 * Every output is a pure function of the request.
 */
export class MockTextProvider implements TextProvider {
  readonly id = MOCK_PROVIDER_ID;

  async generateBrief(
    req: GenerateBriefRequest,
    opts: ProviderCallOptions = {},
  ): Promise<{ output: DraftSections; usage: ProviderUsage; model: string }> {
    throwIfAborted(opts);
    const template = resolveTemplate(req);
    const fault = injectedError(req.product.name);
    if (fault) {
      throw fault;
    }
    const input = toFactsInput(req.product, req.tone);
    const built = buildSections({
      language: req.language,
      template,
      variant: req.variantIndex,
      duration: req.durationSeconds,
      input,
    });

    const output = req.product.name.includes(INVALID_OUTPUT_MARKER)
      ? { ...built, title: '' }
      : validateDraftSections(built);

    const outputUnits = SECTION_NAMES.reduce(
      (total, section) => total + sectionUnits(output[section]),
      0,
    );
    return {
      output,
      usage: { inputUnits: graphemeLength(JSON.stringify(req)), outputUnits },
      model: MOCK_MODEL_ID,
    };
  }

  /** Template video prompts: built only from the product facts, no model, no cost. */
  async generateVideoPrompts(
    req: VideoPromptRequest,
    opts: ProviderCallOptions = {},
  ): Promise<{ scenes: VideoPromptScene[]; usage: ProviderUsage; model: string }> {
    throwIfAborted(opts);
    const fault = injectedError(req.product.name);
    if (fault) {
      throw fault;
    }
    const scenes = validateVideoPrompts({ scenes: mockVideoScenes(req) }, req.product);
    return {
      scenes,
      usage: { inputUnits: graphemeLength(JSON.stringify(req)), outputUnits: 400 },
      model: MOCK_MODEL_ID,
    };
  }

  async regenerateSection(
    req: RegenerateSectionRequest,
    opts: ProviderCallOptions = {},
  ): Promise<{ section: SectionName; value: SectionValue; usage: ProviderUsage; model: string }> {
    throwIfAborted(opts);
    const template = resolveTemplate(req);
    const fault = injectedError(req.product.name);
    if (fault) {
      throw fault;
    }
    if (!isSectionName(req.section)) {
      throw new ProviderError('INVALID_REQUEST');
    }
    const current = validateCurrent(req.current);
    const input = toFactsInput(req.product, req.tone);
    const previous = current[req.section];
    const previousKey = JSON.stringify(previous);

    const base = req.variantIndex + 1 + (fnv1a(previousKey) % REGENERATE_OFFSET_SPAN);
    let value: SectionValue = previous;
    for (let attempt = 0; attempt < REGENERATE_ATTEMPTS; attempt += 1) {
      value = buildSections({
        language: req.language,
        template,
        variant: base + attempt,
        duration: req.durationSeconds,
        input,
      })[req.section];
      if (JSON.stringify(value) !== previousKey) {
        break;
      }
    }

    const result = req.product.name.includes(INVALID_OUTPUT_MARKER)
      ? invalidValue(req.section)
      : validateSectionValue(req.section, value);

    return {
      section: req.section,
      value: result,
      usage: {
        inputUnits: graphemeLength(JSON.stringify(req)),
        outputUnits: sectionUnits(result),
      },
      model: MOCK_MODEL_ID,
    };
  }
}
