import { act, fireEvent, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { createFakeApi, json, SECOND_WORKSPACE, WORKSPACE } from '../../test/fakeApi.js';
import { createFakeContentApi, makeCampaign } from '../../test/fakeContentApi.js';
import { renderWeb } from '../../test/renderWeb.js';

const LIST_PATH = `/w/${WORKSPACE.id}/campaigns`;
const THAI_CAMPAIGN = 'แคมเปญพัดลมตั้งโต๊ะ น้ำหนักเบา';

describe('CampaignsPage', () => {
  it('shows a loading state, then rows with name, status and updated date', async () => {
    const content = createFakeContentApi({
      campaigns: [
        makeCampaign({ id: 'camp_1', name: THAI_CAMPAIGN, status: 'active' }),
        makeCampaign({ id: 'camp_2', name: 'Summer Sale ลดราคา', status: 'archived' }),
      ],
    });
    renderWeb(LIST_PATH, createFakeApi({ intercept: content.intercept }));

    expect(screen.getByRole('status')).toHaveTextContent('Loading campaigns…');
    const list = await screen.findByRole('list', { name: 'Campaigns' });
    expect(within(list).getByRole('link', { name: THAI_CAMPAIGN })).toHaveAttribute(
      'href',
      `${LIST_PATH}/camp_1`,
    );
    expect(within(list).getByText('Active')).toBeInTheDocument();
    expect(within(list).getByText('Archived')).toBeInTheDocument();
    expect(within(list).getAllByText(/^Updated /)).toHaveLength(2);
  });

  it('shows the empty state with a create link for a writer', async () => {
    renderWeb(LIST_PATH, createFakeApi({ intercept: createFakeContentApi().intercept }));

    expect(await screen.findByRole('heading', { name: 'No campaigns yet' })).toBeInTheDocument();
    const links = screen.getAllByRole('link', { name: 'Create campaign' });
    expect(links[0]).toHaveAttribute('href', `${LIST_PATH}/new`);
  });

  it('hides the create link from a viewer', async () => {
    const api = createFakeApi({
      workspaces: [{ ...WORKSPACE, role: 'viewer' }],
      intercept: createFakeContentApi().intercept,
    });
    renderWeb(LIST_PATH, api);

    expect(await screen.findByRole('heading', { name: 'No campaigns yet' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Create campaign' })).not.toBeInTheDocument();
  });

  it('shows an error with the request reference, and Try again refetches', async () => {
    let failures = 1;
    const content = createFakeContentApi({
      campaigns: [makeCampaign({ id: 'camp_1', name: 'Recovered campaign' })],
    });
    const api = createFakeApi({
      intercept: async (call) => {
        if (
          call.method === 'GET' &&
          call.path.startsWith(`${LIST_PATH.replace('/w/', '/api/v1/workspaces/')}`) &&
          failures > 0
        ) {
          failures -= 1;
          return json(
            { error: { code: 'INTERNAL_ERROR', message: 'Boom.', requestId: 'req-list' } },
            500,
          );
        }
        return content.intercept(call);
      },
    });
    renderWeb(LIST_PATH, api);

    const alert = await screen.findByRole('alert');
    expect(within(alert).getByText('Boom.')).toBeInTheDocument();
    expect(within(alert).getByText('Reference: req-list')).toBeInTheDocument();

    fireEvent.click(within(alert).getByRole('button', { name: 'Try again' }));

    expect(await screen.findByRole('link', { name: 'Recovered campaign' })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('loads the next page with Load more until nextCursor is null', async () => {
    const campaigns = ['Alpha', 'Bravo', 'Charlie'].map((name, index) =>
      makeCampaign({ id: `camp_${index}`, name: `${name} campaign` }),
    );
    renderWeb(
      LIST_PATH,
      createFakeApi({ intercept: createFakeContentApi({ campaigns, pageSize: 2 }).intercept }),
    );

    expect(await screen.findByRole('link', { name: 'Bravo campaign' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Charlie campaign' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Load more' }));

    expect(await screen.findByRole('link', { name: 'Charlie campaign' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument();
  });

  it('shows Workspace not found for an unknown workspace', async () => {
    const api = createFakeApi({
      intercept: () =>
        json(
          { error: { code: 'NOT_FOUND', message: 'Workspace not found.', requestId: 'r' } },
          404,
        ),
    });
    renderWeb(LIST_PATH, api);

    expect(await screen.findByRole('heading', { name: 'Workspace not found' })).toBeInTheDocument();
  });

  it('does not show another workspace campaigns from the cache (ws_1 then ws_2)', async () => {
    const content = createFakeContentApi({
      campaigns: [
        makeCampaign({ id: 'camp_a', workspaceId: WORKSPACE.id, name: 'Alpha campaign' }),
        makeCampaign({ id: 'camp_b', workspaceId: SECOND_WORKSPACE.id, name: 'Beta campaign' }),
      ],
    });
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const api = createFakeApi({
      workspaces: [WORKSPACE, SECOND_WORKSPACE],
      intercept: async (call) => {
        if (
          call.method === 'GET' &&
          call.path.startsWith(`/api/v1/workspaces/${SECOND_WORKSPACE.id}/campaigns`)
        ) {
          await gate;
        }
        return content.intercept(call);
      },
    });
    const { router } = renderWeb(LIST_PATH, api);
    expect(await screen.findByRole('link', { name: 'Alpha campaign' })).toBeInTheDocument();

    await act(async () => {
      await router.navigate(`/w/${SECOND_WORKSPACE.id}/campaigns`);
    });

    // The second workspace's list is still pending, so nothing from the first may be on screen.
    expect(screen.queryByRole('link', { name: 'Alpha campaign' })).not.toBeInTheDocument();

    await act(async () => {
      release();
    });
    expect(await screen.findByRole('link', { name: 'Beta campaign' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Alpha campaign' })).not.toBeInTheDocument();
  });
});
