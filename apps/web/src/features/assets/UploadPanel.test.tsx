import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { createDashboardClient } from '../../api/client.js';
import type { SessionResult } from '../../api/session.js';
import { DashboardContext } from '../../app/dashboard-context.js';
import { createFakeApi, json, WORKSPACE } from '../../test/fakeApi.js';
import type { FakeApi, FakeApiOptions } from '../../test/fakeApi.js';
import { FakeXhr } from '../../test/fakeXhr.js';
import { UploadPanel } from './UploadPanel.js';
import type { UploadPanelProps } from './UploadPanel.js';

const READY: SessionResult = { status: 'ready', error: null, retry: undefined };
const THAI = 'พัดลมตั้งโต๊ะ';

function renderPanel(
  props: Partial<UploadPanelProps> = {},
  options: FakeApiOptions = {},
): { api: FakeApi; queryClient: QueryClient } {
  const api = createFakeApi(options);
  const client = createDashboardClient({
    baseUrl: 'http://api.test',
    getToken: () => 'test-token',
    fetch: api.fetch,
  });
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <DashboardContext.Provider value={{ client, session: READY }}>
        <UploadPanel workspaceId={WORKSPACE.id} createTransport={() => new FakeXhr()} {...props} />
      </DashboardContext.Provider>
    </QueryClientProvider>,
  );
  FakeXhr.reset();
  return { api, queryClient };
}

const png = (name: string) => new File(['png-bytes'], name, { type: 'image/png' });
const liveRegion = () => document.querySelector<HTMLElement>('[aria-live="polite"]');
const rowOf = (name: string) => {
  const row = screen
    .getAllByRole('listitem')
    .find((item) => within(item).queryByText(name) !== null);
  if (row === undefined) throw new Error(`no row for ${name}`);
  return row;
};

describe('UploadPanel', () => {
  it('has a labelled file input that takes only the allowed types, several at once', () => {
    renderPanel();
    const input = screen.getByLabelText('Upload files');
    expect(input).toHaveAttribute('type', 'file');
    expect(input).toHaveAttribute('multiple');
    expect(input).toHaveAttribute('accept', 'image/jpeg,image/png,image/webp,image/gif,video/mp4');
  });

  it('opens the file picker from the Choose files button', async () => {
    const user = userEvent.setup();
    renderPanel();
    const input = screen.getByLabelText('Upload files');
    const click = vi.spyOn(input, 'click');

    await user.click(screen.getByRole('button', { name: 'Choose files' }));

    expect(click).toHaveBeenCalledTimes(1);
  });

  it('uploads at most two files at a time and starts the third when one finishes', async () => {
    const user = userEvent.setup();
    const { api } = renderPanel();

    await user.upload(screen.getByLabelText('Upload files'), [
      png('one.png'),
      png('two.png'),
      png('three.png'),
    ]);

    await vi.waitFor(() => expect(FakeXhr.instances).toHaveLength(2));
    expect(screen.getByText('Waiting')).toBeInTheDocument();
    expect(api.calls.filter((call) => call.path.endsWith('upload-intent'))).toHaveLength(2);

    FakeXhr.instances[0]?.respond(204);

    await vi.waitFor(() => expect(FakeXhr.instances).toHaveLength(3));
    FakeXhr.instances[1]?.respond(204);
    FakeXhr.instances[2]?.respond(204);
    await vi.waitFor(() => expect(screen.getAllByText('Done')).toHaveLength(3));
  });

  it('shows progress as a labelled progress bar and a percentage', async () => {
    const user = userEvent.setup();
    renderPanel();
    await user.upload(screen.getByLabelText('Upload files'), png('shot.png'));

    await vi.waitFor(() => expect(FakeXhr.instances).toHaveLength(1));
    FakeXhr.last().progress(45, 100);

    expect(await screen.findByText('Uploading 45%')).toBeInTheDocument();
    const bar = screen.getByRole('progressbar', { name: 'Progress for shot.png' });
    expect((bar as HTMLProgressElement).value).toBe(45);
  });

  it('shows a failed upload with its message, retries it, and then shows Done', async () => {
    const user = userEvent.setup();
    const { api } = renderPanel();
    await user.upload(screen.getByLabelText('Upload files'), png('fake.png'));

    await vi.waitFor(() => expect(FakeXhr.instances).toHaveLength(1));
    FakeXhr.last().respond(
      415,
      JSON.stringify({
        error: {
          code: 'UNSUPPORTED_MEDIA_TYPE',
          message: 'The file content does not match its type.',
          requestId: 'req-1',
        },
      }),
    );

    expect(
      await screen.findByText('Failed: The file content does not match its type.'),
    ).toBeVisible();
    const row = rowOf('fake.png');
    await user.click(within(row).getByRole('button', { name: 'Retry fake.png' }));

    await vi.waitFor(() => expect(FakeXhr.instances).toHaveLength(2));
    FakeXhr.last().respond(204);
    expect(await screen.findByText('Done')).toBeInTheDocument();
    expect(api.calls.filter((call) => call.path.endsWith('upload-intent'))).toHaveLength(2);
  });

  it('removes a waiting file without ever uploading it', async () => {
    const user = userEvent.setup();
    renderPanel();
    await user.upload(screen.getByLabelText('Upload files'), [
      png('a.png'),
      png('b.png'),
      png('c.png'),
    ]);
    await vi.waitFor(() => expect(FakeXhr.instances).toHaveLength(2));

    await user.click(screen.getByRole('button', { name: 'Remove c.png' }));
    expect(screen.queryByText('c.png')).not.toBeInTheDocument();

    FakeXhr.instances[0]?.respond(204);
    FakeXhr.instances[1]?.respond(204);
    await screen.findAllByText('Done');
    expect(FakeXhr.instances).toHaveLength(2);
  });

  it('shows a refused file as Failed at once, with no request, and only Remove', async () => {
    const { api } = renderPanel();
    const input = screen.getByLabelText('Upload files');

    fireEvent.change(input, {
      target: { files: [new File(['<svg/>'], 'logo.svg', { type: 'image/svg+xml' })] },
    });

    const row = rowOf('logo.svg');
    expect(within(row).getByText(/Failed: This file type is not supported/)).toBeVisible();
    expect(within(row).queryByRole('button', { name: 'Retry logo.svg' })).toBeNull();
    expect(within(row).getByRole('button', { name: 'Remove logo.svg' })).toBeVisible();
    expect(api.calls).toHaveLength(0);
    expect(FakeXhr.instances).toHaveLength(0);
  });

  it('refuses an oversized image on the client without any API call', async () => {
    const { api } = renderPanel();
    const huge = new File(['x'], 'huge.png', { type: 'image/png' });
    Object.defineProperty(huge, 'size', { value: 16 * 1024 * 1024 + 1 });

    fireEvent.change(screen.getByLabelText('Upload files'), { target: { files: [huge] } });

    await vi.waitFor(() =>
      expect(rowOf('huge.png')).toHaveTextContent('Failed: Images can be up to 15.0 MB'),
    );
    expect(api.calls).toHaveLength(0);
  });

  it('cancels a running upload, marks it Cancelled and offers Retry', async () => {
    const user = userEvent.setup();
    renderPanel();
    await user.upload(screen.getByLabelText('Upload files'), png('long.png'));
    await vi.waitFor(() => expect(FakeXhr.instances).toHaveLength(1));

    await user.click(screen.getByRole('button', { name: 'Cancel long.png' }));

    expect(FakeXhr.last().aborted).toBe(true);
    const row = rowOf('long.png');
    expect(await within(row).findByText('Cancelled')).toBeVisible();
    expect(within(row).getByRole('button', { name: 'Retry long.png' })).toBeVisible();
  });

  it('keeps a Thai file name whole in the queue', async () => {
    const user = userEvent.setup();
    renderPanel();
    await user.upload(screen.getByLabelText('Upload files'), png(`${THAI}.png`));

    expect(within(rowOf(`${THAI}.png`)).getByText(`${THAI}.png`)).toBeVisible();
  });

  it('announces completion and failure through a polite live region', async () => {
    const user = userEvent.setup();
    renderPanel();
    await user.upload(screen.getByLabelText('Upload files'), [png('ok.png'), png('bad.png')]);
    await vi.waitFor(() => expect(FakeXhr.instances).toHaveLength(2));

    FakeXhr.instances[0]?.respond(204);
    await vi.waitFor(() => expect(liveRegion()).toHaveTextContent('ok.png uploaded.'));

    FakeXhr.instances[1]?.networkError();
    await vi.waitFor(() =>
      expect(liveRegion()).toHaveTextContent('bad.png failed: Could not reach the server'),
    );
  });

  it('refreshes asset lists after a finished upload, and the product too when one is given', async () => {
    const user = userEvent.setup();
    const { api, queryClient } = renderPanel({ productId: 'prod_1' });
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    await user.upload(screen.getByLabelText('Upload files'), png('cover.png'));
    await vi.waitFor(() => expect(FakeXhr.instances).toHaveLength(1));

    FakeXhr.last().respond(204);
    await screen.findByText('Done');

    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['assets', WORKSPACE.id, 'list'] });
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: ['products', WORKSPACE.id, 'detail', 'prod_1'],
    });
    expect(api.calls.find((call) => call.path.endsWith('upload-intent'))?.body).toMatchObject({
      productId: 'prod_1',
    });
  });

  it('reports a server refusal of the intent as a failed row', async () => {
    const user = userEvent.setup();
    renderPanel(
      {},
      {
        intercept: (call) =>
          call.path.endsWith('upload-intent')
            ? json(
                {
                  error: {
                    code: 'CONFLICT',
                    message: 'This workspace has reached its file limit.',
                    requestId: 'req-q',
                  },
                },
                409,
              )
            : undefined,
      },
    );
    await user.upload(screen.getByLabelText('Upload files'), png('extra.png'));

    expect(
      await screen.findByText(/Failed: This workspace has reached its file limit/),
    ).toBeVisible();
    expect(FakeXhr.instances).toHaveLength(0);
  });
});
