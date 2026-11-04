import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import type { ContentFakeApi } from '../../test/fakeContentApi.js';
import { DRAFT_ID, renderDraft, SECTIONS, sectionCard } from './draftScreenTestSetup.js';

const NEW_HOOK = 'ร้อนมาก ต้องมีพัดลมที่ น้ำหนักเบา';
const CONFLICT_TEXT = 'This draft was changed by someone else, or by a regeneration.';

async function openEditor(user: ReturnType<typeof userEvent.setup>, label: string) {
  await user.click(within(sectionCard(label)).getByRole('button', { name: 'Edit' }));
}

function patches(api: { calls: { method: string; body: unknown }[] }) {
  return api.calls.filter((call) => call.method === 'PATCH');
}

describe('DraftPage: saving one section', () => {
  it('sends only the changed section with the version on screen, then shows Saved', async () => {
    const user = userEvent.setup();
    const { api, draft } = renderDraft();
    await screen.findByRole('list', { name: 'Sections' });
    const version = draft.version;

    await openEditor(user, 'Hook');
    fireEvent.change(screen.getByRole('textbox', { name: 'Hook' }), {
      target: { value: NEW_HOOK },
    });
    await user.click(within(sectionCard('Hook')).getByRole('button', { name: 'Save' }));

    expect(await within(sectionCard('Hook')).findByRole('status')).toHaveTextContent('Saved');
    expect(patches(api)).toHaveLength(1);
    expect(patches(api)[0]?.body).toEqual({ version, sections: { hook: NEW_HOOK } });
    expect(within(sectionCard('Hook')).getByText(NEW_HOOK)).toBeInTheDocument();
    expect(
      within(sectionCard('Hook')).queryByRole('textbox', { name: 'Hook' }),
    ).not.toBeInTheDocument();
  });

  it('sends no request and closes the editor when the text is unchanged (spaces are trimmed)', async () => {
    const user = userEvent.setup();
    const { api } = renderDraft();
    await screen.findByRole('list', { name: 'Sections' });

    await openEditor(user, 'Hook');
    fireEvent.change(screen.getByRole('textbox', { name: 'Hook' }), {
      target: { value: `  ${SECTIONS.hook}  ` },
    });
    await user.click(within(sectionCard('Hook')).getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(
        within(sectionCard('Hook')).queryByRole('textbox', { name: 'Hook' }),
      ).not.toBeInTheDocument(),
    );
    expect(patches(api)).toHaveLength(0);
  });

  it('disables Save while the request is in flight', async () => {
    const user = userEvent.setup();
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    renderDraft({ gate });
    await screen.findByRole('list', { name: 'Sections' });

    await openEditor(user, 'Hook');
    fireEvent.change(screen.getByRole('textbox', { name: 'Hook' }), {
      target: { value: NEW_HOOK },
    });
    await user.click(within(sectionCard('Hook')).getByRole('button', { name: 'Save' }));

    expect(
      await within(sectionCard('Hook')).findByRole('button', { name: 'Saving…' }),
    ).toBeDisabled();
    release();
    expect(await within(sectionCard('Hook')).findByRole('status')).toHaveTextContent('Saved');
  });

  it('keeps the Cancel path free of requests', async () => {
    const user = userEvent.setup();
    const { api } = renderDraft();
    await screen.findByRole('list', { name: 'Sections' });

    await openEditor(user, 'Hook');
    fireEvent.change(screen.getByRole('textbox', { name: 'Hook' }), {
      target: { value: NEW_HOOK },
    });
    await user.click(within(sectionCard('Hook')).getByRole('button', { name: 'Cancel' }));

    expect(within(sectionCard('Hook')).getByText(SECTIONS.hook)).toBeInTheDocument();
    expect(patches(api)).toHaveLength(0);
  });
});

describe('DraftPage: validation messages', () => {
  it('refuses an empty title and sends nothing', async () => {
    const user = userEvent.setup();
    const { api } = renderDraft();
    await screen.findByRole('list', { name: 'Sections' });

    await openEditor(user, 'Title');
    fireEvent.change(screen.getByRole('textbox', { name: 'Title' }), { target: { value: '   ' } });
    await user.click(within(sectionCard('Title')).getByRole('button', { name: 'Save' }));

    expect(within(sectionCard('Title')).getByText('Cannot be empty')).toBeInTheDocument();
    expect(patches(api)).toHaveLength(0);
  });

  it('refuses a title longer than 100 characters', async () => {
    const user = userEvent.setup();
    renderDraft();
    await screen.findByRole('list', { name: 'Sections' });

    await openEditor(user, 'Title');
    fireEvent.change(screen.getByRole('textbox', { name: 'Title' }), {
      target: { value: 'ก'.repeat(101) },
    });
    await user.click(within(sectionCard('Title')).getByRole('button', { name: 'Save' }));

    expect(within(sectionCard('Title')).getByText('Too long (max 100)')).toBeInTheDocument();
  });

  it('refuses more than 12 scenes', async () => {
    const user = userEvent.setup();
    const { api } = renderDraft();
    await screen.findByRole('list', { name: 'Sections' });

    await openEditor(user, 'Storyboard');
    const thirteen = Array.from({ length: 13 }, (_, index) => `ฉาก ${index + 1}`).join('\n');
    fireEvent.change(screen.getByRole('textbox', { name: 'Storyboard, one scene per line' }), {
      target: { value: thirteen },
    });
    await user.click(within(sectionCard('Storyboard')).getByRole('button', { name: 'Save' }));

    expect(
      within(sectionCard('Storyboard')).getByText('Too many scenes (max 12)'),
    ).toBeInTheDocument();
    expect(patches(api)).toHaveLength(0);
  });

  it('sends only the non-blank scenes of a storyboard (blank lines are not scenes)', async () => {
    const user = userEvent.setup();
    const { api, draft } = renderDraft();
    await screen.findByRole('list', { name: 'Sections' });
    const version = draft.version;

    await openEditor(user, 'Storyboard');
    fireEvent.change(screen.getByRole('textbox', { name: 'Storyboard, one scene per line' }), {
      target: { value: '\nฉาก A เปิดตัว\n\n   \nฉาก B ปิดการขาย\n' },
    });
    await user.click(within(sectionCard('Storyboard')).getByRole('button', { name: 'Save' }));

    await within(sectionCard('Storyboard')).findByRole('status');
    expect(patches(api)[0]?.body).toEqual({
      version,
      sections: { storyboard: ['ฉาก A เปิดตัว', 'ฉาก B ปิดการขาย'] },
    });
  });

  it('adds the # to hashtags that have none and splits on spaces and commas', async () => {
    const user = userEvent.setup();
    const { api, draft } = renderDraft();
    await screen.findByRole('list', { name: 'Sections' });
    const version = draft.version;

    await openEditor(user, 'Hashtags');
    fireEvent.change(
      screen.getByRole('textbox', { name: 'Hashtags, separated by spaces or commas' }),
      {
        target: { value: 'พัดลม, DeskFan  #ลม' },
      },
    );
    await user.click(within(sectionCard('Hashtags')).getByRole('button', { name: 'Save' }));

    await within(sectionCard('Hashtags')).findByRole('status');
    expect(patches(api)[0]?.body).toEqual({
      version,
      sections: { hashtags: ['#พัดลม', '#DeskFan', '#ลม'] },
    });
  });
});

describe('DraftPage: save conflict', () => {
  /** Another editor saves the title first, so the version on screen is stale. */
  async function conflictingSave(
    user: ReturnType<typeof userEvent.setup>,
    content: ContentFakeApi,
  ) {
    content.editElsewhere(DRAFT_ID, 'title', 'ชื่อจากคนอื่น');
    await openEditor(user, 'Hook');
    fireEvent.change(screen.getByRole('textbox', { name: 'Hook' }), {
      target: { value: NEW_HOOK },
    });
    await user.click(within(sectionCard('Hook')).getByRole('button', { name: 'Save' }));
    return within(sectionCard('Hook')).findByRole('alert');
  }

  it('shows the conflict panel with both recovery buttons and keeps the typed text', async () => {
    const user = userEvent.setup();
    const { content } = renderDraft();
    await screen.findByRole('list', { name: 'Sections' });

    const panel = await conflictingSave(user, content);

    expect(panel).toHaveTextContent(CONFLICT_TEXT);
    expect(
      within(panel).getByRole('button', { name: 'Reload and discard my change' }),
    ).toBeEnabled();
    expect(within(panel).getByRole('button', { name: 'Keep my text and reload' })).toBeEnabled();
    expect(screen.getByRole('textbox', { name: 'Hook' })).toHaveValue(NEW_HOOK);
  });

  it('Reload and discard my change closes the editor and shows the saved text', async () => {
    const user = userEvent.setup();
    const { content, api } = renderDraft();
    await screen.findByRole('list', { name: 'Sections' });
    const panel = await conflictingSave(user, content);

    await user.click(within(panel).getByRole('button', { name: 'Reload and discard my change' }));

    await waitFor(() =>
      expect(
        within(sectionCard('Hook')).queryByRole('textbox', { name: 'Hook' }),
      ).not.toBeInTheDocument(),
    );
    expect(within(sectionCard('Hook')).getByText(SECTIONS.hook)).toBeInTheDocument();
    expect(api.calls.filter((call) => call.method === 'PATCH')).toHaveLength(1);
  });

  it('Keep my text and reload keeps the typed text and the next Save uses the new version', async () => {
    const user = userEvent.setup();
    const { content, api } = renderDraft();
    await screen.findByRole('list', { name: 'Sections' });
    const panel = await conflictingSave(user, content);

    await user.click(within(panel).getByRole('button', { name: 'Keep my text and reload' }));

    await waitFor(() =>
      expect(within(sectionCard('Hook')).queryByText(CONFLICT_TEXT)).not.toBeInTheDocument(),
    );
    expect(screen.getByRole('textbox', { name: 'Hook' })).toHaveValue(NEW_HOOK);

    await user.click(within(sectionCard('Hook')).getByRole('button', { name: 'Save' }));

    await within(sectionCard('Hook')).findByRole('status');
    const sent = api.calls.filter((call) => call.method === 'PATCH');
    expect(sent).toHaveLength(2);
    expect(sent[1]?.body).toEqual({ version: 2, sections: { hook: NEW_HOOK } });
  });
});
