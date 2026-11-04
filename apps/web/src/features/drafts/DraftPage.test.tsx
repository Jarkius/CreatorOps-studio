import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { Draft } from '@creatorops/contracts';

import { formatDraftForCopy } from './formatDraft.js';
import {
  DRAFT_PATH,
  makeScreenDraft,
  renderDraft,
  SECTIONS,
  sectionCard,
  WS,
} from './draftScreenTestSetup.js';

/** Replaces navigator.clipboard after userEvent.setup() has installed its own stub. */
function stubClipboard(writeText = vi.fn().mockResolvedValue(undefined)) {
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  return writeText;
}

const SECTION_ORDER = [
  'Title',
  'Hook',
  'Script',
  'Storyboard',
  'Caption',
  'Hashtags',
  'Call to action',
];

describe('DraftPage: states', () => {
  it('shows a loading state, then the header with the variant, status, date and campaign link', async () => {
    renderDraft({ draft: makeScreenDraft({ variantIndex: 1, status: 'in_review' }) });

    expect(screen.getByText('Loading draft…')).toBeInTheDocument();
    expect(await screen.findByRole('heading', { level: 1, name: 'Variant 2' })).toBeInTheDocument();
    expect(document.querySelector('[data-status="in_review"]')).not.toBeNull();
    expect(screen.getByText(/^Updated /)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to campaign' })).toHaveAttribute(
      'href',
      `/w/${WS}/campaigns/camp_1`,
    );
  });

  it('shows the NotFound notice for an unknown draft', async () => {
    renderDraft({ path: `/w/${WS}/drafts/draft_missing` });
    expect(await screen.findByRole('heading', { name: 'Draft not found' })).toBeInTheDocument();
  });

  it('shows the error state with the server message when the draft cannot be loaded', async () => {
    renderDraft({ failDraftGet: true });
    expect(await screen.findByRole('alert')).toHaveTextContent('Boom.');
  });
});

describe('DraftPage: sections', () => {
  it('shows the seven sections in order, with their Thai text', async () => {
    renderDraft();
    const list = await screen.findByRole('list', { name: 'Sections' });

    const headings = within(list)
      .getAllByRole('heading', { level: 3 })
      .map((heading) => heading.textContent);
    expect(headings).toEqual(SECTION_ORDER);
    expect(within(list).getByText(SECTIONS.hook)).toBeInTheDocument();
    expect(within(list).getByText(SECTIONS.caption)).toBeInTheDocument();
  });

  it('shows the storyboard as an ordered list and the hashtags as chips', async () => {
    renderDraft();
    await screen.findByRole('list', { name: 'Sections' });

    const storyboard = within(sectionCard('Storyboard')).getByRole('list');
    expect(storyboard.tagName).toBe('OL');
    const scenes = within(storyboard).getAllByRole('listitem');
    expect(scenes.map((item) => item.textContent)).toEqual(SECTIONS.storyboard);

    const tags = within(sectionCard('Hashtags')).getByRole('list', { name: 'Hashtags' });
    expect(
      within(tags)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual(['#พัดลม', '#DeskFan']);
  });

  it('shows the origin badge and the revision of each section', async () => {
    const draft = makeScreenDraft();
    draft.sectionState.title = { rev: 3, origin: 'edited', jobId: null };
    renderDraft({ draft });
    await screen.findByRole('list', { name: 'Sections' });

    const title = sectionCard('Title');
    expect(within(title).getByText('Edited')).toBeInTheDocument();
    expect(within(title).getByText('revision 3')).toBeInTheDocument();

    const hook = sectionCard('Hook');
    expect(within(hook).getByText('AI generated')).toBeInTheDocument();
    expect(within(hook).getByText('revision 1')).toBeInTheDocument();
  });
});

describe('DraftPage: claim warnings', () => {
  const draft = (): Draft =>
    makeScreenDraft({
      needsReview: true,
      claimWarnings: [
        { section: 'hook', kind: 'restricted_claim', text: 'ลดราคา 50% วันนี้เท่านั้น' },
        { section: 'caption', kind: 'unsupported_claim', text: 'ใช้ได้ 24 ชั่วโมง' },
      ],
    });

  it('shows the review banner with each warning, its section and its kind', async () => {
    renderDraft({ draft: draft() });

    expect(
      await screen.findByText(
        'Needs review: some text may make a claim that is not supported by the product facts.',
      ),
    ).toBeInTheDocument();
    const list = screen.getByRole('list', { name: 'Claim warnings' });
    const items = within(list).getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent('Hook');
    expect(items[0]).toHaveTextContent('Restricted claim');
    expect(items[0]).toHaveTextContent('ลดราคา 50% วันนี้เท่านั้น');
    expect(items[1]).toHaveTextContent('Caption');
    expect(items[1]).toHaveTextContent('Unsupported claim');
  });

  it('puts each warning badge on its own section only', async () => {
    renderDraft({ draft: draft() });
    await screen.findByRole('list', { name: 'Sections' });

    const hookBadges = screen.getByRole('list', { name: 'Claim warnings for Hook' });
    expect(within(hookBadges).getByText('ลดราคา 50% วันนี้เท่านั้น')).toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'Claim warnings for Caption' })).toHaveTextContent(
      'ใช้ได้ 24 ชั่วโมง',
    );
    expect(sectionCard('Title').querySelector('[aria-label^="Claim warnings"]')).toBeNull();
    expect(sectionCard('Script').querySelector('[aria-label^="Claim warnings"]')).toBeNull();
  });

  it('shows no banner when the draft does not need review', async () => {
    renderDraft();
    await screen.findByRole('list', { name: 'Sections' });
    expect(screen.queryByText(/^Needs review/)).not.toBeInTheDocument();
  });
});

describe('DraftPage: status', () => {
  it('sends a status-only request: the new status, the version, and the title unchanged', async () => {
    const user = userEvent.setup();
    const { api, draft } = renderDraft();
    await screen.findByRole('list', { name: 'Sections' });
    const version = draft.version;

    const save = screen.getByRole('button', { name: 'Save status' });
    expect(save).toBeDisabled();
    await user.selectOptions(screen.getByRole('combobox', { name: 'Status' }), 'approved');
    expect(save).toBeEnabled();
    await user.click(save);

    await waitFor(() => expect(document.querySelector('[data-status="approved"]')).not.toBeNull());
    expect(api.calls.find((call) => call.method === 'PATCH')?.body).toEqual({
      version,
      status: 'approved',
      sections: { title: SECTIONS.title },
    });
    expect(screen.getByRole('status')).toHaveTextContent('Status saved');
    expect(save).toBeDisabled();
  });

  it('explains that editing an approved or reviewed draft returns it to Draft', async () => {
    renderDraft();
    expect(
      await screen.findByText(
        'Editing the text of an approved or reviewed draft returns it to Draft.',
      ),
    ).toBeInTheDocument();
  });

  it.each(['viewer', 'reviewer'] as const)(
    'shows a %s only the status pill and the read-only notice',
    async (role) => {
      renderDraft({ role });
      expect(
        await screen.findByText('You can view this draft but not change it.'),
      ).toBeInTheDocument();
      expect(screen.queryByRole('combobox', { name: 'Status' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Save status' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Regenerate' })).not.toBeInTheDocument();
      expect(document.querySelector('[data-status="draft"]')).not.toBeNull();
    },
  );
});

describe('DraftPage: copy', () => {
  it('copies one section', async () => {
    const user = userEvent.setup();
    renderDraft();
    await screen.findByRole('list', { name: 'Sections' });
    const writeText = stubClipboard();

    await user.click(within(sectionCard('Hook')).getByRole('button', { name: 'Copy' }));

    expect(writeText).toHaveBeenCalledWith(SECTIONS.hook);
    expect(await within(sectionCard('Hook')).findByText('Copied')).toBeInTheDocument();
  });

  it('copies the whole draft in section order', async () => {
    const user = userEvent.setup();
    renderDraft();
    await screen.findByRole('list', { name: 'Sections' });
    const writeText = stubClipboard();

    await user.click(screen.getByRole('button', { name: 'Copy all' }));

    expect(writeText).toHaveBeenCalledWith(formatDraftForCopy(SECTIONS));
    expect(await screen.findByText('Copied')).toBeInTheDocument();
  });

  it('shows the copy failure message when the browser refuses', async () => {
    const user = userEvent.setup();
    renderDraft();
    await screen.findByRole('list', { name: 'Sections' });
    stubClipboard(vi.fn().mockRejectedValue(new Error('denied')));

    await user.click(within(sectionCard('Title')).getByRole('button', { name: 'Copy' }));

    expect(await within(sectionCard('Title')).findByRole('alert')).toHaveTextContent(
      'Copy failed. Select the text and copy it manually.',
    );
  });

  it('clears the Copied message after about 2 seconds', async () => {
    const user = userEvent.setup();
    renderDraft();
    await screen.findByRole('list', { name: 'Sections' });
    stubClipboard();

    await user.click(within(sectionCard('Title')).getByRole('button', { name: 'Copy' }));
    expect(await within(sectionCard('Title')).findByText('Copied')).toBeInTheDocument();

    await waitFor(
      () => expect(within(sectionCard('Title')).queryByText('Copied')).not.toBeInTheDocument(),
      { timeout: 3500 },
    );
  });
});

describe('DraftPage: route', () => {
  it('is mounted at /w/:workspaceId/drafts/:draftId', async () => {
    const { router } = renderDraft();
    await screen.findByRole('list', { name: 'Sections' });
    expect(router.state.location.pathname).toBe(DRAFT_PATH);
  });
});
