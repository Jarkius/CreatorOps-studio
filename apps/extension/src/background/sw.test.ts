import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Listener = () => void;

describe('service worker', () => {
  const listeners: { onInstalled: Listener[]; onStartup: Listener[] } = {
    onInstalled: [],
    onStartup: [],
  };
  const setPanelBehavior = vi.fn(() => Promise.resolve());

  beforeEach(() => {
    vi.resetModules();
    listeners.onInstalled = [];
    listeners.onStartup = [];
    setPanelBehavior.mockClear();
    vi.stubGlobal('chrome', {
      runtime: {
        onInstalled: { addListener: (l: Listener) => listeners.onInstalled.push(l) },
        onStartup: { addListener: (l: Listener) => listeners.onStartup.push(l) },
      },
      sidePanel: { setPanelBehavior },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('registers exactly the install and startup handlers and does nothing else on load', async () => {
    await import('./sw.js');
    expect(listeners.onInstalled).toHaveLength(1);
    expect(listeners.onStartup).toHaveLength(1);
    expect(setPanelBehavior).not.toHaveBeenCalled();
  });

  it('opens the side panel when the toolbar icon is clicked, after install and after startup', async () => {
    await import('./sw.js');
    listeners.onInstalled[0]?.();
    listeners.onStartup[0]?.();
    await Promise.resolve();
    expect(setPanelBehavior).toHaveBeenCalledTimes(2);
    expect(setPanelBehavior).toHaveBeenCalledWith({ openPanelOnActionClick: true });
  });

  it('survives being restarted: a fresh load behaves the same (no state carried over)', async () => {
    await import('./sw.js');
    listeners.onStartup[0]?.();
    vi.resetModules();
    listeners.onInstalled = [];
    listeners.onStartup = [];
    await import('./sw.js');
    listeners.onStartup[0]?.();
    await Promise.resolve();
    expect(setPanelBehavior).toHaveBeenCalledTimes(2);
  });

  it('reports a failure to enable the panel instead of throwing', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    setPanelBehavior.mockRejectedValueOnce(new Error('nope'));
    await import('./sw.js');
    listeners.onInstalled[0]?.();
    await new Promise((r) => setTimeout(r, 0));
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });
});
