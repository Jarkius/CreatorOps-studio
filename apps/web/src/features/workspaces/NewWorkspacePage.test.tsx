import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { createFakeApi, json, SECOND_WORKSPACE, WORKSPACE } from '../../test/fakeApi.js';
import { renderWeb } from '../../test/renderWeb.js';

const PATH = '/workspaces/new';
const THAI = 'ร้านสมชาย';

function submit(user: ReturnType<typeof userEvent.setup>) {
  return user.click(screen.getByRole('button', { name: 'Create workspace' }));
}

function postCalls(api: ReturnType<typeof createFakeApi>) {
  return api.calls.filter((call) => call.method === 'POST');
}

describe('NewWorkspacePage', () => {
  it('asks for a name and sends nothing', async () => {
    const user = userEvent.setup();
    const api = createFakeApi();
    renderWeb(PATH, api);

    await submit(user);

    const name = await screen.findByLabelText('Name');
    expect(await screen.findByText('Enter a workspace name.')).toBeVisible();
    expect(name).toHaveAttribute('aria-invalid', 'true');
    expect(name).toHaveAccessibleDescription(/Enter a workspace name\./);
    expect(postCalls(api)).toHaveLength(0);
  });

  it('treats a name of only spaces as empty', async () => {
    const user = userEvent.setup();
    const api = createFakeApi();
    renderWeb(PATH, api);

    await user.type(await screen.findByLabelText('Name'), '   ');
    await submit(user);

    expect(await screen.findByText('Enter a workspace name.')).toBeVisible();
    expect(postCalls(api)).toHaveLength(0);
  });

  it('rejects a name over 100 characters', async () => {
    const user = userEvent.setup();
    const api = createFakeApi();
    renderWeb(PATH, api);

    fireEvent.change(await screen.findByLabelText('Name'), { target: { value: 'a'.repeat(101) } });
    await submit(user);

    expect(await screen.findByText('Use 100 characters or fewer.')).toBeVisible();
    expect(postCalls(api)).toHaveLength(0);
  });

  it('accepts a name of exactly 100 characters', async () => {
    const user = userEvent.setup();
    const api = createFakeApi();
    renderWeb(PATH, api);

    fireEvent.change(await screen.findByLabelText('Name'), { target: { value: 'a'.repeat(100) } });
    await submit(user);

    await waitFor(() => expect(postCalls(api)).toHaveLength(1));
  });

  it('rejects a brand voice over 2000 characters', async () => {
    const user = userEvent.setup();
    const api = createFakeApi();
    renderWeb(PATH, api);

    await user.type(await screen.findByLabelText('Name'), THAI);
    fireEvent.change(screen.getByLabelText('Brand voice (optional)'), {
      target: { value: 'b'.repeat(2001) },
    });
    await submit(user);

    expect(await screen.findByText('Use 2000 characters or fewer.')).toBeVisible();
    expect(postCalls(api)).toHaveLength(0);
  });

  it('creates the workspace with a Thai name, refreshes the list and opens its products', async () => {
    const user = userEvent.setup();
    const api = createFakeApi();
    const { router } = renderWeb(PATH, api);

    await user.type(await screen.findByLabelText('Name'), THAI);
    await submit(user);

    await waitFor(() => {
      expect(router.state.location.pathname).toMatch(/^\/w\/ws_created_\d+\/products$/);
    });
    expect(postCalls(api)).toEqual([
      {
        method: 'POST',
        path: '/api/v1/workspaces',
        body: { name: THAI, defaultLanguage: 'th', brandVoice: null },
      },
    ]);
    // The list was fetched again after the create, so the switcher now offers the new workspace.
    const listCalls = api.calls.filter((call) => call.path === '/api/v1/workspaces');
    expect(listCalls.length).toBeGreaterThanOrEqual(2);
    expect(await screen.findByRole('heading', { name: 'No products yet' })).toBeInTheDocument();
    const switcher = await screen.findByRole('combobox', { name: 'Workspace' });
    expect(within(switcher).getByRole('option', { name: THAI })).toBeInTheDocument();
  });

  it('sends the chosen language and a trimmed brand voice', async () => {
    const user = userEvent.setup();
    const api = createFakeApi({ workspaces: [WORKSPACE] });
    renderWeb(PATH, api);

    await user.type(await screen.findByLabelText('Name'), '  Studio Two  ');
    await user.selectOptions(screen.getByLabelText('Default language'), 'en');
    await user.type(screen.getByLabelText('Brand voice (optional)'), '  Warm and direct  ');
    await submit(user);

    await waitFor(() => expect(postCalls(api)).toHaveLength(1));
    expect(postCalls(api)[0]?.body).toEqual({
      name: 'Studio Two',
      defaultLanguage: 'en',
      brandVoice: 'Warm and direct',
    });
  });

  it('shows the Thai default language first', async () => {
    renderWeb(PATH, createFakeApi());
    const language = await screen.findByLabelText('Default language');
    expect(language).toHaveValue('th');
    expect(
      within(language)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['Thai', 'English']);
  });

  it('maps a server field error to its field', async () => {
    const user = userEvent.setup();
    const api = createFakeApi({
      intercept: (call) =>
        call.method === 'POST'
          ? json(
              {
                error: {
                  code: 'VALIDATION_ERROR',
                  message: 'Some fields are invalid.',
                  requestId: 'req-test',
                  details: { fields: [{ path: 'name', message: 'Choose a different name.' }] },
                },
              },
              400,
            )
          : undefined,
    });
    renderWeb(PATH, api);

    await user.type(await screen.findByLabelText('Name'), SECOND_WORKSPACE.name);
    await submit(user);

    const name = await screen.findByLabelText('Name');
    expect(await screen.findByText('Choose a different name.')).toBeVisible();
    expect(name).toHaveAttribute('aria-invalid', 'true');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('shows the workspace limit message from a 409 in an alert', async () => {
    const user = userEvent.setup();
    const api = createFakeApi({
      intercept: (call) =>
        call.method === 'POST'
          ? json(
              {
                error: {
                  code: 'CONFLICT',
                  message: 'You have reached the maximum number of workspaces.',
                  requestId: 'req-test',
                },
              },
              409,
            )
          : undefined,
    });
    const { router } = renderWeb(PATH, api);

    await user.type(await screen.findByLabelText('Name'), THAI);
    await submit(user);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('You have reached the maximum number of workspaces.');
    expect(router.state.location.pathname).toBe(PATH);
  });

  it('shows a generic failure with the request reference and keeps the typed values', async () => {
    const user = userEvent.setup();
    const api = createFakeApi({
      intercept: (call) =>
        call.method === 'POST'
          ? json({ error: { code: 'INTERNAL_ERROR', message: 'Boom.', requestId: 'req-500' } }, 500)
          : undefined,
    });
    renderWeb(PATH, api);

    await user.type(await screen.findByLabelText('Name'), THAI);
    await submit(user);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Reference: req-500');
    expect(screen.getByLabelText('Name')).toHaveValue(THAI);
  });

  it('shows Creating and disables the button while the request is in flight', async () => {
    const user = userEvent.setup();
    const api = createFakeApi({
      intercept: (call) => (call.method === 'POST' ? new Promise<Response>(() => {}) : undefined),
    });
    renderWeb(PATH, api);

    await user.type(await screen.findByLabelText('Name'), THAI);
    await submit(user);

    const saving = await screen.findByRole('button', { name: 'Creating…' });
    expect(saving).toBeDisabled();
    expect(saving).toHaveAttribute('aria-busy', 'true');
  });

  it('Cancel goes back to the Overview', async () => {
    const user = userEvent.setup();
    const { router } = renderWeb(PATH, createFakeApi());

    const cancel = await screen.findByRole('link', { name: 'Cancel' });
    expect(cancel).toHaveAttribute('href', '/');
    await user.click(cancel);

    expect(router.state.location.pathname).toBe('/');
    expect(postCalls(createFakeApi())).toHaveLength(0);
  });
});
