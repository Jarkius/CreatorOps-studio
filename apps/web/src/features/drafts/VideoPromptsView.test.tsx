import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { json } from '../../test/fakeApi.js';
import { makeJob } from '../../test/fakeContentApi.js';
import { DRAFT_ID, makeScreenDraft, renderDraft, WS } from './draftScreenTestSetup.js';

const SCENES = ['product_hero', 'detail', 'usage', 'final_shot'] as const;

function setup(output: unknown, version = 1) {
  return renderDraft({
    role: 'owner',
    draft: makeScreenDraft({ version }),
    extra: (call) => {
      const path = call.path.split('?')[0] ?? '';
      if (path === `/api/v1/workspaces/${WS}/jobs` && call.method === 'GET') {
        const items =
          output === null
            ? []
            : [
                makeJob({
                  id: 'job_vp',
                  type: 'generate_video_prompts',
                  status: 'succeeded',
                  draftId: DRAFT_ID,
                  output: output as never,
                }),
              ];
        return json({ items, nextCursor: null });
      }
      return undefined;
    },
  });
}

const output = (draftVersion: number) => ({
  draftId: DRAFT_ID,
  draftVersion,
  model: 'mock',
  scenes: SCENES.map((scene) => ({
    scene,
    prompt: `Prompt for ${scene}`,
    voiceover: `Voice for ${scene}`,
  })),
});

describe('VideoPromptsView', () => {
  it('shows the four saved prompts with voiceovers', async () => {
    setup(output(1));
    expect(await screen.findByText('Prompt for product_hero')).toBeInTheDocument();
    expect(screen.getByText('Voiceover: Voice for final_shot')).toBeInTheDocument();
    expect(screen.queryByText(/earlier version/)).not.toBeInTheDocument();
  });

  it('says when the prompts were written for an older draft version', async () => {
    setup(output(1), 3);
    expect(await screen.findByText(/earlier version of this draft/)).toBeInTheDocument();
  });

  it('shows how to make them when there are none', async () => {
    setup(null);
    expect(await screen.findByText(/No video prompts yet/)).toBeInTheDocument();
  });
});
