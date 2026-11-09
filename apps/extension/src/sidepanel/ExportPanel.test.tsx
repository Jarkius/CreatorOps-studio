import { ApiError } from '@creatorops/contracts';
import type { ApiClient, Draft, Export, Job } from '@creatorops/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { ExportPanel } from './ExportPanel.js';

const DRAFT = { id: 'd1', version: 7 } as unknown as Draft;
const job = (status: Job['status'], extra: Partial<Job> = {}) =>
  ({ id: 'j1', status, errorMessage: null, ...extra }) as Job;
const exportRow = (status: Export['status'] = 'ready') =>
  ({ id: 'e1', status, filename: 'creatorops-20261105-abcd1234.zip' }) as Export;

function setup(
  options: {
    canStart?: boolean;
    exports?: Export[];
    startError?: unknown[];
    jobStatus?: Job['status'];
    jobMessage?: string;
    linkFails?: boolean;
  } = {},
) {
  const errors = [...(options.startError ?? [])];
  const exportPackage = vi.fn<(ws: string, body: unknown, key: string) => Promise<Job>>(() => {
    const error = errors.shift();
    return error === undefined ? Promise.resolve(job('queued')) : Promise.reject(error);
  });
  const list = vi.fn(() => Promise.resolve({ items: options.exports ?? [], nextCursor: null }));
  const downloadUrl = vi.fn(() =>
    options.linkFails
      ? Promise.reject(
          new ApiError({ code: 'NOT_FOUND', message: 'This package has expired.', status: 404 }),
        )
      : Promise.resolve({
          url: '/api/v1/exports/e1/download?u=1&exp=2&sig=s',
          expiresAt: 'x',
          filename: 'f.zip',
        }),
  );
  const api = {
    jobs: {
      exportPackage,
      get: () =>
        Promise.resolve(
          job(options.jobStatus ?? 'succeeded', { errorMessage: options.jobMessage ?? null }),
        ),
    },
    exports: { list, downloadUrl },
    resolveUrl: (path: string) => `http://api.test${path}`,
  } as unknown as ApiClient;
  const openUrl = vi.fn();
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <ExportPanel
        api={api}
        workspaceId="w1"
        draft={DRAFT}
        canStart={options.canStart ?? true}
        openUrl={openUrl}
      />
    </QueryClientProvider>,
  );
  return { exportPackage, list, downloadUrl, openUrl };
}

const networkError = () => new ApiError({ code: 'NETWORK_ERROR', message: 'offline', status: 0 });

describe('side panel export (S5.8)', () => {
  it('starts the job for this draft version with an ext- key, shows it done, and refreshes the latest package', async () => {
    const user = userEvent.setup();
    const { exportPackage, list } = setup();
    await user.click(await screen.findByRole('button', { name: 'Export ZIP package' }));
    await waitFor(() => expect(exportPackage).toHaveBeenCalledTimes(1));
    expect(exportPackage.mock.calls[0]?.[0]).toBe('w1');
    expect(exportPackage.mock.calls[0]?.[1]).toEqual({ draftId: 'd1', draftVersion: 7 });
    expect(exportPackage.mock.calls[0]?.[2]).toMatch(/^ext-/);
    expect(await screen.findByText('Package ready')).toBeInTheDocument();
    await waitFor(() => expect(list).toHaveBeenCalledTimes(2));
    // Refreshed once for the finished job, not on every render.
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(list).toHaveBeenCalledTimes(2);
  });

  it('downloads the latest ready package through a fresh signed link opened in a tab', async () => {
    const user = userEvent.setup();
    const { downloadUrl, openUrl } = setup({ exports: [exportRow()] });
    await user.click(await screen.findByRole('button', { name: 'Download ZIP' }));
    await waitFor(() => expect(openUrl).toHaveBeenCalledTimes(1));
    expect(downloadUrl).toHaveBeenCalledWith('w1', 'e1');
    expect(openUrl).toHaveBeenCalledWith(
      'http://api.test/api/v1/exports/e1/download?u=1&exp=2&sig=s',
    );
  });

  it('offers no download for an expired package', async () => {
    setup({ exports: [exportRow('expired')] });
    await screen.findByText('Export package');
    expect(screen.queryByRole('button', { name: 'Download ZIP' })).not.toBeInTheDocument();
  });

  it('lets a read-only member download but not export', async () => {
    setup({ canStart: false, exports: [exportRow()] });
    expect(await screen.findByRole('button', { name: 'Download ZIP' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Export ZIP package' })).not.toBeInTheDocument();
  });

  it('shows the failure message of a failed job', async () => {
    const user = userEvent.setup();
    setup({ jobStatus: 'failed', jobMessage: 'A file is no longer available.' });
    await user.click(await screen.findByRole('button', { name: 'Export ZIP package' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('A file is no longer available.');
  });

  it('explains a version conflict and shows other errors plainly', async () => {
    const user = userEvent.setup();
    setup({
      startError: [new ApiError({ code: 'CONFLICT', message: 'newer', status: 409 })],
    });
    await user.click(await screen.findByRole('button', { name: 'Export ZIP package' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('This draft changed');
  });

  it('says why when the link cannot be made, and opens nothing', async () => {
    const user = userEvent.setup();
    const { openUrl } = setup({ exports: [exportRow()], linkFails: true });
    await user.click(await screen.findByRole('button', { name: 'Download ZIP' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('This package has expired.');
    expect(openUrl).not.toHaveBeenCalled();
  });

  it('reuses the key after a failure without a response, and makes a new one after a server error', async () => {
    const user = userEvent.setup();
    const retry = setup({ startError: [networkError()] });
    await user.click(await screen.findByRole('button', { name: 'Export ZIP package' }));
    await screen.findByRole('alert');
    await user.click(screen.getByRole('button', { name: 'Export ZIP package' }));
    await waitFor(() => expect(retry.exportPackage).toHaveBeenCalledTimes(2));
    expect(retry.exportPackage.mock.calls[0]?.[2]).toBe(retry.exportPackage.mock.calls[1]?.[2]);
  });

  it('makes a new key after the server answered with an error', async () => {
    const user = userEvent.setup();
    const next = setup({
      startError: [new ApiError({ code: 'INTERNAL_ERROR', message: 'down', status: 500 })],
    });
    await user.click(await screen.findByRole('button', { name: 'Export ZIP package' }));
    await screen.findByRole('alert');
    await user.click(screen.getByRole('button', { name: 'Export ZIP package' }));
    await waitFor(() => expect(next.exportPackage).toHaveBeenCalledTimes(2));
    expect(next.exportPackage.mock.calls[0]?.[2]).not.toBe(next.exportPackage.mock.calls[1]?.[2]);
  });
});
