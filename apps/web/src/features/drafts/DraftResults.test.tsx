import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Asset, DraftAsset, Export, Job } from '@creatorops/contracts';

import { json, makeAsset } from '../../test/fakeApi.js';
import type { RecordedCall } from '../../test/fakeApi.js';
import { makeJob } from '../../test/fakeContentApi.js';
import { DRAFT_ID, makeScreenDraft, renderDraft, WS } from './draftScreenTestSetup.js';
import { captionForPost } from './exportText.js';
import { startDownload } from './startDownload.js';

vi.mock('./startDownload.js', () => ({ startDownload: vi.fn() }));

const API = `/api/v1/workspaces/${WS}`;

function attachment(id: string, overrides: Partial<DraftAsset> = {}): DraftAsset {
  return {
    assetId: id,
    role: 'media',
    sortOrder: 0,
    scene: 'product_hero',
    aiGenerated: true,
    generator: 'Meta AI',
    asset: makeAsset({ id, originalFilename: `${id}.png` }),
    createdAt: '2026-11-04T00:00:00.000Z',
    ...overrides,
  };
}

function makeExport(id: string, overrides: Partial<Export> = {}): Export {
  return {
    id,
    workspaceId: WS,
    draftId: DRAFT_ID,
    jobId: `job_${id}`,
    status: 'ready',
    draftVersion: 1,
    fileCount: 4,
    sizeBytes: 2048,
    sha256: 'c'.repeat(64),
    filename: `creatorops-20261104-${id}.zip`,
    createdAt: '2026-11-04T00:00:00.000Z',
    expiresAt: '2099-11-11T00:00:00.000Z',
    ...overrides,
  };
}

interface World {
  files: DraftAsset[];
  exports: Export[];
  job: Job | null;
  calls: RecordedCall[];
  conflict: boolean;
  failLink: boolean;
  /** Fails the next export POST: without any response, or with a 500. */
  failNext: 'network' | 'server' | null;
  /** The product's library (served for the picker). */
  library: Asset[];
  /** Answers the attachments PUT with a 500. */
  failSave: boolean;
}

function setup(
  role: 'owner' | 'viewer' = 'owner',
  world: Partial<World> = {},
  status: 'draft' | 'approved' = 'draft',
  version = 1,
) {
  const state: World = {
    files: [],
    exports: [],
    job: null,
    calls: [],
    conflict: false,
    failLink: false,
    failNext: null,
    library: [],
    failSave: false,
    ...world,
  };
  const view = renderDraft({
    role,
    draft: makeScreenDraft({ status, version }),
    extra: (call) => {
      state.calls.push(call);
      const path = call.path.split('?')[0] ?? '';
      if (path === `${API}/drafts/${DRAFT_ID}/assets` && call.method === 'GET') {
        return json({ items: state.files });
      }
      if (path === `${API}/assets` && call.method === 'GET') {
        return json({ items: state.library, nextCursor: null });
      }
      if (path === `${API}/drafts/${DRAFT_ID}/assets` && call.method === 'PUT') {
        if (state.failSave) {
          return json(
            { error: { code: 'INTERNAL_ERROR', message: 'Save is down.', requestId: 'r' } },
            500,
          );
        }
        const wanted = (call.body as { assets: { assetId: string; role: string }[] }).assets;
        state.files = wanted
          .map((item) => {
            const before = state.files.find((file) => file.assetId === item.assetId);
            return (
              before ??
              attachment(item.assetId, { aiGenerated: false, generator: null, scene: null })
            );
          })
          .map((file, index) => ({
            ...file,
            sortOrder: index,
            role: wanted[index]?.role === 'cover' ? 'cover' : 'media',
          }));
        return json({ items: state.files });
      }
      if (path === `${API}/exports` && call.method === 'GET') {
        return json({ items: state.exports, nextCursor: null });
      }
      if (path === `${API}/jobs/export-package` && call.method === 'POST') {
        if (state.failNext !== null) {
          const mode = state.failNext;
          state.failNext = null;
          if (mode === 'network') throw new TypeError('Failed to fetch');
          return json({ error: { code: 'INTERNAL_ERROR', message: 'Down.', requestId: 'r' } }, 500);
        }
        if (state.conflict) {
          return json(
            { error: { code: 'CONFLICT', message: 'Draft is newer.', requestId: 'r' } },
            409,
          );
        }
        state.job = makeJob({ id: 'job_exp', type: 'export_package', status: 'queued' });
        return json(state.job, 202);
      }
      if (path === `${API}/jobs/job_exp` && call.method === 'GET') {
        return json(state.job);
      }
      const download = /\/exports\/([^/]+)\/download-url$/.exec(path);
      if (download !== null && call.method === 'POST') {
        if (state.failLink) {
          return json(
            { error: { code: 'INTERNAL_ERROR', message: 'Link is down.', requestId: 'r' } },
            500,
          );
        }
        return json({
          url: `/api/v1/exports/${download[1] ?? ''}/download?u=1&exp=2&sig=s`,
          expiresAt: '2099-01-01T00:00:00.000Z',
          filename: 'x.zip',
        });
      }
      return undefined;
    },
  });
  return { ...view, state };
}

beforeEach(() => {
  vi.mocked(startDownload).mockClear();
});

describe('DraftResults: files', () => {
  it('shows an empty note, then thumbnails with scene, cover and AI label', async () => {
    setup('owner');
    expect(await screen.findByText(/No files are attached to this draft yet/)).toBeInTheDocument();
  });

  it('lists attached files in order with labels', async () => {
    setup('owner', {
      files: [
        attachment('a1', { role: 'cover', scene: null, aiGenerated: false, generator: null }),
        attachment('a2', { scene: 'usage' }),
      ],
    });
    const list = await screen.findByRole('list', { name: 'Attached files' });
    const items = within(list).getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(within(items[0]!).getByText('Cover')).toBeInTheDocument();
    expect(within(items[0]!).queryByText(/AI-made/)).toBeNull();
    expect(within(items[1]!).getByText('Usage')).toBeInTheDocument();
    expect(within(items[1]!).getByText('AI-made with Meta AI')).toBeInTheDocument();
    expect(within(items[1]!).getByRole('img')).toHaveAttribute(
      'src',
      expect.stringContaining('/api/v1/media/a2/thumb'),
    );
  });
});

describe('DraftResults: caption', () => {
  it('copies caption and hashtags exactly as the post needs them', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    setup('owner');
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    await user.click(await screen.findByRole('button', { name: 'Copy caption and hashtags' }));
    const draft = makeScreenDraft();
    expect(writeText).toHaveBeenCalledWith(captionForPost(draft.sections));
    expect(writeText.mock.calls[0]?.[0]).toBe(
      'พัดลมตั้งโต๊ะ ลมเย็น เสียงเบา ใช้ได้ทั้งวัน\n\n#พัดลม #DeskFan',
    );
    expect(await screen.findAllByText('Copied')).not.toHaveLength(0);
  });

  it('says so when the browser refuses the copy', async () => {
    const user = userEvent.setup();
    setup('owner');
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn().mockRejectedValue(new Error('no')) },
    });
    await user.click(await screen.findByRole('button', { name: 'Copy caption and hashtags' }));
    expect(await screen.findByText(/Copy failed. Select the caption text/)).toBeInTheDocument();
  });
});

describe('DraftResults: export', () => {
  it('starts the job with the draft version and an idempotency key, then shows it finished', async () => {
    const user = userEvent.setup();
    const { state, keys } = setup('owner', {}, 'draft', 3);
    await user.click(await screen.findByRole('button', { name: 'Export ZIP package' }));
    await waitFor(() => expect(state.job).not.toBeNull());
    const post = state.calls.find((call) => call.path.endsWith('/jobs/export-package'));
    expect(post?.body).toEqual({ draftId: DRAFT_ID, draftVersion: 3 });
    expect(keys.find((k) => k.path.endsWith('/jobs/export-package'))?.key).toMatch(/^ui-/);
    expect(await screen.findByText('Waiting to start')).toBeInTheDocument();

    // The worker finishes: the package appears in the list.
    state.job = makeJob({ id: 'job_exp', type: 'export_package', status: 'succeeded' });
    state.exports = [makeExport('e1')];
    expect(
      await screen.findByText('Package ready', undefined, { timeout: 8000 }),
    ).toBeInTheDocument();
    expect(await screen.findByText('creatorops-20261104-e1.zip')).toBeInTheDocument();
  }, 15000);

  it('shows the failure message of a failed job', async () => {
    const user = userEvent.setup();
    const { state } = setup('owner');
    await user.click(await screen.findByRole('button', { name: 'Export ZIP package' }));
    await waitFor(() => expect(state.job).not.toBeNull());
    state.job = makeJob({
      id: 'job_exp',
      type: 'export_package',
      status: 'failed',
      errorMessage: 'A file is no longer available.',
    });
    expect(
      await screen.findByText('A file is no longer available.', undefined, { timeout: 8000 }),
    ).toBeInTheDocument();
  }, 15000);

  it('explains a version conflict', async () => {
    const user = userEvent.setup();
    setup('owner', { conflict: true });
    await user.click(await screen.findByRole('button', { name: 'Export ZIP package' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('This draft changed');
  });

  it('warns about an unapproved draft and says nothing for an approved one', async () => {
    const first = setup('owner');
    expect(await screen.findByText(/This draft is not approved yet/)).toBeInTheDocument();
    first.unmount();
    setup('owner', {}, 'approved');
    await screen.findByRole('button', { name: 'Export ZIP package' });
    expect(screen.queryByText(/This draft is not approved yet/)).toBeNull();
  });

  it('hides the export button from a viewer but still lets them download', async () => {
    const user = userEvent.setup();
    setup('viewer', { exports: [makeExport('e2')] });
    expect(await screen.findByText('creatorops-20261104-e2.zip')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Export ZIP package' })).toBeNull();
    expect(screen.getByText(/download packages but not create them/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Download' }));
    await waitFor(() => expect(startDownload).toHaveBeenCalledTimes(1));
  });
});

describe('DraftResults: choosing files', () => {
  const library = () => [
    makeAsset({ id: 'p1', originalFilename: 'front.png' }),
    makeAsset({ id: 'p2', originalFilename: 'side.png' }),
    makeAsset({ id: 'p3', originalFilename: 'demo.mp4', type: 'video', mimeType: 'video/mp4' }),
  ];

  it('is offered to editors only', async () => {
    setup('viewer', { library: library() });
    await screen.findByText(/No files are attached to this draft yet/);
    expect(screen.queryByRole('button', { name: 'Choose files' })).toBeNull();
  });

  it('attaches ticked files with the chosen cover, keeps what was attached, and shows them', async () => {
    const user = userEvent.setup();
    const { state } = setup('owner', {
      library: library(),
      files: [attachment('p2', { scene: 'detail', aiGenerated: true, generator: 'Meta AI' })],
    });
    await user.click(await screen.findByRole('button', { name: 'Choose files' }));
    const front = await screen.findByRole('checkbox', { name: 'front.png' });
    expect(screen.getByRole('checkbox', { name: 'side.png' })).toBeChecked();
    expect(front).not.toBeChecked();
    await user.click(front);
    // A cover can only be a picture: the video offers none.
    await user.click(screen.getByRole('checkbox', { name: 'demo.mp4' }));
    expect(screen.getAllByRole('radio', { name: 'Cover' })).toHaveLength(2);
    await user.click(screen.getAllByRole('radio', { name: 'Cover' })[0]!);
    expect(screen.getByText('3 of 10 files chosen.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Save files' }));

    expect(await screen.findByText('Files saved')).toBeInTheDocument();
    const put = state.calls.find((call) => call.method === 'PUT');
    expect(put?.body).toEqual({
      assets: [
        { assetId: 'p2', role: 'media', aiGenerated: true, scene: 'detail', generator: 'Meta AI' },
        { assetId: 'p1', role: 'cover', aiGenerated: false },
        { assetId: 'p3', role: 'media', aiGenerated: false },
      ],
    });
    const list = await screen.findByRole('list', { name: 'Attached files' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(3);
  });

  it('unticking the cover file clears the cover, and a failed save keeps the picker open with the message', async () => {
    const user = userEvent.setup();
    const { state } = setup('owner', {
      library: library(),
      failSave: true,
      files: [attachment('p1', { role: 'cover', scene: null })],
    });
    await user.click(await screen.findByRole('button', { name: 'Choose files' }));
    await user.click(await screen.findByRole('checkbox', { name: 'front.png' }));
    await user.click(await screen.findByRole('checkbox', { name: 'front.png' }));
    expect(screen.getByRole('radio', { name: 'Cover' })).not.toBeChecked();
    await user.click(screen.getByRole('button', { name: 'Save files' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Save is down.');
    expect(screen.getByRole('button', { name: 'Save files' })).toBeInTheDocument();
    expect(
      (state.calls.find((c) => c.method === 'PUT')?.body as { assets: { role: string }[] })
        .assets[0]?.role,
    ).toBe('media');
  });

  it('stops offering more files once ten are chosen', async () => {
    const user = userEvent.setup();
    const many = Array.from({ length: 11 }, (_, index) =>
      makeAsset({ id: `m${String(index)}`, originalFilename: `file-${String(index)}.png` }),
    );
    setup('owner', { library: many });
    await user.click(await screen.findByRole('button', { name: 'Choose files' }));
    for (let index = 0; index < 10; index += 1) {
      await user.click(await screen.findByRole('checkbox', { name: `file-${String(index)}.png` }));
    }
    expect(screen.getByText('10 of 10 files chosen.')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'file-10.png' })).toBeDisabled();
    // A chosen file can still be unticked.
    expect(screen.getByRole('checkbox', { name: 'file-0.png' })).toBeEnabled();
  });

  it('says so when the product has no files, and Cancel closes without saving', async () => {
    const user = userEvent.setup();
    const { state } = setup('owner');
    await user.click(await screen.findByRole('button', { name: 'Choose files' }));
    expect(await screen.findByText(/This product has no files yet/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('button', { name: 'Choose files' })).toBeInTheDocument();
    expect(state.calls.some((call) => call.method === 'PUT')).toBe(false);
  });
});

describe('DraftResults: retrying an export', () => {
  const postKeys = (keys: { path: string; key: string | null }[]) =>
    keys.filter((k) => k.path.endsWith('/jobs/export-package')).map((k) => k.key);

  it('reuses the key after a failure without a response, so a retry cannot double-export', async () => {
    const user = userEvent.setup();
    const { keys } = setup('owner', { failNext: 'network' });
    const button = await screen.findByRole('button', { name: 'Export ZIP package' });
    await user.click(button);
    await screen.findByRole('alert');
    await user.click(screen.getByRole('button', { name: 'Export ZIP package' }));
    await waitFor(() => expect(postKeys(keys)).toHaveLength(2));
    const [first, second] = postKeys(keys);
    expect(first).toBe(second);
  });

  it('makes a new key after the server answered with an error', async () => {
    const user = userEvent.setup();
    const { keys } = setup('owner', { failNext: 'server' });
    await user.click(await screen.findByRole('button', { name: 'Export ZIP package' }));
    await screen.findByRole('alert');
    await user.click(screen.getByRole('button', { name: 'Export ZIP package' }));
    await waitFor(() => expect(postKeys(keys)).toHaveLength(2));
    const [first, second] = postKeys(keys);
    expect(first).not.toBe(second);
  });
});

describe('DraftResults: packages', () => {
  it('downloads through a fresh signed link, resolved against the API origin', async () => {
    const user = userEvent.setup();
    const { state } = setup('owner', { exports: [makeExport('e3')] });
    await user.click(await screen.findByRole('button', { name: 'Download' }));
    await waitFor(() => expect(startDownload).toHaveBeenCalledTimes(1));
    expect(vi.mocked(startDownload).mock.calls[0]?.[0]).toMatch(
      /^https?:\/\/.+\/api\/v1\/exports\/e3\/download\?u=1&exp=2&sig=s$/,
    );
    expect(state.calls.some((c) => c.path.endsWith('/exports/e3/download-url'))).toBe(true);
  });

  it('shows an expired package without a download button', async () => {
    setup('owner', {
      exports: [
        makeExport('e4', { status: 'expired' }),
        makeExport('e5', { expiresAt: '2000-01-01T00:00:00.000Z' }),
      ],
    });
    const list = await screen.findByRole('list', { name: 'Packages' });
    expect(within(list).getAllByText(/Expired/)).toHaveLength(2);
    expect(within(list).queryByRole('button', { name: 'Download' })).toBeNull();
  });

  it('shows an error and starts no download when the signed link cannot be made', async () => {
    const user = userEvent.setup();
    setup('owner', { exports: [makeExport('e6')], failLink: true });
    await user.click(await screen.findByRole('button', { name: 'Download' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Link is down.');
    expect(startDownload).not.toHaveBeenCalled();
  });
});
