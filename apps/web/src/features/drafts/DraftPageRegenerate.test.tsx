import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import {
  DRAFT_ID,
  makeScreenDraft,
  renderDraft,
  sectionCard,
  SECTIONS,
} from './draftScreenTestSetup.js';
import { REGENERATE_CONFLICT_MESSAGE, SECTION_CHANGED_MESSAGE } from './SectionCard.js';

const KEY_FORMAT = /^ui-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const DEFAULT_SCRIPT = 'ข้อความใหม่ script';

/** A draft whose script section is at revision 3, so a constant expectedRev would be wrong. */
function draftAtRevision3() {
  const draft = makeScreenDraft();
  draft.sectionState.script = { rev: 3, origin: 'generated', jobId: null };
  return draft;
}

async function regenerate(user: ReturnType<typeof userEvent.setup>, label: string) {
  await user.click(within(sectionCard(label)).getByRole('button', { name: 'Regenerate' }));
}

describe('DraftPage: regenerate a section', () => {
  it('sends the section, the revision on screen as expectedRev, and an Idempotency-Key', async () => {
    const user = userEvent.setup();
    const { keys, api } = renderDraft({ draft: draftAtRevision3() });
    await screen.findByRole('list', { name: 'Sections' });

    await regenerate(user, 'Script');

    await within(sectionCard('Script')).findByText('Waiting to start');
    const post = api.calls.find((call) => call.method === 'POST');
    expect(post?.path).toBe('/api/v1/workspaces/ws_1/jobs/regenerate-section');
    expect(post?.body).toEqual({ draftId: DRAFT_ID, section: 'script', expectedRev: 3 });
    const record = keys.find((item) => item.path.endsWith('/jobs/regenerate-section'));
    expect(record?.key).toMatch(KEY_FORMAT);
  });

  it('shows the job inside the card and disables only that section while it runs', async () => {
    const user = userEvent.setup();
    const { content } = renderDraft();
    await screen.findByRole('list', { name: 'Sections' });

    await regenerate(user, 'Hook');
    await within(sectionCard('Hook')).findByText('Waiting to start');
    expect(within(sectionCard('Hook')).getByRole('button', { name: 'Edit' })).toBeDisabled();
    expect(within(sectionCard('Hook')).getByRole('button', { name: 'Regenerate' })).toBeDisabled();

    content.advanceJob(content.jobs[0]?.id ?? 'job_1', 'running', { attempts: 1 });
    expect(
      await within(sectionCard('Hook')).findByText(/Writing your content/, undefined, {
        timeout: 4000,
      }),
    ).toBeInTheDocument();
    expect(within(sectionCard('Hook')).getByRole('button', { name: 'Edit' })).toBeDisabled();

    // Other sections stay usable.
    expect(within(sectionCard('Title')).getByRole('button', { name: 'Edit' })).toBeEnabled();
    expect(within(sectionCard('Title')).getByRole('button', { name: 'Regenerate' })).toBeEnabled();
    expect(within(sectionCard('Script')).getByRole('button', { name: 'Edit' })).toBeEnabled();
  });

  it('refreshes the draft when the job succeeds and shows the new text, revision and origin', async () => {
    const user = userEvent.setup();
    const { content } = renderDraft({ draft: draftAtRevision3() });
    await screen.findByRole('list', { name: 'Sections' });

    await regenerate(user, 'Script');
    await within(sectionCard('Script')).findByText('Waiting to start');
    content.advanceJob(content.jobs[0]?.id ?? 'job_1', 'succeeded');

    expect(
      await within(sectionCard('Script')).findByText('Section regenerated', undefined, {
        timeout: 4000,
      }),
    ).toBeInTheDocument();
    expect(within(sectionCard('Script')).getByText(DEFAULT_SCRIPT)).toBeInTheDocument();
    expect(within(sectionCard('Script')).getByText('revision 4')).toBeInTheDocument();
    expect(within(sectionCard('Script')).getByText('AI generated')).toBeInTheDocument();
    expect(within(sectionCard('Script')).getByRole('button', { name: 'Edit' })).toBeEnabled();
  });

  it('a SECTION_CHANGED failure says the edit was kept and reloads the draft', async () => {
    const user = userEvent.setup();
    const { content } = renderDraft();
    await screen.findByRole('list', { name: 'Sections' });

    await regenerate(user, 'Hook');
    await within(sectionCard('Hook')).findByText('Waiting to start');
    // Another editor saves the hook while the job runs; the job then loses.
    content.editElsewhere(DRAFT_ID, 'hook', 'แก้ไขโดยผู้อื่น ที่ น้ำหนักเบา');
    content.advanceJob(content.jobs[0]?.id ?? 'job_1', 'failed', {
      errorCode: 'SECTION_CHANGED',
      errorMessage: 'The section changed while the job ran.',
      attempts: 1,
    });

    expect(
      await within(sectionCard('Hook')).findByText(SECTION_CHANGED_MESSAGE, undefined, {
        timeout: 4000,
      }),
    ).toBeInTheDocument();
    expect(
      within(sectionCard('Hook')).getByText('แก้ไขโดยผู้อื่น ที่ น้ำหนักเบา'),
    ).toBeInTheDocument();
    expect(within(sectionCard('Hook')).getByText('Edited')).toBeInTheDocument();
    expect(within(sectionCard('Hook')).getByRole('button', { name: 'Regenerate' })).toBeEnabled();
    expect(SECTIONS.hook).not.toBe('แก้ไขโดยผู้อื่น ที่ น้ำหนักเบา');
  });

  it('a CONFLICT when the job is created says the section changed and reloads the draft', async () => {
    const user = userEvent.setup();
    const { content } = renderDraft();
    await screen.findByRole('list', { name: 'Sections' });

    // The screen still holds revision 1; the server moves to revision 2 before the click.
    content.editElsewhere(DRAFT_ID, 'script', 'ข้อความจากคนอื่น ที่ น้ำหนัก');
    await regenerate(user, 'Script');

    expect(await within(sectionCard('Script')).findByRole('alert')).toHaveTextContent(
      REGENERATE_CONFLICT_MESSAGE,
    );
    await waitFor(() =>
      expect(
        within(sectionCard('Script')).getByText('ข้อความจากคนอื่น ที่ น้ำหนัก'),
      ).toBeInTheDocument(),
    );
    expect(within(sectionCard('Script')).getByText('revision 2')).toBeInTheDocument();
    expect(content.jobs).toHaveLength(0);
  });

  it('shows any other error in an alert with its message', async () => {
    const user = userEvent.setup();
    renderDraft({ failRegenerate: true });
    await screen.findByRole('list', { name: 'Sections' });

    await regenerate(user, 'Caption');

    expect(await within(sectionCard('Caption')).findByRole('alert')).toHaveTextContent(
      'Regenerate is down.',
    );
  });
});
