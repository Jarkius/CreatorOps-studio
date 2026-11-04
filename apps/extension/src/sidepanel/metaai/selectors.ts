/**
 * Everything the Meta AI helper knows about the shape of meta.ai, in one place (D-071 item 3).
 * Nothing here is verified against the real site (it cannot be reached from the build
 * environment): each element has several fallbacks, and "Copy diagnostics" reports which one
 * matched, so a change on the site is a small edit to this file.
 */

export const META_AI_ORIGIN = 'https://www.meta.ai';
export const META_AI_START_URL = `${META_AI_ORIGIN}/`;
/** Matches only tabs on the one allowed site. */
export const META_AI_TAB_PATTERN = `${META_AI_ORIGIN}/*`;

/** The shape passed into the page. Plain data, so it can cross the script boundary. */
export interface SelectorSet {
  /** CSS selectors for the prompt box, tried in order. */
  readonly promptBox: readonly string[];
  /** CSS selectors for the send button, tried in order. */
  readonly sendButton: readonly string[];
  /** CSS selectors for generated media. Only large images and videos count. */
  readonly media: readonly string[];
  /** Lower-case phrases that mean the page asks the owner to sign in. */
  readonly loginHints: readonly string[];
  /** Lower-case phrases that mean a human check or challenge is showing. */
  readonly challengeHints: readonly string[];
  /** Lower-case phrases that mean Meta is limiting the owner for now. */
  readonly limitHints: readonly string[];
  /** Images narrower than this many pixels are icons or avatars, not results. */
  readonly minImagePixels: number;
}

export const META_AI_SELECTORS: SelectorSet = {
  promptBox: [
    'textarea[placeholder*="ask" i]',
    'textarea[placeholder*="imagine" i]',
    '[contenteditable="true"][role="textbox"]',
    '[role="textbox"]',
    'textarea',
    'div[contenteditable="true"]',
  ],
  sendButton: [
    'button[aria-label="Send" i]',
    '[role="button"][aria-label="Send" i]',
    'button[aria-label*="send" i]',
    'button[data-testid*="send" i]',
    'button[type="submit"]',
  ],
  media: ['img[alt*="generated" i]', 'img[src^="blob:"]', 'img[src*="fbcdn"]', 'main img'],
  loginHints: ['log in to continue', 'sign in to continue', 'continue with facebook', 'log in'],
  challengeHints: ['captcha', 'verify you are human', 'confirm you are human', 'security check'],
  limitHints: ['too many requests', 'reached your limit', 'try again later', 'rate limit'],
  minImagePixels: 256,
};

/** How long the helper waits for a result (D-071 item 3). */
export const META_AI_TIMEOUT_MS = { image: 3 * 60_000, video: 10 * 60_000 } as const;
/** How long a new tab may take to load, and how long the prompt box may take to show up. */
export const META_AI_LOAD_TIMEOUT_MS = 30_000;
export const META_AI_PROMPT_BOX_TIMEOUT_MS = 15_000;
/** How long the helper waits for the owner to sign in before it gives up. */
export const META_AI_LOGIN_TIMEOUT_MS = 5 * 60_000;
export const META_AI_POLL_MS = 2_000;
/** Bytes read from the page per call (before base64). */
export const META_AI_CHUNK_BYTES = 512 * 1024;
