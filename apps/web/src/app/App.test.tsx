import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createDashboardClient } from '../api/client.js';
import { WORKSPACE } from '../test/fakeApi.js';
import { createTokenStore } from '../api/session.js';
import { App } from './App.js';

const THAI_NAME = 'สมชาย ใจดี';
const TOKEN = 'token-in-memory-only';

const USER = { id: 'usr_1', email: 'dev@example.test', displayName: 'Dev User' };
const ME = {
  user: USER,
  workspaces: [{ id: 'ws_1', name: 'Studio One', role: 'owner' }],
};
const HEALTH = { status: 'ok', service: 'creatorops-api', time: '2026-11-03T00:00:00.000Z' };

function json(body: unknown, status = 200, requestId = 'req-ok'): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'x-request-id': requestId },
  });
}

/** A fake fetch for the three endpoints the dashboard uses. */
function fakeApi(overrides: { me?: () => Response } = {}) {
  const calls: string[] = [];
  const fetchFn = (input: string | URL | Request): Promise<Response> => {
    const url = new URL(
      typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
    );
    calls.push(`${url.pathname}`);
    if (url.pathname === '/api/v1/auth/mock-token') {
      return Promise.resolve(
        json({ token: TOKEN, expiresAt: '2026-11-04T00:00:00.000Z', user: USER }),
      );
    }
    if (url.pathname === '/api/v1/health') return Promise.resolve(json(HEALTH));
    if (url.pathname === '/api/v1/workspaces') {
      return Promise.resolve(json({ items: [WORKSPACE] }));
    }
    if (url.pathname === '/api/v1/me') {
      return Promise.resolve(overrides.me ? overrides.me() : json(ME));
    }
    return Promise.resolve(
      json({ error: { code: 'NOT_FOUND', message: 'Not found.', requestId: 'req-404' } }, 404),
    );
  };
  return { fetchFn, calls };
}

function renderApp(fetchFn: (input: string | URL | Request) => Promise<Response>) {
  const tokenStore = createTokenStore();
  const client = createDashboardClient({
    baseUrl: 'http://api.test',
    getToken: tokenStore.get,
    fetch: fetchFn as typeof fetch,
  });
  return render(<App client={client} tokenStore={tokenStore} authMode="mock" />);
}

describe('Overview page', () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
  });

  afterEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
  });

  it('shows loading, then the API status and the signed-in user', async () => {
    const { fetchFn } = fakeApi();
    renderApp(fetchFn);

    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(await screen.findByText('API status: ok')).toBeInTheDocument();
    expect(screen.getByText('Dev User')).toBeInTheDocument();
    expect(screen.getByText('dev@example.test')).toBeInTheDocument();
    expect(screen.getByText('Studio One')).toBeInTheDocument();
    expect(screen.getByText('Owner')).toBeInTheDocument();
  });

  it('shows the error reference on failure and Retry succeeds on the second call', async () => {
    let meCalls = 0;
    const { fetchFn } = fakeApi({
      me: () => {
        meCalls += 1;
        if (meCalls === 1) {
          return json(
            {
              error: {
                code: 'INTERNAL_ERROR',
                message: 'Something broke on our side.',
                requestId: 'req-abc-123',
              },
            },
            500,
            'req-abc-123',
          );
        }
        return json(ME);
      },
    });
    renderApp(fetchFn);

    const alert = await screen.findByRole('alert');
    expect(within(alert).getByText('Something broke on our side.')).toBeInTheDocument();
    expect(within(alert).getByText('Reference: req-abc-123')).toBeInTheDocument();

    fireEvent.click(within(alert).getByRole('button', { name: 'Try again' }));

    expect(await screen.findByText('Dev User')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(meCalls).toBe(2);
  });

  it('exposes the nav as Main with Overview and Products as links', async () => {
    const { fetchFn } = fakeApi();
    renderApp(fetchFn);
    await screen.findByText('Dev User');

    const nav = screen.getByRole('navigation', { name: 'Main' });
    await within(nav).findByRole('link', { name: 'Products' });
    const links = within(nav).getAllByRole('link');
    expect(links.map((link) => link.textContent)).toEqual([
      'Overview',
      'Products',
      'Asset library',
    ]);
    expect(links[1]).toHaveAttribute('href', '/w/ws_1/products');
    expect(links[2]).toHaveAttribute('href', '/w/ws_1/assets');

    for (const label of [
      'Campaigns',
      'Content drafts',
      'Calendar',
      'Publishing',
      'Usage',
      'Settings',
    ]) {
      const item = within(nav).getByText(label).closest('[aria-disabled="true"]');
      expect(item).not.toBeNull();
      expect(item).toHaveTextContent('Soon');
    }
  });

  it('renders a Thai display name without truncation', async () => {
    const { fetchFn } = fakeApi({
      me: () => json({ ...ME, user: { ...USER, displayName: THAI_NAME } }),
    });
    renderApp(fetchFn);

    const name = await screen.findByText(THAI_NAME);
    expect(name).toBeInTheDocument();
    expect(name.className).not.toMatch(/truncate|line-clamp|whitespace-nowrap/);
    expect(name.closest('[class*="overflow-hidden"]')).toBeNull();
  });

  it('never writes the token to localStorage or sessionStorage', async () => {
    const { fetchFn, calls } = fakeApi();
    renderApp(fetchFn);
    await screen.findByText('Dev User');

    expect(calls).toContain('/api/v1/auth/mock-token');
    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(0);
  });
});
