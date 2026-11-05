import { ASSET_LIMITS, UPLOAD_MIME_VALUES, type UploadMime } from '@creatorops/contracts';

import type { PageProbe, StashInfo, SubmitResult } from './page.js';
import type { SelectorSet } from './selectors.js';
import { META_AI_SITE, type HelperKind, type HelperSite } from './sites.js';

/** Stable codes so the panel can show a plain message for each. */
export type MetaAiErrorCode =
  | 'PERMISSION_DENIED'
  | 'LOGIN_REQUIRED'
  | 'CHALLENGE'
  | 'RATE_LIMITED'
  | 'PAGE_NOT_RECOGNISED'
  | 'SEND_FAILED'
  | 'TIMEOUT'
  | 'MEDIA_FAILED'
  | 'CANCELLED'
  | 'UPLOAD_FAILED';

export class MetaAiError extends Error {
  readonly code: MetaAiErrorCode;
  constructor(code: MetaAiErrorCode, message: string) {
    super(message);
    this.name = 'MetaAiError';
    this.code = code;
  }
}

/** What the runner needs from the browser. The real one wraps `chrome.*`; tests use a fake. */
export interface MetaAiBrowser {
  hasPermission(): Promise<boolean>;
  /** Must be called from a click: Chrome shows its own prompt. */
  requestPermission(): Promise<boolean>;
  /** The id of an open meta.ai tab of the owner, or null. */
  findTab(): Promise<number | null>;
  /** Opens a visible tab and resolves when it has finished loading (or rejects on timeout). */
  openTab(url: string, timeoutMs: number): Promise<number>;
  /** Brings the tab to the front so the owner sees the sign-in page. Optional. */
  focusTab?(tabId: number): Promise<void>;
  /** Runs one of the functions of `page.ts` inside the tab. */
  run<Args extends unknown[], Result>(
    tabId: number,
    func: (...args: Args) => Result | Promise<Result>,
    args: Args,
  ): Promise<Result>;
}

/** The functions the runner sends into the page. Injected so tests can drive a fake page. */
export interface PageFunctions {
  probePage: (sel: SelectorSet) => PageProbe;
  submitPrompt: (sel: SelectorSet, prompt: string) => SubmitResult;
  listMedia: (sel: SelectorSet) => string[];
  stashMedia: (url: string) => Promise<StashInfo>;
  readStash: (offset: number, length: number) => Promise<string>;
  clearStash: () => boolean;
}

export type StepId = 'opening' | 'checking' | 'typing' | 'waiting' | 'collecting' | 'uploading';

export const STEP_LABELS: Readonly<Record<StepId, string>> = {
  opening: 'Opening Meta AI',
  checking: 'Checking the page',
  typing: 'Sending your prompt',
  waiting: 'Waiting for the image',
  collecting: 'Collecting the image',
  uploading: 'Saving it to this scene',
};

/** The step wording for a site and a kind of file; Meta AI images give exactly `STEP_LABELS`. */
export function stepLabels(site: HelperSite, kind: HelperKind): Readonly<Record<StepId, string>> {
  const thing = kind === 'video' ? 'video' : 'image';
  return {
    opening: `Opening ${site.name}`,
    checking: 'Checking the page',
    typing: 'Sending your prompt',
    waiting: `Waiting for the ${thing}`,
    collecting: `Collecting the ${thing}`,
    uploading: 'Saving it to this scene',
  };
}
export const STEP_ORDER: readonly StepId[] = [
  'opening',
  'checking',
  'typing',
  'waiting',
  'collecting',
  'uploading',
];

/** What the helper saw. It never holds cookies, tokens, addresses with queries, or the media. */
export interface DiagnosticLine {
  readonly atMs: number;
  readonly step: StepId | 'start' | 'end';
  readonly note: string;
}

export interface MetaAiResult {
  readonly bytes: Uint8Array;
  readonly mimeType: UploadMime;
}

export interface RunOptions {
  readonly browser: MetaAiBrowser;
  readonly page: PageFunctions;
  readonly prompt: string;
  readonly kind?: HelperKind;
  /** The site to use; Meta AI when left out. */
  readonly site?: HelperSite;
  readonly signal: AbortSignal;
  readonly onStep: (step: StepId) => void;
  /** True while the helper waits for the owner to sign in in the Meta AI tab. */
  readonly onWaitingForSignIn?: (waiting: boolean) => void;
  readonly log: (line: DiagnosticLine) => void;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly now?: () => number;
  readonly selectors?: SelectorSet;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function isUploadMime(value: string): value is UploadMime {
  return (UPLOAD_MIME_VALUES as readonly string[]).includes(value);
}

function fromBase64(text: string): Uint8Array {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

/** Fails fast on a page that is not ready, with the reason the owner needs. */
function assertUsable(probe: PageProbe, name: string): void {
  if (probe.state === 'login') {
    throw new MetaAiError(
      'LOGIN_REQUIRED',
      `${name} is asking you to sign in. Sign in in that tab, then try again.`,
    );
  }
  if (probe.state === 'challenge') {
    throw new MetaAiError(
      'CHALLENGE',
      `${name} is showing a check that needs you. Finish it in that tab, then try again. The helper does not solve it.`,
    );
  }
  if (probe.state === 'limit') {
    throw new MetaAiError(
      'RATE_LIMITED',
      `${name} says you have hit a limit for now. Wait a while, then try again.`,
    );
  }
}

/**
 * Makes one image in the owner's own meta.ai tab (D-071). One scene at a time; every wait is
 * bounded; it stops at once when the signal aborts; it stops with a plain message on a login
 * page, a challenge, a limit or a page it does not recognise.
 */
export async function runMetaAiScene(options: RunOptions): Promise<MetaAiResult> {
  const { browser, page, prompt, signal, onStep, log } = options;
  const kind = options.kind ?? 'image';
  const site = options.site ?? META_AI_SITE;
  const sleep = options.sleep ?? defaultSleep;
  const now = options.now ?? Date.now;
  const selectors = options.selectors ?? site.selectors;
  const startedAt = now();
  const note = (step: DiagnosticLine['step'], text: string) =>
    log({ atMs: now() - startedAt, step, note: text });
  const checkAborted = () => {
    if (signal.aborted) throw new MetaAiError('CANCELLED', 'Cancelled.');
  };
  // Cancel must work even when the page or a wait is stuck, so every wait races the signal.
  const abortable = <T>(promise: Promise<T>): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      if (signal.aborted) {
        reject(new MetaAiError('CANCELLED', 'Cancelled.'));
        return;
      }
      const onAbort = () => reject(new MetaAiError('CANCELLED', 'Cancelled.'));
      signal.addEventListener('abort', onAbort, { once: true });
      promise.then(
        (value) => {
          signal.removeEventListener('abort', onAbort);
          resolve(value);
        },
        (error: unknown) => {
          signal.removeEventListener('abort', onAbort);
          reject(error);
        },
      );
    });
  const wait = (ms: number) => abortable(sleep(ms));
  const inTab = <Args extends unknown[], Result>(
    tab: number,
    func: (...args: Args) => Result | Promise<Result>,
    args: Args,
  ) => abortable(browser.run(tab, func, args));
  const describe = (probe: PageProbe) =>
    `title "${probe.title}", path ${probe.path}, state ${probe.state}, prompt box ${probe.promptBoxIndex}, send button ${probe.sendButtonIndex}, media ${probe.mediaCount}`;

  note('start', `kind ${kind}, prompt length ${prompt.length}`);
  if (!(await browser.hasPermission())) {
    throw new MetaAiError(
      'PERMISSION_DENIED',
      `Chrome has not allowed this extension to use ${site.name}. Turn the helper on and allow it.`,
    );
  }

  onStep('opening');
  checkAborted();
  let tabId = await browser.findTab();
  note('opening', tabId === null ? `no ${site.name} tab open, opening one` : 'using the open tab');
  if (tabId === null) {
    try {
      tabId = await abortable(browser.openTab(site.startUrl, site.loadTimeoutMs));
    } catch (error) {
      if (error instanceof MetaAiError) throw error;
      throw new MetaAiError('TIMEOUT', `The ${site.name} page did not finish loading. Try again.`);
    }
  }
  const tab = tabId;
  const stashed = { value: false };
  const signingIn = { value: false };

  try {
    onStep('checking');
    // Wait for the prompt box. On a sign-in page the helper waits for the owner (bounded) in
    // the visible tab and carries on by itself once the box appears; it never signs in.
    let loadWaited = 0;
    let signInWaited = 0;
    for (;;) {
      checkAborted();
      let probe: PageProbe | null = null;
      try {
        probe = await inTab(tab, page.probePage, [selectors]);
      } catch (error) {
        // While signing in the tab may be on another site's sign-in page, which the helper
        // cannot read; keep waiting for it to come back.
        if (!signingIn.value || (error instanceof MetaAiError && error.code === 'CANCELLED')) {
          throw error;
        }
        note('checking', 'the tab is not readable right now (signing in)');
      }
      if (probe !== null) {
        note('checking', describe(probe));
        if (probe.state !== 'login') assertUsable(probe, site.name);
        if (probe.promptBoxIndex >= 0) break;
        if (probe.state === 'login' && !signingIn.value) {
          signingIn.value = true;
          options.onWaitingForSignIn?.(true);
          await browser.focusTab?.(tab).catch(() => undefined);
          note('checking', 'sign-in page: waiting for the owner to sign in');
        }
      }
      if (signingIn.value) {
        signInWaited += site.pollMs;
        if (signInWaited > site.loginTimeoutMs) {
          throw new MetaAiError(
            'LOGIN_REQUIRED',
            `${site.name} was not signed in within 5 minutes. Sign in in that tab, then try again.`,
          );
        }
      } else {
        loadWaited += site.pollMs;
        if (loadWaited > site.promptBoxTimeoutMs) {
          throw new MetaAiError(
            'PAGE_NOT_RECOGNISED',
            `The ${site.name} page does not look the way the helper expects. Use Copy diagnostics and send it for a fix.`,
          );
        }
      }
      await wait(site.pollMs);
    }
    if (signingIn.value) {
      signingIn.value = false;
      options.onWaitingForSignIn?.(false);
    }

    const before = await inTab(tab, page.listMedia, [selectors]);
    note('checking', `${before.length} media items on the page before sending`);

    onStep('typing');
    checkAborted();
    const sent = await inTab(tab, page.submitPrompt, [selectors, prompt]);
    note('typing', `submit: ${sent.how}`);
    if (!sent.ok) {
      throw new MetaAiError(
        'SEND_FAILED',
        `The helper could not type into ${site.name}. Use Copy diagnostics and send it for a fix.`,
      );
    }

    onStep('waiting');
    const limit = site.timeoutMs[kind];
    let previous = '';
    let fresh: string[] = [];
    for (let waited = 0; ; waited += site.pollMs) {
      checkAborted();
      if (waited > limit) {
        note('waiting', `gave up after ${Math.round(limit / 1000)} s`);
        throw new MetaAiError(
          'TIMEOUT',
          `${site.name} did not finish in time. Check the tab, then try again.`,
        );
      }
      await wait(site.pollMs);
      const now1 = await inTab(tab, page.probePage, [selectors]);
      assertUsable(now1, site.name);
      const urls = await inTab(tab, page.listMedia, [selectors]);
      fresh = urls.filter((url) => !before.includes(url));
      note('waiting', `${fresh.length} new media items; ${describe(now1)}`);
      // The result counts once the same new items were there on two checks in a row.
      const key = fresh.join('\n');
      if (fresh.length > 0 && key === previous) break;
      previous = key;
    }

    onStep('collecting');
    checkAborted();
    const target = fresh[0];
    if (target === undefined) {
      throw new MetaAiError(
        'MEDIA_FAILED',
        `No ${kind === 'video' ? 'video' : 'image'} was found.`,
      );
    }
    let info: StashInfo;
    try {
      info = await inTab(tab, page.stashMedia, [target]);
      stashed.value = true;
    } catch {
      throw new MetaAiError(
        'MEDIA_FAILED',
        `The helper could not download the ${kind === 'video' ? 'video' : 'image'} from ${site.name}. Use Copy diagnostics and send it for a fix.`,
      );
    }
    note('collecting', `file ${info.size} bytes, type ${info.type}`);
    const limitBytes = kind === 'video' ? ASSET_LIMITS.videoBytes : ASSET_LIMITS.imageBytes;
    if (!isUploadMime(info.type) || info.size < 1 || info.size > limitBytes) {
      throw new MetaAiError(
        'MEDIA_FAILED',
        `${site.name} gave a file this app cannot accept (type or size).`,
      );
    }
    const bytes = new Uint8Array(info.size);
    for (let offset = 0; offset < info.size; offset += site.chunkBytes) {
      checkAborted();
      const chunk = fromBase64(await inTab(tab, page.readStash, [offset, site.chunkBytes]));
      if (offset + chunk.length > info.size) {
        throw new MetaAiError('MEDIA_FAILED', `${site.name} gave more data than expected.`);
      }
      bytes.set(chunk, offset);
    }
    return { bytes, mimeType: info.type };
  } finally {
    if (signingIn.value) options.onWaitingForSignIn?.(false);
    if (stashed.value) {
      await browser.run(tab, page.clearStash, []).catch(() => false);
    }
    note('end', 'finished');
  }
}
