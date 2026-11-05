import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import type {
  ProviderCheckResponse,
  ProviderSettings,
  UsageSummary,
  Workspace,
} from '@creatorops/contracts';

import { createFakeApi, json, WORKSPACE } from '../../test/fakeApi.js';
import type { RecordedCall } from '../../test/fakeApi.js';
import { renderWeb } from '../../test/renderWeb.js';

const API = `/api/v1/workspaces/${WORKSPACE.id}`;
const PATH = `/w/${WORKSPACE.id}/settings`;

const EMPTY: ProviderSettings = {
  configured: false,
  source: 'mock',
  provider: null,
  baseUrl: null,
  model: null,
  keyLast4: null,
  pricing: null,
  monthlyCapUsd: null,
  canStoreKey: true,
  version: null,
  updatedAt: null,
};

const SAVED: ProviderSettings = {
  configured: true,
  source: 'workspace',
  provider: 'openrouter',
  baseUrl: 'https://openrouter.ai/api/v1',
  model: 'vendor/model-x',
  keyLast4: 'WXYZ',
  pricing: { inputPerMillionUsd: 3, outputPerMillionUsd: 15, multiplier: 1, minPerRequestUsd: 0 },
  monthlyCapUsd: 20,
  canStoreKey: true,
  version: 2,
  updatedAt: '2026-11-05T00:00:00.000Z',
};

const USAGE: UsageSummary = {
  month: '2026-11',
  calls: 0,
  inputUnits: 0,
  outputUnits: 0,
  spentUsd: 0,
  reservedUsd: 0,
  capUsd: null,
  countedUsd: 0,
  anomalies: 0,
  byModel: [],
};

interface World {
  settings: ProviderSettings;
  usage: UsageSummary;
  check: ProviderCheckResponse;
  saveError: { status: number; code: string; message: string } | null;
  calls: RecordedCall[];
}

function setup(role: Workspace['role'] = 'owner', initial: Partial<World> = {}) {
  const world: World = {
    settings: EMPTY,
    usage: USAGE,
    check: { ok: true, code: null, message: 'Connected. The key is accepted.' },
    saveError: null,
    calls: [],
    ...initial,
  };
  const api = createFakeApi({
    workspaces: [{ ...WORKSPACE, role }],
    intercept: (call) => {
      world.calls.push(call);
      const path = call.path.split('?')[0] ?? '';
      if (path === `${API}/provider-settings` && call.method === 'GET') return json(world.settings);
      if (path === `${API}/usage`) return json(world.usage);
      if (path === `${API}/provider-settings` && call.method === 'PUT') {
        if (world.saveError !== null) {
          return json(
            {
              error: {
                code: world.saveError.code,
                message: world.saveError.message,
                requestId: 'r',
                details: { currentVersion: 3 },
              },
            },
            world.saveError.status,
          );
        }
        const body = call.body as {
          model: string;
          provider: 'openrouter' | 'custom';
          apiKey?: string;
        };
        world.settings = {
          ...SAVED,
          provider: body.provider,
          model: body.model,
          keyLast4: body.apiKey === undefined ? SAVED.keyLast4 : body.apiKey.slice(-4),
          version: (world.settings.version ?? 0) + 1,
        };
        return json(world.settings);
      }
      if (path === `${API}/provider-settings` && call.method === 'DELETE') {
        world.settings = EMPTY;
        return json(EMPTY);
      }
      if (path === `${API}/provider-settings/check`) return json(world.check);
      return undefined;
    },
  });
  const view = renderWeb(PATH, api);
  return { ...view, world };
}

const puts = (world: World) => world.calls.filter((c) => c.method === 'PUT');

describe('Settings: text provider', () => {
  it('starts on the built-in writer and saves OpenRouter with a key, then forgets the key', async () => {
    const user = userEvent.setup();
    const { world } = setup('owner');
    expect(await screen.findByText(/built-in test writer/)).toBeInTheDocument();
    await user.type(screen.getByLabelText('Model'), 'vendor/model-x');
    await user.type(screen.getByLabelText('API key'), 'sk-or-v1-0123456789WXYZ');
    await user.click(screen.getByRole('button', { name: 'Save provider' }));
    expect(await screen.findByText(/Saved. The key is stored encrypted/)).toBeInTheDocument();
    expect(puts(world)[0]?.body).toEqual({
      provider: 'openrouter',
      model: 'vendor/model-x',
      baseUrl: 'https://openrouter.ai/api/v1',
      apiKey: 'sk-or-v1-0123456789WXYZ',
      pricing: null,
      monthlyCapUsd: null,
    });
    // The form shows only the last four, and the key box is empty again.
    expect(await screen.findByText(/A key ending in WXYZ is saved/)).toBeInTheDocument();
    expect(screen.getByLabelText('API key')).toHaveValue('');
    expect(document.body.textContent).not.toContain('sk-or-v1-0123456789');
  });

  it('shows validation messages and sends nothing for a bad form', async () => {
    const user = userEvent.setup();
    const { world } = setup('owner');
    await user.click(await screen.findByRole('button', { name: 'Save provider' }));
    expect(await screen.findByText(/Enter the model name/)).toBeInTheDocument();
    expect(screen.getByText('Enter the API key.')).toBeInTheDocument();
    expect(puts(world)).toHaveLength(0);
  });

  it('shows the address field only for a custom provider and checks it', async () => {
    const user = userEvent.setup();
    const { world } = setup('owner');
    await screen.findByLabelText('Model');
    expect(screen.queryByLabelText('Address')).toBeNull();
    await user.selectOptions(screen.getByLabelText('Provider'), 'custom');
    await user.type(screen.getByLabelText('Address'), 'http://192.168.1.5/v1');
    await user.type(screen.getByLabelText('Model'), 'm');
    await user.type(screen.getByLabelText('API key'), 'sk-or-v1-0123456789WXYZ');
    await user.click(screen.getByRole('button', { name: 'Save provider' }));
    expect(
      await screen.findByText(/Use an https address with a public host name/),
    ).toBeInTheDocument();
    expect(puts(world)).toHaveLength(0);
  });

  it('sends the saved version when changing, and keeps the key when none is typed', async () => {
    const user = userEvent.setup();
    const { world } = setup('owner', { settings: SAVED });
    expect(
      await screen.findByText(/Generation uses OpenRouter with the model vendor\/model-x/),
    ).toBeInTheDocument();
    const model = screen.getByLabelText('Model');
    await user.clear(model);
    await user.type(model, 'vendor/model-y');
    await user.click(screen.getByRole('button', { name: 'Save provider' }));
    await waitFor(() => expect(puts(world)).toHaveLength(1));
    expect(puts(world)[0]?.body).toMatchObject({
      model: 'vendor/model-y',
      version: 2,
      monthlyCapUsd: 20,
    });
    expect((puts(world)[0]?.body as { apiKey?: string }).apiKey).toBeUndefined();
  });

  it('explains a conflict and reloads the form with the server values', async () => {
    const user = userEvent.setup();
    setup('owner', {
      settings: SAVED,
      saveError: { status: 409, code: 'CONFLICT', message: 'changed' },
    });
    const model = await screen.findByLabelText('Model');
    await user.clear(model);
    await user.type(model, 'vendor/other');
    await user.click(screen.getByRole('button', { name: 'Save provider' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The settings changed since you opened them',
    );
  });

  it('checks the connection and shows the plain sentence, success or failure', async () => {
    const user = userEvent.setup();
    const { world } = setup('owner', { settings: SAVED });
    await user.click(await screen.findByRole('button', { name: 'Check connection' }));
    expect(await screen.findByText('Connected. The key is accepted.')).toBeInTheDocument();
    world.check = {
      ok: false,
      code: 'AUTH_FAILED',
      message: 'The provider did not accept the key.',
    };
    await user.click(screen.getByRole('button', { name: 'Check connection' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The provider did not accept the key.',
    );
  });

  it('removes the provider only after confirmation', async () => {
    const user = userEvent.setup();
    const { world } = setup('owner', { settings: SAVED });
    await user.click(await screen.findByRole('button', { name: 'Remove provider' }));
    await user.click(screen.getByRole('button', { name: 'Keep it' }));
    expect(world.calls.some((c) => c.method === 'DELETE')).toBe(false);
    await user.click(screen.getByRole('button', { name: 'Remove provider' }));
    await user.click(screen.getByRole('button', { name: 'Yes, remove it' }));
    expect(
      await screen.findByText(/Removed. Generation uses the built-in test writer again/),
    ).toBeInTheDocument();
    expect(world.calls.filter((c) => c.method === 'DELETE')).toHaveLength(1);
  });

  it('is read-only for an editor and a viewer: no buttons, a plain note', async () => {
    for (const role of ['editor', 'viewer'] as const) {
      const { unmount } = setup(role, { settings: SAVED });
      expect(
        await screen.findByText(/Only an owner or admin can change these settings/),
      ).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Save provider' })).toBeNull();
      expect(screen.queryByRole('button', { name: 'Check connection' })).toBeNull();
      expect(screen.getByLabelText('Model')).toBeDisabled();
      unmount();
    }
  });

  it('warns when the server cannot store keys and disables saving', async () => {
    setup('owner', { settings: { ...EMPTY, canStoreKey: false } });
    expect(await screen.findByRole('alert')).toHaveTextContent('SECRETS_ENCRYPTION_KEY');
    expect(screen.getByRole('button', { name: 'Save provider' })).toBeDisabled();
  });
});

describe('Settings: usage', () => {
  it('shows the empty month, then totals, the limit used, a flagged cost and the cost by model', async () => {
    const empty = setup('owner');
    expect(await screen.findByText(/No real-provider calls yet this month/)).toBeInTheDocument();
    empty.unmount();
    setup('owner', {
      settings: SAVED,
      usage: {
        ...USAGE,
        calls: 3,
        spentUsd: 4.5,
        reservedUsd: 0.5,
        countedUsd: 5,
        capUsd: 20,
        anomalies: 1,
        byModel: [{ provider: 'openrouter', model: 'vendor/model-x', calls: 3, costUsd: 4.5 }],
      },
    });
    expect(await screen.findByText('Calls in 2026-11')).toBeInTheDocument();
    expect(screen.getAllByText('$4.50')).toHaveLength(2); // the total and the model row
    expect(screen.getByText('$20.00')).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: 'Monthly limit used' })).toHaveAttribute(
      'value',
      '25',
    );
    expect(screen.getByText('25% of the limit is used.')).toBeInTheDocument();
    expect(screen.getByText(/1 call cost much more than your prices predict/)).toBeInTheDocument();
    const table = screen.getByRole('table');
    expect(within(table).getByText('vendor/model-x')).toBeInTheDocument();
  });
});
