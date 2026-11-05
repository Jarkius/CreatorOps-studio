import {
  META_AI_CHUNK_BYTES,
  META_AI_LOAD_TIMEOUT_MS,
  META_AI_LOGIN_TIMEOUT_MS,
  META_AI_ORIGIN,
  META_AI_POLL_MS,
  META_AI_PROMPT_BOX_TIMEOUT_MS,
  META_AI_SELECTORS,
  META_AI_START_URL,
  META_AI_TAB_PATTERN,
  META_AI_TIMEOUT_MS,
  type SelectorSet,
} from './selectors.js';

/** What a helper makes: a still image or a short video clip. */
export type HelperKind = 'image' | 'video';

/**
 * Everything the runner needs to know about one site the owner may let the helper use (D-071,
 * D-080): its address, the prompt box and result selectors, the wording for messages, and the
 * bounded waits. One site per entry; nothing is shared between sites.
 */
export interface HelperSite {
  readonly id: 'meta-ai' | 'flow';
  /** Shown to the owner: "Meta AI", "Google Flow". */
  readonly name: string;
  /** The label stored on the attached file (the AI-generated tag in exports). */
  readonly generator: string;
  /** Start of the stored file name. */
  readonly filePrefix: string;
  /** Chrome permission patterns requested when the owner turns the helper on. */
  readonly origins: readonly string[];
  /** Patterns used to find the owner's own open tab. */
  readonly tabPatterns: readonly string[];
  /** Opened (visibly) when no tab of the site is open. */
  readonly startUrl: string;
  readonly selectors: SelectorSet;
  readonly timeoutMs: { readonly image: number; readonly video: number };
  readonly loadTimeoutMs: number;
  readonly promptBoxTimeoutMs: number;
  readonly loginTimeoutMs: number;
  readonly pollMs: number;
  readonly chunkBytes: number;
}

export const META_AI_SITE: HelperSite = {
  id: 'meta-ai',
  name: 'Meta AI',
  generator: 'Meta AI',
  filePrefix: 'meta-ai',
  origins: [`${META_AI_ORIGIN}/*`],
  tabPatterns: [META_AI_TAB_PATTERN],
  startUrl: META_AI_START_URL,
  selectors: META_AI_SELECTORS,
  timeoutMs: META_AI_TIMEOUT_MS,
  loadTimeoutMs: META_AI_LOAD_TIMEOUT_MS,
  promptBoxTimeoutMs: META_AI_PROMPT_BOX_TIMEOUT_MS,
  loginTimeoutMs: META_AI_LOGIN_TIMEOUT_MS,
  pollMs: META_AI_POLL_MS,
  chunkBytes: META_AI_CHUNK_BYTES,
};

/**
 * Google Flow (D-080). Nothing here is verified against the real site: it cannot be reached from
 * the build environment, and Google's Flow terms page could not be read (it needs a sign-in). Each
 * element has fallbacks and "Copy diagnostics" reports which one matched, so a change on the site
 * is a small edit to this block. Flow's own controls (model, aspect ratio, how many clips) are
 * whatever the owner left selected in the tab: the helper does not touch them.
 */
// Checked on 2026-11-05 over the real network: `https://labs.google/fx/tools/flow` answers 308 to
// `https://flow.google.com/`, so the tab always ends on that one host and it is the only one asked for.
export const FLOW_ORIGINS = ['https://flow.google.com/*'];

export const FLOW_SELECTORS: SelectorSet = {
  promptBox: [
    'textarea[placeholder*="create" i]',
    'textarea[placeholder*="describe" i]',
    'textarea[placeholder*="prompt" i]',
    '[contenteditable="true"][role="textbox"]',
    '[role="textbox"]',
    'textarea',
    'div[contenteditable="true"]',
  ],
  sendButton: [
    'button[aria-label*="generate" i]',
    'button[aria-label*="create" i]',
    'button[aria-label*="send" i]',
    'button[data-testid*="generate" i]',
    'button[type="submit"]',
  ],
  media: ['video[src]', 'video source', 'main video', 'video'],
  loginHints: ['sign in to continue', 'sign in with google', 'choose an account', 'sign in'],
  challengeHints: [
    'captcha',
    'verify it’s you',
    "verify it's you",
    'verify you are human',
    'unusual traffic',
    'security check',
  ],
  limitHints: [
    'out of credits',
    'not enough credits',
    'daily limit',
    'reached your limit',
    'too many requests',
    'try again later',
  ],
  // Video elements are always counted; this only filters still images.
  minImagePixels: 256,
};

export const FLOW_SITE: HelperSite = {
  id: 'flow',
  name: 'Google Flow',
  generator: 'Google Flow',
  filePrefix: 'flow',
  origins: FLOW_ORIGINS,
  tabPatterns: FLOW_ORIGINS,
  startUrl: 'https://flow.google.com/',
  selectors: FLOW_SELECTORS,
  // A clip takes minutes; images are not offered, but the bound stays for completeness.
  timeoutMs: { image: 3 * 60_000, video: 10 * 60_000 },
  loadTimeoutMs: 30_000,
  promptBoxTimeoutMs: 20_000,
  loginTimeoutMs: 5 * 60_000,
  pollMs: 2_000,
  chunkBytes: META_AI_CHUNK_BYTES,
};
