import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import type { Job } from '@creatorops/contracts';

import { json } from '../../test/fakeApi.js';
import { makeJob } from '../../test/fakeContentApi.js';
import { DRAFT_ID, makeScreenDraft, renderDraft, WS } from './draftScreenTestSetup.js';
import { finalVideoText } from './FinalVideo.js';

const API = `/api/v1/workspaces/${WS}`;
const OUTPUT = {
  draftId: DRAFT_ID,
  assetId: 'a-final',
  durationMs: 24000,
  clipCount: 3,
  subtitles: true,
  skippedScenes: ['usage'],
  srt: '1\n00:00:00,000 --> 00:00:08,000\nแนะนำ\n',
};

describe('finalVideoText', () => {
  const job = (over: Partial<Job>) => makeJob({ id: 'j', type: 'assemble_video', ...over });
  it('says where the video is, what was left out, and when there are no subtitles', () => {
    expect(finalVideoText(job({ status: 'succeeded', output: OUTPUT }))).toBe(
      'The final video is ready (3 scenes, 24 s). It is in the files above; press Export ZIP package again to put it in a package. Left out (no video yet): Usage.',
    );
    expect(
      finalVideoText(
        job({ status: 'succeeded', output: { ...OUTPUT, subtitles: false, skippedScenes: [] } }),
      ),
    ).toContain('It has no subtitles');
    expect(
      finalVideoText(
        job({
          status: 'succeeded',
          output: { ...OUTPUT, subtitles: false, subtitleIssue: 'no_subtitle_filter' },
        }),
      ),
    ).toContain('your ffmpeg cannot draw them. Copy the .srt below into CapCut');
  });
  it('shows the failure message from the job', () => {
    expect(
      finalVideoText(job({ status: 'failed', errorMessage: 'The final video needs ffmpeg.' })),
    ).toBe('The final video needs ffmpeg.');
  });
});

describe('Make final video', () => {
  it('starts the job once and shows the result with the subtitles to copy', async () => {
    const calls: { method: string; path: string }[] = [];
    renderDraft({
      role: 'owner',
      draft: makeScreenDraft({ version: 1 }),
      extra: (call) => {
        const path = call.path.split('?')[0] ?? '';
        if (path === `${API}/drafts/${DRAFT_ID}/assets`) return json({ items: [] });
        if (path === `${API}/exports`) return json({ items: [], nextCursor: null });
        if (path === `${API}/jobs` && call.method === 'GET')
          return json({ items: [], nextCursor: null });
        if (path === `${API}/jobs/assemble-video` && call.method === 'POST') {
          calls.push({ method: call.method, path });
          return json(makeJob({ id: 'job_v', type: 'assemble_video', status: 'queued' }), 202);
        }
        if (path === `${API}/jobs/job_v`) {
          return json(
            makeJob({ id: 'job_v', type: 'assemble_video', status: 'succeeded', output: OUTPUT }),
          );
        }
        return undefined;
      },
    });
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Make final video' }));
    expect(
      await screen.findByText(/The final video is ready \(3 scenes, 24 s\)/),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copy subtitles (.srt)' })).toBeInTheDocument();
    expect(calls).toHaveLength(1);
  });

  it('is not offered to a viewer', async () => {
    renderDraft({
      role: 'viewer',
      draft: makeScreenDraft({ version: 1 }),
      extra: (call) => {
        const path = call.path.split('?')[0] ?? '';
        if (path === `${API}/drafts/${DRAFT_ID}/assets`) return json({ items: [] });
        if (path === `${API}/exports`) return json({ items: [], nextCursor: null });
        if (path === `${API}/jobs`) return json({ items: [], nextCursor: null });
        return undefined;
      },
    });
    await screen.findByRole('heading', { name: 'Results and export' });
    expect(screen.queryByRole('button', { name: 'Make final video' })).not.toBeInTheDocument();
  });
});
