/**
 * Holds the development bearer token for the side panel.
 *
 * The token lives in `chrome.storage.session`: memory-only, cleared when the browser closes,
 * and not exposed to content scripts by default. It is never written to localStorage,
 * chrome.storage.local, cookies, or a URL (docs/05 section 2). Outside an extension context
 * (unit tests) an in-memory store is used instead.
 */
export interface TokenStore {
  get(): Promise<string | null>;
  set(token: string): Promise<void>;
  clear(): Promise<void>;
}

const TOKEN_KEY = 'creatorops.devToken';

/** The subset of chrome.storage.StorageArea that the store needs. */
export interface StorageAreaLike {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(key: string): Promise<void>;
}

export function createMemoryTokenStore(): TokenStore {
  let token: string | null = null;
  return {
    get: () => Promise.resolve(token),
    set: (value) => {
      token = value;
      return Promise.resolve();
    },
    clear: () => {
      token = null;
      return Promise.resolve();
    },
  };
}

export function createStorageTokenStore(area: StorageAreaLike): TokenStore {
  return {
    async get() {
      const stored = (await area.get(TOKEN_KEY))[TOKEN_KEY];
      return typeof stored === 'string' && stored.length > 0 ? stored : null;
    },
    async set(token) {
      await area.set({ [TOKEN_KEY]: token });
    },
    async clear() {
      await area.remove(TOKEN_KEY);
    },
  };
}

/** Uses chrome.storage.session when running as an extension page, memory otherwise. */
export function createDefaultTokenStore(): TokenStore {
  const area = typeof chrome !== 'undefined' ? chrome.storage?.session : undefined;
  return area
    ? createStorageTokenStore(area as unknown as StorageAreaLike)
    : createMemoryTokenStore();
}
