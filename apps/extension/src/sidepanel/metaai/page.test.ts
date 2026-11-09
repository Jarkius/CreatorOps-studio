import { beforeEach, describe, expect, it } from 'vitest';

import { clearStash, listMedia, probePage, readStash, stashMedia, submitPrompt } from './page.js';
import { META_AI_SELECTORS } from './selectors.js';

const sel = META_AI_SELECTORS;

function page(html: string) {
  document.body.innerHTML = html;
  document.title = 'Meta AI';
}

beforeEach(() => {
  page('');
  clearStash();
});

describe('probePage', () => {
  it('is ready when a prompt box exists, and reports which selector matched', () => {
    page(
      '<textarea placeholder="Ask Meta AI anything"></textarea><button aria-label="Send">go</button>',
    );
    expect(probePage(sel)).toMatchObject({
      state: 'ready',
      promptBoxIndex: 0,
      sendButtonIndex: 0,
      path: '/',
      title: 'Meta AI',
    });
  });

  it('says login only when there is no prompt box', () => {
    page('<p>Log in to continue</p>');
    expect(probePage(sel).state).toBe('login');
    page('<p>Log in</p><textarea></textarea>');
    expect(probePage(sel).state).toBe('ready');
  });

  it('spots a challenge and a limit before anything else', () => {
    page('<textarea></textarea><p>Please verify you are human</p>');
    expect(probePage(sel).state).toBe('challenge');
    page('<textarea></textarea><p>You have reached your limit</p>');
    expect(probePage(sel).state).toBe('limit');
  });

  it('is unknown for a page it does not recognise, and survives a bad selector', () => {
    page('<p>hello</p>');
    const odd = { ...sel, promptBox: ['(((', ...sel.promptBox] };
    expect(probePage(odd)).toMatchObject({ state: 'unknown', promptBoxIndex: -1 });
  });
});

describe('submitPrompt', () => {
  it('types into a textarea so the page sees an input event, then clicks Send', () => {
    page('<textarea></textarea><button aria-label="Send">go</button>');
    const box = document.querySelector('textarea') as HTMLTextAreaElement;
    const seen: string[] = [];
    box.addEventListener('input', () => seen.push(box.value));
    let clicked = 0;
    document.querySelector('button')?.addEventListener('click', () => (clicked += 1));
    expect(submitPrompt(sel, 'สวัสดี prompt')).toEqual({ ok: true, how: 'button' });
    expect(seen).toEqual(['สวัสดี prompt']);
    expect(clicked).toBe(1);
  });

  it('presses Enter when there is no usable Send button', () => {
    page('<textarea></textarea><button aria-label="Send" disabled>go</button>');
    const box = document.querySelector('textarea') as HTMLTextAreaElement;
    const keys: string[] = [];
    box.addEventListener('keydown', (event) => keys.push(event.key));
    expect(submitPrompt(sel, 'x')).toEqual({ ok: true, how: 'enter' });
    expect(keys).toEqual(['Enter']);
  });

  it('writes into a contenteditable box', () => {
    page('<div contenteditable="true" role="textbox"></div>');
    expect(submitPrompt(sel, 'hello').ok).toBe(true);
    expect(document.querySelector('[role=textbox]')?.textContent).toBe('hello');
  });

  it('fails plainly when there is no box or the box cannot be edited', () => {
    page('<p>none</p>');
    expect(submitPrompt(sel, 'x')).toEqual({ ok: false, how: 'no-prompt-box' });
    page('<div role="textbox"></div>');
    expect(submitPrompt(sel, 'x')).toEqual({ ok: false, how: 'not-editable' });
  });
});

describe('listMedia', () => {
  it('lists big images once, skipping icons and repeats', () => {
    page(
      '<main><img src="https://cdn.test/a.png" width="512"><img src="https://cdn.test/a.png" width="512"><img src="https://cdn.test/icon.png" width="24"></main>',
    );
    expect(listMedia(sel)).toEqual(['https://cdn.test/a.png']);
  });
});

describe('stash', () => {
  it('accepts only https and blob addresses', async () => {
    await expect(stashMedia('http://cdn.test/a.png')).rejects.toThrow(/unsupported/);
    await expect(stashMedia('javascript:alert(1)')).rejects.toThrow(/unsupported/);
    await expect(stashMedia('file:///etc/passwd')).rejects.toThrow(/unsupported/);
  });

  it('reads the stashed file in base64 chunks and can clear it', async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (() =>
      Promise.resolve({
        ok: true,
        blob: () =>
          Promise.resolve(new Blob([new Uint8Array([1, 2, 3, 4, 5])], { type: 'image/png' })),
      })) as unknown as typeof fetch;
    try {
      expect(await stashMedia('https://cdn.test/a.png')).toEqual({ size: 5, type: 'image/png' });
      expect(await readStash(0, 3)).toBe(btoa(String.fromCharCode(1, 2, 3)));
      expect(await readStash(3, 10)).toBe(btoa(String.fromCharCode(4, 5)));
      clearStash();
      await expect(readStash(0, 1)).rejects.toThrow(/nothing stashed/);
    } finally {
      globalThis.fetch = original;
    }
  });

  it('asks for the file without cookies first, and with the session only when that fails', async () => {
    const original = globalThis.fetch;
    const modes: (RequestCredentials | undefined)[] = [];
    const png = () =>
      ({
        ok: true,
        blob: () => Promise.resolve(new Blob([new Uint8Array([1, 2])], { type: 'image/png' })),
      }) as unknown as Response;
    try {
      // A CDN with `Access-Control-Allow-Origin: *` answers the cookie-less request.
      globalThis.fetch = ((_url: string, init?: RequestInit) => {
        modes.push(init?.credentials);
        return Promise.resolve(png());
      }) as unknown as typeof fetch;
      await stashMedia('https://cdn.test/open.png');
      expect(modes).toEqual(['omit']);

      // One that needs the owner's session refuses without it; the retry carries it.
      modes.length = 0;
      globalThis.fetch = ((_url: string, init?: RequestInit) => {
        modes.push(init?.credentials);
        return Promise.resolve(
          init?.credentials === 'omit' ? new Response('no', { status: 401 }) : png(),
        );
      }) as unknown as typeof fetch;
      expect(await stashMedia('https://cdn.test/private.png')).toEqual({
        size: 2,
        type: 'image/png',
      });
      expect(modes).toEqual(['omit', 'include']);

      // A network refusal (a CORS failure) on the first try also falls back.
      modes.length = 0;
      globalThis.fetch = ((_url: string, init?: RequestInit) => {
        modes.push(init?.credentials);
        return init?.credentials === 'omit'
          ? Promise.reject(new TypeError('Failed to fetch'))
          : Promise.resolve(png());
      }) as unknown as typeof fetch;
      await stashMedia('https://cdn.test/cors.png');
      expect(modes).toEqual(['omit', 'include']);
    } finally {
      globalThis.fetch = original;
    }
  });

  it('refuses a failed download', async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (() => Promise.resolve(new Response('no', { status: 403 }))) as typeof fetch;
    try {
      await expect(stashMedia('https://cdn.test/a.png')).rejects.toThrow(/403/);
    } finally {
      globalThis.fetch = original;
    }
  });
});
