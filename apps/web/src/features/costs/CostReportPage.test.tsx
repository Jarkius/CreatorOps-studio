import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { createFakeApi, WORKSPACE } from '../../test/fakeApi.js';
import {
  createContentFetch,
  createFakeContentApi,
  makeCampaign,
} from '../../test/fakeContentApi.js';
import { renderWeb } from '../../test/renderWeb.js';

const PATH = `/w/${WORKSPACE.id}/costs`;

function setup(options: { withCosts?: boolean; truncated?: boolean } = {}) {
  const content = createFakeContentApi({
    campaigns: [
      makeCampaign({ id: 'camp_1', name: 'Coffee launch' }),
      makeCampaign({ id: 'camp_2', name: 'Tea sale' }),
      makeCampaign({ id: 'camp_3', name: 'No cost yet' }),
    ],
    ...(options.withCosts === false
      ? {}
      : {
          aiCost: {
            camp_1: { calls: 3, costUsd: 0.1 },
            camp_2: { calls: 1, costUsd: 1 },
          },
        }),
    thbPerUsd: 35,
    ...(options.truncated === true ? { reportTruncated: true } : {}),
  });
  if (options.withCosts !== false) {
    content.manualCosts.set('camp_1', [
      { id: 'm1', campaignId: 'camp_1', scene: null, label: 'Tool', amountThb: 40, createdAt: '' },
    ]);
  }
  const api = createFakeApi({ workspaces: [WORKSPACE], intercept: content.intercept });
  const wire = createContentFetch(api.fetch);
  const view = renderWeb(PATH, { ...api, fetch: wire.fetch });
  return { ...view, content };
}

describe('cost report page', () => {
  it('lists campaigns with costs, largest first, with totals and US dollars beside baht', async () => {
    setup();
    const region = within(await screen.findByRole('region', { name: 'Cost report' }));
    const table = await region.findByRole('table');
    const rows = within(table).getAllByRole('row').slice(1);
    // Coffee: 0.1 x 35 = 3.50 + 40 = 43.50. Tea: 1 x 35 = 35. Largest first; the free one is left out.
    expect(rows).toHaveLength(2);
    expect(within(rows[0]!).getByRole('link', { name: 'Coffee launch' })).toHaveAttribute(
      'href',
      `/w/${WORKSPACE.id}/campaigns/camp_1`,
    );
    expect(rows[0]).toHaveTextContent('฿43.50 ≈ $1.24');
    expect(rows[1]).toHaveTextContent('Tea sale');
    expect(rows[1]).toHaveTextContent('฿35.00 ≈ $1.00');
    expect(screen.queryByText('No cost yet')).toBeNull();
    expect(region.getByLabelText('Month total')).toHaveTextContent('฿78.50 ≈ $2.24');
    expect(region.getByLabelText('AI text total')).toHaveTextContent('฿38.50');
    expect(region.getByLabelText('Typed-in total')).toHaveTextContent('฿40.00');
    expect(region.getByText(/AI text \(4 calls\)/)).toBeInTheDocument();
    expect(region.getByText(/US\$ is baht ÷ ฿35/)).toBeInTheDocument();
  });

  it('says when the list was cut at 100 campaigns and that the totals include all', async () => {
    setup({ truncated: true });
    expect(
      await screen.findByText(
        'Showing the 100 most expensive campaigns. The totals include all of them.',
      ),
    ).toBeInTheDocument();
  });

  it('does not show the cut note when nothing was cut', async () => {
    setup();
    await screen.findByRole('table');
    expect(screen.queryByText(/100 most expensive/)).toBeNull();
  });

  it('shows an empty state for a month without costs', async () => {
    setup({ withCosts: false });
    expect(await screen.findByText('No costs in 2026-11')).toBeInTheDocument();
  });

  it('asks for the picked month, and only for a valid one', async () => {
    const user = userEvent.setup();
    const { content } = setup();
    await screen.findByRole('table');
    expect(content.reportMonths).toEqual(['2026-11']); // the default month
    const box = screen.getByLabelText('Month');
    await user.type(box, '2026-1');
    expect(await screen.findByText('Pick a month, for example 2026-11.')).toBeInTheDocument();
    expect(content.reportMonths).toHaveLength(1); // nothing was sent for a half-typed month
    await user.type(box, '0');
    await waitFor(() => expect(content.reportMonths).toEqual(['2026-11', '2026-10']));
    expect(screen.queryByText('Pick a month, for example 2026-11.')).toBeNull();
    await user.clear(box);
    await waitFor(() => expect(content.reportMonths.at(-1)).toBe('2026-11'));
  });

  it('is in the main navigation', async () => {
    setup();
    const nav = await screen.findByRole('navigation', { name: 'Main' });
    expect(await within(nav).findByRole('link', { name: 'Costs' })).toHaveAttribute('href', PATH);
  });
});
