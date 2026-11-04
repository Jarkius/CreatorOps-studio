import {
  ApiError,
  type ApiClient,
  type Campaign,
  type Job,
  type Product,
  type Template,
} from '@creatorops/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { CreatePanel } from './CreatePanel.js';

const DASHBOARD = 'http://dash.test';

const template = (id: string, en: string): Template => ({
  id,
  version: 2,
  name: { th: `ชื่อ ${id}`, en },
  description: { th: 'x', en: 'x' },
  defaultDurationSeconds: 30,
});
const TEMPLATES = [
  template('product-showcase', 'Product showcase'),
  template('review-style', 'Review style'),
];
const product = (id: string, name: string) => ({ id, name, status: 'active' }) as Product;
const campaign = (id: string) => ({ id }) as Campaign;
const job = (id: string) => ({ id, status: 'queued' }) as Job;

interface Fakes {
  products?: Product[];
  templates?: Template[];
  createCampaign?: ApiClient['campaigns']['create'];
  generateBrief?: ApiClient['jobs']['generateBrief'];
  canStart?: boolean;
}

function renderPanel(fakes: Fakes = {}) {
  const productsList = vi.fn(() =>
    Promise.resolve({
      items: fakes.products ?? [product('p1', 'พัดลม'), product('p2', 'Lamp')],
      nextCursor: null,
    }),
  );
  const templatesList = vi.fn(() => Promise.resolve({ items: fakes.templates ?? TEMPLATES }));
  const createCampaign = vi.fn(fakes.createCampaign ?? (() => Promise.resolve(campaign('c1'))));
  const generateBrief = vi.fn(fakes.generateBrief ?? (() => Promise.resolve(job('j1'))));
  const api = {
    products: { list: productsList },
    templates: { list: templatesList },
    campaigns: { create: createCampaign },
    jobs: { generateBrief },
  } as unknown as ApiClient;
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidate = vi.spyOn(client, 'invalidateQueries');
  render(
    <QueryClientProvider client={client}>
      <CreatePanel
        api={api}
        workspaceId="w1"
        dashboardUrl={DASHBOARD}
        canStart={fakes.canStart ?? true}
      />
    </QueryClientProvider>,
  );
  return { createCampaign, generateBrief, invalidate };
}

const section = () => screen.getByRole('region', { name: 'Create content' });
const button = () => within(section()).getByRole('button', { name: /Create content|Starting/ });

describe('CreatePanel', () => {
  it('shows the product list, the modes with the first one chosen, and the checklist', async () => {
    renderPanel();
    expect(await screen.findByRole('combobox', { name: 'Product' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /Product showcase/ })).toBeChecked();
    expect(screen.getByRole('radio', { name: /Review style/ })).not.toBeChecked();
    const steps = within(screen.getByRole('list', { name: 'What happens' })).getAllByRole(
      'listitem',
    );
    expect(steps).toHaveLength(3);
    expect(steps[0]).toHaveTextContent('Script, scenes and caption');
    expect(steps[1]).toHaveTextContent('(coming next)');
    expect(steps[2]).toHaveTextContent('(coming next)');
  });

  it('keeps the button disabled until a product is chosen', async () => {
    renderPanel();
    await screen.findByRole('combobox', { name: 'Product' });
    expect(button()).toBeDisabled();
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Product' }), 'p1');
    expect(button()).toBeEnabled();
  });

  it('creates the campaign with the picked product and mode, then starts the job with one key', async () => {
    const { createCampaign, generateBrief, invalidate } = renderPanel();
    await userEvent.selectOptions(await screen.findByRole('combobox', { name: 'Product' }), 'p1');
    await userEvent.click(screen.getByRole('radio', { name: /Review style/ }));
    await userEvent.click(button());

    await waitFor(() => expect(generateBrief).toHaveBeenCalledTimes(1));
    expect(createCampaign).toHaveBeenCalledTimes(1);
    expect(createCampaign.mock.calls[0]?.[1]).toEqual({
      productId: 'p1',
      templateId: 'review-style',
      templateVersion: 2,
      name: 'พัดลม · Review style',
      language: 'th',
      platform: 'tiktok',
      variants: 1,
    });
    expect(generateBrief.mock.calls[0]?.[1]).toEqual({ campaignId: 'c1' });
    expect(generateBrief.mock.calls[0]?.[2]).toMatch(/^ext-[0-9a-f-]{36}$/);
    expect(
      await screen.findByText(/Started\. Follow it under Campaigns below/),
    ).toBeInTheDocument();
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['panel', 'campaigns', 'w1'] });
  });

  it('retries the job for the same campaign and never creates a second campaign', async () => {
    const generateBrief = vi
      .fn<ApiClient['jobs']['generateBrief']>()
      .mockRejectedValueOnce(
        new ApiError({ code: 'RATE_LIMITED', message: 'Slow down.', status: 429 }),
      )
      .mockResolvedValueOnce(job('j1'));
    const { createCampaign } = renderPanel({ generateBrief });
    await userEvent.selectOptions(await screen.findByRole('combobox', { name: 'Product' }), 'p1');
    await userEvent.click(button());
    expect(await screen.findByText(/Slow down\./)).toBeInTheDocument();

    await userEvent.click(button());
    await waitFor(() => expect(generateBrief).toHaveBeenCalledTimes(2));
    expect(createCampaign).toHaveBeenCalledTimes(1);
    expect(generateBrief.mock.calls[1]?.[1]).toEqual({ campaignId: 'c1' });
    // An API error is not "no response", so the second try uses a new key.
    expect(generateBrief.mock.calls[1]?.[2]).not.toBe(generateBrief.mock.calls[0]?.[2]);
  });

  it('reuses the key after a network error, so a lost answer cannot start two jobs', async () => {
    const generateBrief = vi
      .fn<ApiClient['jobs']['generateBrief']>()
      .mockRejectedValueOnce(new ApiError({ code: 'NETWORK_ERROR', message: 'Offline.' }))
      .mockResolvedValueOnce(job('j1'));
    renderPanel({ generateBrief });
    await userEvent.selectOptions(await screen.findByRole('combobox', { name: 'Product' }), 'p1');
    await userEvent.click(button());
    expect(await screen.findByText('Offline.')).toBeInTheDocument();
    await userEvent.click(button());
    await waitFor(() => expect(generateBrief).toHaveBeenCalledTimes(2));
    expect(generateBrief.mock.calls[1]?.[2]).toBe(generateBrief.mock.calls[0]?.[2]);
  });

  it('creates a new campaign when another product is picked after a failed start', async () => {
    const generateBrief = vi
      .fn<ApiClient['jobs']['generateBrief']>()
      .mockRejectedValueOnce(
        new ApiError({ code: 'RATE_LIMITED', message: 'Slow down.', status: 429 }),
      )
      .mockResolvedValue(job('j1'));
    const createCampaign = vi
      .fn<ApiClient['campaigns']['create']>()
      .mockResolvedValueOnce(campaign('c1'))
      .mockResolvedValueOnce(campaign('c2'));
    renderPanel({ generateBrief, createCampaign });
    const select = await screen.findByRole('combobox', { name: 'Product' });
    await userEvent.selectOptions(select, 'p1');
    await userEvent.click(button());
    await screen.findByText(/Slow down\./);
    await userEvent.selectOptions(select, 'p2');
    await userEvent.click(button());
    await waitFor(() => expect(createCampaign).toHaveBeenCalledTimes(2));
    expect(generateBrief.mock.calls[1]?.[1]).toEqual({ campaignId: 'c2' });
  });

  it('shows a refused campaign with its request id and starts no job', async () => {
    const { generateBrief } = renderPanel({
      createCampaign: () =>
        Promise.reject(
          new ApiError({
            code: 'VALIDATION_ERROR',
            message: 'Name is too long.',
            status: 400,
            requestId: 'req-5',
          }),
        ),
    });
    await userEvent.selectOptions(await screen.findByRole('combobox', { name: 'Product' }), 'p1');
    await userEvent.click(button());
    expect(await screen.findByRole('alert')).toHaveTextContent('Name is too long. (request req-5)');
    expect(generateBrief).not.toHaveBeenCalled();
  });

  it('hides the button for a read-only member and says why', async () => {
    renderPanel({ canStart: false });
    await screen.findByRole('combobox', { name: 'Product' });
    expect(
      within(section()).queryByRole('button', { name: /Create content/ }),
    ).not.toBeInTheDocument();
    expect(screen.getByText(/Ask an owner or editor/)).toBeInTheDocument();
  });

  it('shows an empty state with a dashboard link when there is no product', async () => {
    renderPanel({ products: [] });
    expect(await screen.findByText('Add a product first')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Create product' })).toHaveAttribute(
      'href',
      `${DASHBOARD}/w/w1/products/new`,
    );
  });
});
