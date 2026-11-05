import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import type { Workspace } from '@creatorops/contracts';

import { createFakeApi, WORKSPACE } from '../../test/fakeApi.js';
import {
  createContentFetch,
  createFakeContentApi,
  makeCampaign,
} from '../../test/fakeContentApi.js';
import { renderWeb } from '../../test/renderWeb.js';

const PATH = `/w/${WORKSPACE.id}/campaigns/camp_1`;
const CAMPAIGN = makeCampaign({ id: 'camp_1', name: 'Coffee', productId: 'prod_1' });

function setup(
  options: {
    role?: Workspace['role'];
    aiCost?: { calls: number; costUsd: number; anomalies?: number };
    thbPerUsd?: number;
  } = {},
) {
  const content = createFakeContentApi({
    campaigns: [CAMPAIGN],
    ...(options.aiCost === undefined ? {} : { aiCost: { camp_1: options.aiCost } }),
    ...(options.thbPerUsd === undefined ? {} : { thbPerUsd: options.thbPerUsd }),
  });
  const api = createFakeApi({
    workspaces: [{ ...WORKSPACE, role: options.role ?? 'owner' }],
    intercept: content.intercept,
  });
  const wire = createContentFetch(api.fetch);
  const view = renderWeb(PATH, { ...api, fetch: wire.fetch });
  return { ...view, content };
}

const section = async () => within(await screen.findByRole('region', { name: 'Cost' }));

describe('campaign cost panel', () => {
  it('shows AI text cost in baht with the calls and billed dollars, and the total', async () => {
    setup({ aiCost: { calls: 2, costUsd: 0.16 }, thbPerUsd: 0.3333 });
    const cost = await section();
    expect(await cost.findByLabelText('AI text cost')).toHaveTextContent('฿0.05');
    expect(cost.getByText('2 calls, $0.1600 billed')).toBeInTheDocument();
    expect(cost.getByLabelText('Typed-in cost')).toHaveTextContent('฿0.00');
    expect(cost.getByLabelText('Total cost')).toHaveTextContent('฿0.05');
    expect(cost.getByText(/set in Settings/)).toBeInTheDocument();
  });

  it('says when the default rate is used, and that no calls were made', async () => {
    setup();
    const cost = await section();
    expect(await cost.findByText('No AI calls yet')).toBeInTheDocument();
    expect(cost.getByText(/default ฿35 per 1 USD/)).toBeInTheDocument();
  });

  it('warns when a call cost far more than the entered prices predict', async () => {
    setup({ aiCost: { calls: 1, costUsd: 3, anomalies: 1 } });
    const cost = await section();
    expect(await cost.findByRole('alert')).toHaveTextContent(/1 AI call\(s\) cost far more/);
  });

  it('adds a typed-in cost to the total and removes it again', async () => {
    const user = userEvent.setup();
    setup({ aiCost: { calls: 1, costUsd: 0.1 }, thbPerUsd: 35 });
    const cost = await section();
    await cost.findByLabelText('AI text cost');
    await user.type(cost.getByLabelText('What for'), 'ภาพ Meta AI ฉากที่ 2');
    await user.selectOptions(cost.getByLabelText('Scene'), 'detail');
    await user.type(cost.getByLabelText('Amount (baht)'), '12.50');
    await user.click(cost.getByRole('button', { name: 'Add cost' }));

    const list = await cost.findByRole('list', { name: 'Typed-in costs' });
    expect(within(list).getByText('ภาพ Meta AI ฉากที่ 2')).toBeInTheDocument();
    expect(within(list).getByText('Detail')).toBeInTheDocument();
    expect(within(list).getByText('฿12.50')).toBeInTheDocument();
    await waitFor(() => expect(cost.getByLabelText('Total cost')).toHaveTextContent('฿16.00'));
    // The form is empty again.
    expect(cost.getByLabelText('What for')).toHaveValue('');
    expect(cost.getByLabelText('Amount (baht)')).toHaveValue('');

    await user.click(cost.getByRole('button', { name: 'Remove cost ภาพ Meta AI ฉากที่ 2' }));
    await waitFor(() => expect(cost.getByLabelText('Total cost')).toHaveTextContent('฿3.50'));
    expect(cost.getByText('No typed-in costs yet.')).toBeInTheDocument();
  });

  it('shows field errors and sends nothing for a bad label or amount', async () => {
    const user = userEvent.setup();
    const { content } = setup();
    const cost = await section();
    await cost.findByLabelText('AI text cost');
    await user.click(cost.getByRole('button', { name: 'Add cost' }));
    expect(await cost.findByText('Say what the cost was for.')).toBeInTheDocument();
    expect(cost.getByText('Enter an amount in baht such as 25 or 12.50.')).toBeInTheDocument();
    await user.type(cost.getByLabelText('What for'), 'x');
    await user.type(cost.getByLabelText('Amount (baht)'), '1.234');
    await user.click(cost.getByRole('button', { name: 'Add cost' }));
    expect(
      await cost.findByText('Enter an amount in baht such as 25 or 12.50.'),
    ).toBeInTheDocument();
    expect(content.manualCosts.get('camp_1') ?? []).toHaveLength(0);
  });

  it('hides the add form and the remove buttons from a viewer, who still sees the numbers', async () => {
    const { content } = setup({ role: 'viewer', aiCost: { calls: 1, costUsd: 0.1 } });
    content.manualCosts.set('camp_1', [
      {
        id: 'cost_9',
        campaignId: 'camp_1',
        scene: null,
        label: 'Freelancer',
        amountThb: 100,
        createdAt: '',
      },
    ]);
    const cost = await section();
    expect(await cost.findByText('Freelancer')).toBeInTheDocument();
    expect(cost.getByLabelText('Total cost')).toHaveTextContent('฿103.50');
    expect(cost.queryByRole('button', { name: 'Add cost' })).toBeNull();
    expect(cost.queryByRole('button', { name: /Remove cost/ })).toBeNull();
  });
});
