import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createDefaultTokenStore,
  createMemoryTokenStore,
  createStorageTokenStore,
  type StorageAreaLike,
} from './token-store.js';

function fakeArea(): StorageAreaLike & { data: Record<string, unknown> } {
  const data: Record<string, unknown> = {};
  return {
    data,
    get: (key) => Promise.resolve(key in data ? { [key]: data[key] } : {}),
    set: (items) => {
      Object.assign(data, items);
      return Promise.resolve();
    },
    remove: (key) => {
      delete data[key];
      return Promise.resolve();
    },
  };
}

afterEach(() => vi.unstubAllGlobals());

describe('token stores', () => {
  it('memory store round-trips and clears', async () => {
    const store = createMemoryTokenStore();
    expect(await store.get()).toBeNull();
    await store.set('t1');
    expect(await store.get()).toBe('t1');
    await store.clear();
    expect(await store.get()).toBeNull();
  });

  it('storage store keeps the token under one key and ignores non-string values', async () => {
    const area = fakeArea();
    const store = createStorageTokenStore(area);
    await store.set('t2');
    expect(Object.keys(area.data)).toEqual(['creatorops.devToken']);
    expect(await store.get()).toBe('t2');
    area.data['creatorops.devToken'] = 42;
    expect(await store.get()).toBeNull();
    area.data['creatorops.devToken'] = '';
    expect(await store.get()).toBeNull();
    await store.clear();
    expect(area.data).toEqual({});
  });

  it('uses chrome.storage.session when available, and never local or sync storage', async () => {
    const session = fakeArea();
    const local = fakeArea();
    vi.stubGlobal('chrome', { storage: { session, local, sync: fakeArea() } });
    const store = createDefaultTokenStore();
    await store.set('t3');
    expect(Object.keys(session.data)).toHaveLength(1);
    expect(local.data).toEqual({});
  });

  it('falls back to memory outside an extension and writes nothing to web storage', async () => {
    vi.stubGlobal('chrome', undefined);
    const store = createDefaultTokenStore();
    await store.set('t4');
    expect(await store.get()).toBe('t4');
    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(0);
  });
});
