import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { createFakeApi, json, THAI_NAME, WORKSPACE } from '../../test/fakeApi.js';
import { renderWeb } from '../../test/renderWeb.js';

const LIST_PATH = `/w/${WORKSPACE.id}/products`;
const NEW_PATH = `${LIST_PATH}/new`;

function submit(user: ReturnType<typeof userEvent.setup>) {
  return user.click(screen.getByRole('button', { name: 'Create product' }));
}

describe('ProductForm (create)', () => {
  it('shows the required-name message and links it to the input', async () => {
    const user = userEvent.setup();
    const api = createFakeApi();
    renderWeb(NEW_PATH, api);

    await submit(user);

    const name = await screen.findByLabelText(/Name/, { selector: 'input' });
    expect(await screen.findByText('Enter a product name.')).toBeVisible();
    expect(name).toHaveAttribute('aria-invalid', 'true');
    expect(name).toHaveAccessibleDescription(/Enter a product name\./);
    expect(api.calls.some((call) => call.method === 'POST')).toBe(false);
  });

  it('asks for a currency when an amount is given without one', async () => {
    const user = userEvent.setup();
    renderWeb(NEW_PATH, createFakeApi());

    await user.type(await screen.findByLabelText('Name'), 'Desk fan');
    await user.type(screen.getByLabelText('Price amount'), '990');
    await submit(user);

    expect(await screen.findByText('Choose a currency for this price.')).toBeVisible();
    expect(screen.getByLabelText('Currency')).toHaveAttribute('aria-invalid', 'true');
  });

  it('refuses a javascript: source URL on the client and sends nothing', async () => {
    const user = userEvent.setup();
    const api = createFakeApi();
    renderWeb(NEW_PATH, api);

    await user.type(await screen.findByLabelText('Name'), 'Desk fan');
    await user.type(screen.getByLabelText('Source URL'), 'javascript:alert(1)');
    await submit(user);

    expect(
      await screen.findByText(
        'Use a full link that starts with http:// or https://, without a username or password.',
      ),
    ).toBeVisible();
    expect(api.calls.some((call) => call.method === 'POST')).toBe(false);
  });

  it('creates a product with a Thai name, drops blank list rows and opens its edit page', async () => {
    const user = userEvent.setup();
    const api = createFakeApi();
    const { router } = renderWeb(NEW_PATH, api);

    await user.type(await screen.findByLabelText('Name'), THAI_NAME);
    await user.type(screen.getByLabelText('Description'), 'Quiet, three speeds.');
    await user.type(screen.getByLabelText('Source URL'), 'https://example.com/fan');
    await user.type(screen.getByLabelText('Price amount'), '990');
    await user.selectOptions(screen.getByLabelText('Currency'), 'THB');
    await user.type(screen.getByLabelText('Target audience'), 'Home office');
    await user.type(screen.getByLabelText('Brand tone'), 'Calm');

    await user.click(screen.getByRole('button', { name: 'Add selling point' }));
    await user.click(screen.getByRole('button', { name: 'Add selling point' }));
    await user.click(screen.getByRole('button', { name: 'Add selling point' }));
    await user.type(screen.getByLabelText('Selling point 1'), 'Fast');
    await user.type(screen.getByLabelText('Selling point 3'), ' Quiet ');

    await submit(user);

    await waitFor(() => expect(router.state.location.pathname).toBe(`${LIST_PATH}/prod_1`));
    const post = api.calls.find((call) => call.method === 'POST');
    expect(post?.body).toEqual({
      name: THAI_NAME,
      description: 'Quiet, three speeds.',
      sourceUrl: 'https://example.com/fan',
      priceAmount: '990',
      currency: 'THB',
      sellingPoints: ['Fast', 'Quiet'],
      targetAudience: 'Home office',
      brandTone: 'Calm',
      restrictedClaims: [],
    });
    expect(await screen.findByRole('heading', { name: THAI_NAME })).toBeInTheDocument();
  });

  it('caps each list at 20 rows and labels the rows', async () => {
    const user = userEvent.setup();
    renderWeb(NEW_PATH, createFakeApi());

    const add = await screen.findByRole('button', { name: 'Add selling point' });
    for (let index = 0; index < 20; index += 1) fireEvent.click(add);

    expect(screen.getByLabelText('Selling point 20')).toBeInTheDocument();
    expect(add).toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'Remove selling point 1' }));
    expect(screen.queryByLabelText('Selling point 20')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add selling point' })).toBeEnabled();
  });

  it('maps server field paths to the matching inputs, including list rows', async () => {
    const user = userEvent.setup();
    const api = createFakeApi({
      intercept: (call) =>
        call.method === 'POST'
          ? json(
              {
                error: {
                  code: 'VALIDATION_ERROR',
                  message: 'Check the highlighted fields.',
                  requestId: 'req-v',
                  details: {
                    fields: [
                      { path: 'name', message: 'Name is already used in this workspace.' },
                      { path: 'sellingPoints.1', message: 'Keep each point under 300 characters.' },
                      { path: 'currency', message: 'Unknown currency.' },
                      { path: 'brandVoice', message: 'Unexpected field.' },
                    ],
                  },
                },
              },
              400,
            )
          : undefined,
    });
    const { router } = renderWeb(NEW_PATH, api);

    await user.type(await screen.findByLabelText('Name'), 'Desk fan');
    await user.type(screen.getByLabelText('Price amount'), '10');
    await user.selectOptions(screen.getByLabelText('Currency'), 'USD');
    // The first row is blank, so server index 1 (the second kept point) is form row 2.
    await user.click(screen.getByRole('button', { name: 'Add selling point' }));
    await user.click(screen.getByRole('button', { name: 'Add selling point' }));
    await user.click(screen.getByRole('button', { name: 'Add selling point' }));
    await user.type(screen.getByLabelText('Selling point 2'), 'A');
    await user.type(screen.getByLabelText('Selling point 3'), 'B');

    await submit(user);

    const nameInput = await screen.findByLabelText('Name');
    expect(nameInput).toHaveAccessibleDescription(/Name is already used in this workspace\./);
    const row3 = screen.getByLabelText('Selling point 3');
    expect(row3).toHaveAttribute('aria-invalid', 'true');
    expect(row3).toHaveAccessibleDescription('Keep each point under 300 characters.');
    expect(screen.getByLabelText('Selling point 2')).not.toHaveAttribute('aria-invalid');
    expect(screen.getByLabelText('Currency')).toHaveAccessibleDescription('Unknown currency.');
    expect(screen.getByRole('alert')).toHaveTextContent('Unexpected field.');
    expect(router.state.location.pathname).toBe(NEW_PATH);
  });

  it('shows Saving… and disables the button while the request is in flight', async () => {
    const user = userEvent.setup();
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const api = createFakeApi({
      intercept: async (call) => {
        if (call.method !== 'POST') return undefined;
        await gate;
        return undefined;
      },
    });
    renderWeb(NEW_PATH, api);

    await user.type(await screen.findByLabelText('Name'), 'Desk fan');
    await submit(user);

    const saving = await screen.findByRole('button', { name: 'Saving…' });
    expect(saving).toBeDisabled();
    release();
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Saving…' })).toBeNull());
    expect(within(document.body).queryByText('Product saved')).toBeNull();
  });
});
