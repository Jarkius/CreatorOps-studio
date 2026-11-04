import type { ApiClient } from '@creatorops/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import type { MetaAiBrowser, PageFunctions } from './runner.js';
import { useMetaAiHelper } from './useMetaAi.js';

describe('useMetaAiHelper', () => {
  it('runs one scene at a time: a second start while one is running does nothing', async () => {
    const probe = vi.fn(() => new Promise(() => undefined));
    const browser: MetaAiBrowser = {
      hasPermission: () => Promise.resolve(true),
      requestPermission: () => Promise.resolve(true),
      findTab: () => Promise.resolve(1),
      openTab: () => Promise.resolve(1),
      run: (_tab, func, args) =>
        Promise.resolve((func as (...a: unknown[]) => unknown)(...args)) as never,
    };
    const deps = { browser, page: { probePage: probe } as unknown as PageFunctions };
    const client = new QueryClient();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(
      () => useMetaAiHelper({} as ApiClient, 'w1', { id: 'd1', productId: 'p1' }, deps),
      { wrapper },
    );
    await act(async () => {
      void result.current.start('usage', 'one');
      void result.current.start('detail', 'two');
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(probe).toHaveBeenCalledTimes(1);
    expect(result.current.state).toMatchObject({ phase: 'running', scene: 'usage' });
    await act(async () => {
      result.current.cancel();
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(result.current.state).toMatchObject({ phase: 'failed', code: 'CANCELLED' });
  });
});
