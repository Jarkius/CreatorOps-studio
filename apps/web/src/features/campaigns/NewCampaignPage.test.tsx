import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { createFakeApi, json, makeProduct, WORKSPACE } from '../../test/fakeApi.js';
import { createFakeContentApi } from '../../test/fakeContentApi.js';
import { renderWeb } from '../../test/renderWeb.js';

const NEW_PATH = `/w/${WORKSPACE.id}/campaigns/new`;
const PRODUCTS = [
  makeProduct({ id: 'prod_1', name: 'โคมไฟ Desk Lamp' }),
  makeProduct({ id: 'prod_2', name: 'พัดลมตั้งโต๊ะ' }),
];

function setup(
  options: {
    path?: string;
    role?: 'owner' | 'viewer';
    products?: typeof PRODUCTS;
    intercept?: (call: {
      method: string;
      path: string;
      body: unknown;
    }) => Response | undefined | Promise<Response | undefined>;
  } = {},
) {
  const content = createFakeContentApi();
  const api = createFakeApi({
    workspaces: [{ ...WORKSPACE, role: options.role ?? 'owner' }],
    products: options.products ?? PRODUCTS,
    intercept: async (call) => {
      const own = await options.intercept?.(call);
      return own ?? content.intercept(call);
    },
  });
  const view = renderWeb(options.path ?? NEW_PATH, api);
  return { ...view, api, content };
}

const campaignPosts = (api: ReturnType<typeof setup>['api']) =>
  api.calls.filter((call) => call.method === 'POST' && call.path.endsWith('/campaigns'));

async function chooseProductAndTemplate(
  user: ReturnType<typeof userEvent.setup>,
  product = 'prod_2',
  template = 'product-showcase',
) {
  await user.selectOptions(await screen.findByLabelText('Product'), product);
  await user.selectOptions(screen.getByLabelText('Template'), template);
}

describe('NewCampaignPage', () => {
  it('asks for a product and a template before sending anything', async () => {
    const user = userEvent.setup();
    const { api } = setup();

    await user.click(await screen.findByRole('button', { name: 'Create campaign' }));

    expect(await screen.findByText('Choose a product.')).toBeInTheDocument();
    expect(screen.getByText('Choose a template.')).toBeInTheDocument();
    expect(screen.getByLabelText('Product')).toHaveAttribute('aria-invalid', 'true');
    expect(campaignPosts(api)).toHaveLength(0);
  });

  it('points to the products page when the workspace has no active product', async () => {
    setup({ products: [] });

    expect(
      await screen.findByRole('heading', { name: 'Create a product first' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Go to products' })).toHaveAttribute(
      'href',
      `/w/${WORKSPACE.id}/products`,
    );
    expect(screen.queryByRole('form', { name: 'New campaign' })).not.toBeInTheDocument();
  });

  it('preselects the product from ?productId= when it is one of the options', async () => {
    setup({ path: `${NEW_PATH}?productId=prod_2` });
    expect(await screen.findByLabelText('Product')).toHaveValue('prod_2');
  });

  it('ignores a ?productId= that is not an active product', async () => {
    setup({ path: `${NEW_PATH}?productId=prod_missing` });
    expect(await screen.findByLabelText('Product')).toHaveValue('');
  });

  it('shows the template description and its default duration as the placeholder', async () => {
    const user = userEvent.setup();
    setup();

    const template = await screen.findByLabelText('Template');
    expect(
      screen.getByRole('option', { name: 'Real user review style (รีวิวสไตล์ผู้ใช้จริง)' }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Duration seconds')).not.toHaveAttribute('placeholder', '45');

    await user.selectOptions(template, 'review-style');

    expect(screen.getByLabelText('Duration seconds')).toHaveAttribute('placeholder', '45');
    expect(screen.getByText('A first-person account of using the product.')).toBeInTheDocument();
  });

  it('sends only the fields the user set (blank optional text is left out)', async () => {
    const user = userEvent.setup();
    const { api, content } = setup();
    await chooseProductAndTemplate(user);
    await user.type(screen.getByLabelText('Name'), '   ');
    await user.type(screen.getByLabelText('Tone'), '  ');
    await user.type(screen.getByLabelText('Duration seconds'), '  ');

    await user.click(screen.getByRole('button', { name: 'Create campaign' }));

    await waitFor(() => expect(campaignPosts(api)).toHaveLength(1));
    expect(campaignPosts(api)[0]?.body).toEqual({
      productId: 'prod_2',
      templateId: 'product-showcase',
      templateVersion: 1,
      platform: 'generic',
      variants: 1,
    });
    expect(content.campaigns).toHaveLength(1);
  });

  it('sends the trimmed values of every field the user set', async () => {
    const user = userEvent.setup();
    const { api } = setup();
    await chooseProductAndTemplate(user);
    await user.type(screen.getByLabelText('Name'), '  แคมเปญพัดลม น้ำหนักเบา  ');
    await user.type(screen.getByLabelText('Tone'), ' สนุก เป็นกันเอง ');
    await user.type(screen.getByLabelText('Duration seconds'), '45');
    await user.selectOptions(screen.getByLabelText('Language'), 'en');
    await user.selectOptions(screen.getByLabelText('Platform'), 'tiktok');
    await user.selectOptions(screen.getByLabelText('Variants'), '3');

    await user.click(screen.getByRole('button', { name: 'Create campaign' }));

    await waitFor(() => expect(campaignPosts(api)).toHaveLength(1));
    expect(campaignPosts(api)[0]?.body).toEqual({
      productId: 'prod_2',
      templateId: 'product-showcase',
      templateVersion: 1,
      name: 'แคมเปญพัดลม น้ำหนักเบา',
      language: 'en',
      tone: 'สนุก เป็นกันเอง',
      platform: 'tiktok',
      durationSeconds: 45,
      variants: 3,
    });
  });

  it('sends the chosen template version, not a fixed one', async () => {
    const user = userEvent.setup();
    const { api } = setup();
    await chooseProductAndTemplate(user, 'prod_1', 'review-style');

    await user.click(screen.getByRole('button', { name: 'Create campaign' }));

    await waitFor(() => expect(campaignPosts(api)).toHaveLength(1));
    expect(campaignPosts(api)[0]?.body).toMatchObject({
      templateId: 'review-style',
      templateVersion: 2,
    });
  });

  it('rejects a duration outside 5 to 180 on the client', async () => {
    const user = userEvent.setup();
    const { api } = setup();
    await chooseProductAndTemplate(user);
    await user.type(screen.getByLabelText('Duration seconds'), '4');

    await user.click(screen.getByRole('button', { name: 'Create campaign' }));

    expect(await screen.findByText('Enter a whole number from 5 to 180.')).toBeInTheDocument();
    expect(campaignPosts(api)).toHaveLength(0);
  });

  it('shows a server field error on its field, not as a form message', async () => {
    const user = userEvent.setup();
    const { api } = setup({
      intercept: (call) =>
        call.method === 'POST' && call.path.endsWith('/campaigns')
          ? json(
              {
                error: {
                  code: 'VALIDATION_ERROR',
                  message: 'Some fields need attention.',
                  requestId: 'req-form',
                  details: {
                    fields: [{ path: 'tone', message: 'Tone is not allowed for this template.' }],
                  },
                },
              },
              400,
            )
          : undefined,
    });
    await chooseProductAndTemplate(user);
    await user.type(screen.getByLabelText('Tone'), 'สนุก');

    await user.click(screen.getByRole('button', { name: 'Create campaign' }));

    const tone = await screen.findByLabelText('Tone');
    expect(await screen.findByText('Tone is not allowed for this template.')).toBeInTheDocument();
    expect(tone).toHaveAttribute('aria-invalid', 'true');
    expect(tone).toHaveAccessibleDescription(/Tone is not allowed for this template\./);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(campaignPosts(api)).toHaveLength(1);
  });

  it('shows another failure as a form-level alert from describeError', async () => {
    const user = userEvent.setup();
    setup({
      intercept: (call) =>
        call.method === 'POST' && call.path.endsWith('/campaigns')
          ? json({ error: { code: 'INTERNAL_ERROR', message: 'Boom.', requestId: 'req-x' } }, 500)
          : undefined,
    });
    await chooseProductAndTemplate(user);

    await user.click(screen.getByRole('button', { name: 'Create campaign' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Boom.');
  });

  it('sends one request when the submit button is clicked twice', async () => {
    const user = userEvent.setup();
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { api } = setup({
      intercept: async (call) => {
        if (call.method === 'POST' && call.path.endsWith('/campaigns')) await gate;
        return undefined;
      },
    });
    await chooseProductAndTemplate(user);

    const submit = screen.getByRole('button', { name: 'Create campaign' });
    await user.dblClick(submit);
    release();

    await waitFor(() => expect(campaignPosts(api)).toHaveLength(1));
  });

  it('navigates to the new campaign page on success', async () => {
    const user = userEvent.setup();
    const { router, content } = setup();
    await chooseProductAndTemplate(user);

    await user.click(screen.getByRole('button', { name: 'Create campaign' }));

    await waitFor(() =>
      expect(router.state.location.pathname).toBe(
        `/w/${WORKSPACE.id}/campaigns/${content.campaigns[0]?.id}`,
      ),
    );
    expect(await screen.findByRole('heading', { name: 'Product showcase' })).toBeInTheDocument();
  });

  it('shows the permission message instead of the form to a viewer', async () => {
    const { api } = setup({ role: 'viewer' });

    expect(
      await screen.findByRole('heading', {
        name: 'You do not have permission to create campaigns.',
      }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('form', { name: 'New campaign' })).not.toBeInTheDocument();
    expect(campaignPosts(api)).toHaveLength(0);
  });
});
