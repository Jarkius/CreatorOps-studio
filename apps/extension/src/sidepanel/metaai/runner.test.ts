import { describe, expect, it, vi } from 'vitest';

import type { PageProbe } from './page.js';
import {
  MetaAiError,
  runMetaAiScene,
  type DiagnosticLine,
  type MetaAiBrowser,
  type PageFunctions,
  type StepId,
} from './runner.js';
import { FLOW_SITE, type HelperKind, type HelperSite } from './sites.js';

const PROMPT = 'a secret prompt about the product';

function probe(overrides: Partial<PageProbe> = {}): PageProbe {
  return {
    title: 'Meta AI',
    path: '/',
    state: 'ready',
    promptBoxIndex: 0,
    sendButtonIndex: 0,
    mediaCount: 0,
    ...overrides,
  };
}

function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64');
}

interface Setup {
  probes?: () => PageProbe;
  /** Media addresses on each listMedia call; the last entry repeats. */
  media?: string[][];
  file?: Uint8Array;
  type?: string;
  submit?: { ok: boolean; how: 'button' | 'enter' | 'no-prompt-box' | 'not-editable' };
  permission?: boolean;
  tab?: number | null;
  controller?: AbortController;
  onSleep?: (calls: number) => void;
  site?: HelperSite;
  kind?: HelperKind;
}

function setup(options: Setup = {}) {
  const file = options.file ?? new Uint8Array([1, 2, 3, 4]);
  let mediaCall = 0;
  const media = options.media ?? [[], ['https://cdn.test/a.png']];
  const calls = {
    submit: 0,
    clear: 0,
    open: 0,
    sleeps: 0,
    focus: 0,
    typedPrompt: '',
    openedUrl: '',
  };
  const signIn: boolean[] = [];
  const page: PageFunctions = {
    probePage: () => (options.probes ?? (() => probe()))(),
    submitPrompt: (_sel, prompt) => {
      calls.submit += 1;
      calls.typedPrompt = prompt;
      return options.submit ?? { ok: true, how: 'button' };
    },
    listMedia: () => {
      const entry = media[Math.min(mediaCall, media.length - 1)] ?? [];
      mediaCall += 1;
      return entry;
    },
    stashMedia: () => Promise.resolve({ size: file.byteLength, type: options.type ?? 'image/png' }),
    readStash: (offset, length) => Promise.resolve(toBase64(file.slice(offset, offset + length))),
    clearStash: () => {
      calls.clear += 1;
      return true;
    },
  };
  const browser: MetaAiBrowser = {
    hasPermission: () => Promise.resolve(options.permission ?? true),
    requestPermission: () => Promise.resolve(true),
    findTab: () => Promise.resolve(options.tab === undefined ? 7 : options.tab),
    focusTab: () => {
      calls.focus += 1;
      return Promise.resolve();
    },
    openTab: (url) => {
      calls.open += 1;
      calls.openedUrl = url;
      return Promise.resolve(9);
    },
    run: (_tab, func, args) =>
      Promise.resolve((func as (...a: unknown[]) => unknown)(...args)) as never,
  };
  const steps: StepId[] = [];
  const lines: DiagnosticLine[] = [];
  const controller = options.controller ?? new AbortController();
  const run = () =>
    runMetaAiScene({
      browser,
      page,
      prompt: PROMPT,
      ...(options.site === undefined ? {} : { site: options.site }),
      ...(options.kind === undefined ? {} : { kind: options.kind }),
      signal: controller.signal,
      onStep: (step) => steps.push(step),
      onWaitingForSignIn: (waiting) => signIn.push(waiting),
      log: (line) => lines.push(line),
      sleep: () => {
        calls.sleeps += 1;
        options.onSleep?.(calls.sleeps);
        return Promise.resolve();
      },
    });
  return { run, steps, lines, calls, controller, signIn };
}

async function code(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof MetaAiError) return error.code;
    throw error;
  }
  return 'none';
}

async function message(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof MetaAiError) return error.message;
    throw error;
  }
  return 'none';
}

describe('runMetaAiScene on Google Flow (D-080)', () => {
  it('makes a video: same steps, mp4 bytes back, and the prompt typed once', async () => {
    const t = setup({
      site: FLOW_SITE,
      kind: 'video',
      type: 'video/mp4',
      media: [[], ['https://cdn.test/clip.mp4']],
    });
    const result = await t.run();
    expect(result.mimeType).toBe('video/mp4');
    expect([...result.bytes]).toEqual([1, 2, 3, 4]);
    expect(t.steps).toEqual(['opening', 'checking', 'typing', 'waiting', 'collecting']);
    expect(t.calls.submit).toBe(1);
  });

  it('names Google Flow in what it tells the owner, never Meta AI', async () => {
    const challenge = setup({
      site: FLOW_SITE,
      kind: 'video',
      probes: () => probe({ state: 'challenge' }),
    });
    expect(await message(challenge.run())).toMatch(/^Google Flow is showing a check/);
    const limit = setup({
      site: FLOW_SITE,
      kind: 'video',
      probes: () => probe({ state: 'limit' }),
    });
    expect(await message(limit.run())).toMatch(/^Google Flow says you have hit a limit/);
    const denied = setup({ site: FLOW_SITE, kind: 'video', permission: false });
    expect(await message(denied.run())).toMatch(/use Google Flow/);
    const stuck = setup({ site: FLOW_SITE, kind: 'video', media: [[]] });
    const text = await message(stuck.run());
    expect(text).toMatch(/^Google Flow did not finish in time/);
    expect(text).not.toMatch(/Meta/);
  });

  it('waits up to ten minutes for a video, not three', async () => {
    const t = setup({ site: FLOW_SITE, kind: 'video', media: [[]] });
    expect(await code(t.run())).toBe('TIMEOUT');
    expect(t.calls.sleeps).toBeGreaterThan(290);
    expect(t.calls.sleeps).toBeLessThan(320);
  });

  it("opens Flow's own address when no tab is open, and Meta AI's for the default site", async () => {
    const flow = setup({ site: FLOW_SITE, kind: 'video', tab: null, type: 'video/mp4' });
    await flow.run();
    expect(flow.calls.openedUrl).toBe('https://labs.google/fx/tools/flow');
    const meta = setup({ tab: null });
    await meta.run();
    expect(meta.calls.openedUrl).toBe('https://www.meta.ai/');
  });
});

describe('runMetaAiScene', () => {
  it('walks the steps in order and returns the image bytes', async () => {
    const t = setup();
    const result = await t.run();
    expect(t.steps).toEqual(['opening', 'checking', 'typing', 'waiting', 'collecting']);
    expect([...result.bytes]).toEqual([1, 2, 3, 4]);
    expect(result.mimeType).toBe('image/png');
    expect(t.calls.typedPrompt).toBe(PROMPT);
    expect(t.calls.clear).toBe(1);
  });

  it('reads a file larger than one chunk in several calls', async () => {
    const file = new Uint8Array(600_000).map((_v, index) => index % 251);
    const t = setup({ file });
    const result = await t.run();
    expect(result.bytes.byteLength).toBe(600_000);
    expect(result.bytes[599_999]).toBe(file[599_999]);
    expect(result.bytes[524_288]).toBe(file[524_288]);
  });

  it('waits until the new media is the same on two checks in a row', async () => {
    const t = setup({
      media: [[], ['https://cdn.test/a.png'], ['https://cdn.test/a.png', 'https://cdn.test/b.png']],
    });
    await t.run();
    // before + three polls; the second poll changed the set, so a third was needed.
    const waits = t.lines.filter((line) => line.step === 'waiting');
    expect(waits).toHaveLength(3);
  });

  it('ignores media that was already on the page before sending', async () => {
    const t = setup({
      media: [
        ['https://cdn.test/old.png'],
        ['https://cdn.test/old.png'],
        ['https://cdn.test/old.png', 'https://cdn.test/new.png'],
      ],
    });
    await t.run();
    expect(t.lines.some((line) => line.note.includes('1 new media items'))).toBe(true);
  });

  it('stops before typing on a challenge or a limit', async () => {
    for (const [state, expected] of [
      ['challenge', 'CHALLENGE'],
      ['limit', 'RATE_LIMITED'],
    ] as const) {
      const t = setup({ probes: () => probe({ state }) });
      expect(await code(t.run()), state).toBe(expected);
      expect(t.calls.submit, state).toBe(0);
    }
  });

  const loginPage = () => probe({ state: 'login', promptBoxIndex: -1 });

  it('waits for the owner on a sign-in page, brings the tab forward, and carries on by itself', async () => {
    let calls = 0;
    const t = setup({ probes: () => (++calls <= 4 ? loginPage() : probe()) });
    const result = await t.run();
    expect(result.bytes.byteLength).toBe(4);
    expect(t.signIn).toEqual([true, false]);
    expect(t.calls.focus).toBe(1);
    expect(t.calls.submit).toBe(1);
  });

  it('gives up on a sign-in page after five minutes and never types', async () => {
    const t = setup({ probes: loginPage });
    expect(await code(t.run())).toBe('LOGIN_REQUIRED');
    expect(t.calls.sleeps).toBeGreaterThan(140);
    expect(t.calls.sleeps).toBeLessThan(160);
    expect(t.calls.submit).toBe(0);
    expect(t.signIn).toEqual([true, false]);
  });

  it('keeps waiting while the tab is on another site to sign in, and then continues', async () => {
    let calls = 0;
    const t = setup({
      probes: () => {
        calls += 1;
        if (calls === 1) return loginPage();
        if (calls <= 4) throw new Error('cannot read this page');
        return probe();
      },
    });
    await t.run();
    expect(t.calls.submit).toBe(1);
  });

  it('does not wait for a tab that cannot be read when the owner is not signing in', async () => {
    const t = setup({
      probes: () => {
        throw new Error('cannot read this page');
      },
    });
    await expect(t.run()).rejects.toThrow('cannot read this page');
  });

  it('stops with a challenge that shows up during sign-in', async () => {
    let calls = 0;
    const t = setup({ probes: () => (++calls <= 2 ? loginPage() : probe({ state: 'challenge' })) });
    expect(await code(t.run())).toBe('CHALLENGE');
  });

  it('can be cancelled while waiting for sign-in', async () => {
    const controller = new AbortController();
    const t = setup({
      probes: loginPage,
      controller,
      onSleep: (n) => n === 3 && controller.abort(),
    });
    expect(await code(t.run())).toBe('CANCELLED');
    expect(t.signIn).toEqual([true, false]);
  });

  it('stops with a challenge that appears while waiting', async () => {
    let calls = 0;
    const t = setup({
      probes: () => {
        calls += 1;
        return calls > 3 ? probe({ state: 'challenge' }) : probe();
      },
      media: [[]],
    });
    expect(await code(t.run())).toBe('CHALLENGE');
  });

  it('gives up on a page with no prompt box after a bounded number of checks', async () => {
    const t = setup({ probes: () => probe({ state: 'unknown', promptBoxIndex: -1 }) });
    expect(await code(t.run())).toBe('PAGE_NOT_RECOGNISED');
    expect(t.calls.submit).toBe(0);
    expect(t.calls.sleeps).toBeLessThanOrEqual(10);
  });

  it('reports a prompt it could not send', async () => {
    const t = setup({ submit: { ok: false, how: 'not-editable' } });
    expect(await code(t.run())).toBe('SEND_FAILED');
  });

  it('times out after the image limit instead of waiting forever', async () => {
    const t = setup({ media: [[]] });
    expect(await code(t.run())).toBe('TIMEOUT');
    expect(t.calls.sleeps).toBeGreaterThan(80);
    expect(t.calls.sleeps).toBeLessThan(100);
    expect(t.calls.clear).toBe(0);
  });

  it('stops at once when cancelled while waiting, and clears nothing it never stashed', async () => {
    const controller = new AbortController();
    const t = setup({ media: [[]], controller, onSleep: (n) => n === 3 && controller.abort() });
    expect(await code(t.run())).toBe('CANCELLED');
    expect(t.calls.sleeps).toBe(3);
  });

  it('cancels even when the page never answers', async () => {
    const controller = new AbortController();
    const t = setup({ controller });
    const hung: MetaAiBrowser = {
      hasPermission: () => Promise.resolve(true),
      requestPermission: () => Promise.resolve(true),
      findTab: () => Promise.resolve(3),
      openTab: () => Promise.resolve(3),
      run: () => new Promise(() => undefined),
    };
    const promise = runMetaAiScene({
      browser: hung,
      page: {} as PageFunctions,
      prompt: PROMPT,
      signal: controller.signal,
      onStep: () => undefined,
      log: () => undefined,
    });
    setTimeout(() => controller.abort(), 5);
    expect(await code(promise)).toBe('CANCELLED');
    expect(t.calls.submit).toBe(0);
  });

  it('cancels in the middle of a wait that would last seconds', async () => {
    const controller = new AbortController();
    const t = setup({ controller, media: [[]] });
    const promise = runMetaAiScene({
      browser: {
        hasPermission: () => Promise.resolve(true),
        requestPermission: () => Promise.resolve(true),
        findTab: () => Promise.resolve(3),
        openTab: () => Promise.resolve(3),
        run: (_tab, func, args) =>
          Promise.resolve((func as (...a: unknown[]) => unknown)(...args)) as never,
      },
      page: {
        probePage: () => probe(),
        listMedia: () => [],
        submitPrompt: () => ({ ok: true, how: 'button' }),
      } as unknown as PageFunctions,
      prompt: PROMPT,
      signal: controller.signal,
      onStep: () => undefined,
      log: () => undefined,
      // A wait that never ends on its own.
      sleep: () => new Promise(() => undefined),
    });
    setTimeout(() => controller.abort(), 5);
    expect(await code(promise)).toBe('CANCELLED');
    expect(t.calls.submit).toBe(0);
  });

  it('cancelled before it starts does not open a tab or type', async () => {
    const controller = new AbortController();
    controller.abort();
    const t = setup({ controller, tab: null });
    expect(await code(t.run())).toBe('CANCELLED');
    expect(t.calls.open).toBe(0);
    expect(t.calls.submit).toBe(0);
  });

  it('refuses to start without the permission, and touches no tab', async () => {
    const t = setup({ permission: false, tab: null });
    expect(await code(t.run())).toBe('PERMISSION_DENIED');
    expect(t.calls.open).toBe(0);
  });

  it('opens a tab only when none is open', async () => {
    const none = setup({ tab: null });
    await none.run();
    expect(none.calls.open).toBe(1);
    const some = setup({ tab: 5 });
    await some.run();
    expect(some.calls.open).toBe(0);
  });

  it('refuses a file of a type the app does not accept, and clears the page copy', async () => {
    const t = setup({ type: 'image/svg+xml' });
    expect(await code(t.run())).toBe('MEDIA_FAILED');
    expect(t.calls.clear).toBe(1);
  });

  it('refuses an empty file', async () => {
    const t = setup({ file: new Uint8Array(0) });
    expect(await code(t.run())).toBe('MEDIA_FAILED');
  });

  it('never writes the prompt into the diagnostics', async () => {
    const t = setup();
    await t.run();
    expect(JSON.stringify(t.lines)).not.toContain('secret prompt');
    expect(t.lines[0]).toMatchObject({ step: 'start' });
  });

  it('fails the open step when the new tab never finishes loading', async () => {
    const t = setup({ tab: null });
    const spy = vi.fn(() => Promise.reject(new Error('timeout')));
    const browser: MetaAiBrowser = {
      hasPermission: () => Promise.resolve(true),
      requestPermission: () => Promise.resolve(true),
      findTab: () => Promise.resolve(null),
      openTab: spy,
      run: () => Promise.reject(new Error('unreachable')),
    };
    await expect(
      runMetaAiScene({
        browser,
        page: {} as PageFunctions,
        prompt: PROMPT,
        signal: t.controller.signal,
        onStep: () => undefined,
        log: () => undefined,
      }),
    ).rejects.toMatchObject({ code: 'TIMEOUT' });
  });
});
