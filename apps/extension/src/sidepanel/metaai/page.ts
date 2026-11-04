/**
 * Functions that `chrome.scripting.executeScript` runs inside the owner's own meta.ai tab
 * (D-071 item 3). Each one is serialised and sent to the page, so it must not use anything
 * outside itself: no imports, no helpers, no closure variables. Everything it needs arrives as an
 * argument and everything it returns is plain data. They never read cookies or storage, and the
 * only network request is the page fetching the media file it is already showing.
 */
import type { SelectorSet } from './selectors.js';

export interface PageProbe {
  readonly title: string;
  /** The path only: no query string and no fragment, which can carry tokens. */
  readonly path: string;
  readonly state: 'ready' | 'login' | 'challenge' | 'limit' | 'unknown';
  /** Which prompt box selector matched (its index in the list), or -1. */
  readonly promptBoxIndex: number;
  readonly sendButtonIndex: number;
  readonly mediaCount: number;
}

export function probePage(sel: SelectorSet): PageProbe {
  const firstMatch = (list: readonly string[]): number =>
    list.findIndex((css) => {
      try {
        return document.querySelector(css) !== null;
      } catch {
        return false;
      }
    });
  const promptBoxIndex = firstMatch(sel.promptBox);
  const sendButtonIndex = firstMatch(sel.sendButton);
  const text = (document.body?.innerText ?? document.body?.textContent ?? '')
    .toLowerCase()
    .slice(0, 20_000);
  const has = (hints: readonly string[]) => hints.some((hint) => text.includes(hint));
  let state: PageProbe['state'] = 'unknown';
  if (has(sel.challengeHints)) state = 'challenge';
  else if (has(sel.limitHints)) state = 'limit';
  else if (promptBoxIndex >= 0) state = 'ready';
  else if (has(sel.loginHints)) state = 'login';
  let mediaCount = 0;
  for (const css of sel.media) {
    try {
      mediaCount += document.querySelectorAll(css).length;
    } catch {
      // A selector the browser rejects is skipped; the diagnostics show a zero count.
    }
  }
  return {
    title: document.title.slice(0, 120),
    path: location.pathname.slice(0, 120),
    state,
    promptBoxIndex,
    sendButtonIndex,
    mediaCount,
  };
}

export interface SubmitResult {
  readonly ok: boolean;
  /** `button`, `enter`, or the reason it failed. */
  readonly how: 'button' | 'enter' | 'no-prompt-box' | 'not-editable';
}

export function submitPrompt(sel: SelectorSet, prompt: string): SubmitResult {
  let box: Element | null = null;
  for (const css of sel.promptBox) {
    try {
      box = document.querySelector(css);
    } catch {
      box = null;
    }
    if (box !== null) break;
  }
  if (box === null) return { ok: false, how: 'no-prompt-box' };
  (box as HTMLElement).focus();
  if (box instanceof HTMLTextAreaElement || box instanceof HTMLInputElement) {
    const proto = box instanceof HTMLTextAreaElement ? HTMLTextAreaElement : HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(proto.prototype, 'value')?.set;
    if (setter === undefined) return { ok: false, how: 'not-editable' };
    setter.call(box, prompt);
    box.dispatchEvent(new Event('input', { bubbles: true }));
  } else if (
    (box as HTMLElement).isContentEditable ||
    ['', 'true', 'plaintext-only'].includes(box.getAttribute('contenteditable') ?? 'no')
  ) {
    const selection = window.getSelection();
    selection?.selectAllChildren(box);
    const inserted =
      typeof document.execCommand === 'function' &&
      document.execCommand('insertText', false, prompt);
    if (!inserted) {
      box.textContent = prompt;
      box.dispatchEvent(new InputEvent('input', { bubbles: true, data: prompt }));
    }
  } else {
    return { ok: false, how: 'not-editable' };
  }
  for (const css of sel.sendButton) {
    let button: Element | null;
    try {
      button = document.querySelector(css);
    } catch {
      button = null;
    }
    if (button instanceof HTMLElement && !(button as HTMLButtonElement).disabled) {
      button.click();
      return { ok: true, how: 'button' };
    }
  }
  const press = (type: string) =>
    box.dispatchEvent(
      new KeyboardEvent(type, { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }),
    );
  press('keydown');
  press('keyup');
  return { ok: true, how: 'enter' };
}

/** The web addresses of the big images and videos on the page now, without repeats. */
export function listMedia(sel: SelectorSet): string[] {
  const found: string[] = [];
  for (const css of sel.media) {
    let nodes: NodeListOf<Element>;
    try {
      nodes = document.querySelectorAll(css);
    } catch {
      continue;
    }
    nodes.forEach((node) => {
      if (node instanceof HTMLImageElement) {
        const big = Math.max(node.naturalWidth, node.width) >= sel.minImagePixels;
        const url = node.currentSrc || node.src;
        if (big && url !== '' && !found.includes(url)) found.push(url);
      } else if (node instanceof HTMLVideoElement) {
        const url = node.currentSrc || node.src;
        if (url !== '' && !found.includes(url)) found.push(url);
      }
    });
  }
  return found;
}

export interface StashInfo {
  readonly size: number;
  readonly type: string;
}

/**
 * Downloads one generated file inside the page, with the owner's own session, and keeps it in
 * memory in the page until it is read in chunks. Only https and blob addresses are accepted.
 */
export async function stashMedia(url: string): Promise<StashInfo> {
  if (!url.startsWith('https://') && !url.startsWith('blob:')) {
    throw new Error('unsupported address');
  }
  const response = await fetch(url, { credentials: 'include' });
  if (!response.ok) throw new Error(`download failed (${response.status})`);
  const blob = await response.blob();
  (window as unknown as { __creatoropsMedia?: Blob }).__creatoropsMedia = blob;
  return { size: blob.size, type: blob.type };
}

/** One chunk of the stashed file, base64 encoded. */
export async function readStash(offset: number, length: number): Promise<string> {
  const blob = (window as unknown as { __creatoropsMedia?: Blob }).__creatoropsMedia;
  if (blob === undefined) throw new Error('nothing stashed');
  const url = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('read failed'));
    reader.readAsDataURL(blob.slice(offset, offset + length));
  });
  // A data address looks like `data:<type>;base64,<data>`; an empty slice has no comma part.
  return url.slice(url.indexOf(',') + 1);
}

export function clearStash(): boolean {
  delete (window as unknown as { __creatoropsMedia?: Blob }).__creatoropsMedia;
  return true;
}
