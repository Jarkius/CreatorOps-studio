import { useState } from 'react';

import { ApiError } from '@creatorops/contracts';
import type { ProviderCheckResponse, ProviderSettings } from '@creatorops/contracts';
import { Button, SelectField, TextField } from '@creatorops/ui';

import { describeError } from '../errors.js';
import {
  buildProviderRequest,
  formFromSettings,
  type ProviderFormErrors,
  type ProviderFormValues,
} from './providerForm.js';
import { useCheckProvider, useRemoveProvider, useSaveProvider } from './settingsQueries.js';

const PRESETS = [
  { value: 'openrouter', label: 'OpenRouter' },
  { value: 'custom', label: 'Custom (OpenAI-compatible address)' },
];

export const CONFLICT_MESSAGE =
  'The settings changed since you opened them. They were reloaded; check them and save again.';

type Message = { kind: 'ok' | 'error'; text: string };

export function ProviderPanel({
  workspaceId,
  settings,
  canManage,
}: {
  workspaceId: string;
  settings: ProviderSettings;
  canManage: boolean;
}) {
  // What was said (saved, removed, checked) lives here so it survives the form being reset.
  const [message, setMessage] = useState<Message | null>(null);
  const [check, setCheck] = useState<ProviderCheckResponse | null>(null);
  // The form is keyed by the saved version, so a reload after a save or a conflict resets what is typed.
  return (
    <ProviderForm
      key={`${settings.version ?? 0}:${settings.configured}`}
      workspaceId={workspaceId}
      settings={settings}
      canManage={canManage}
      message={message}
      setMessage={setMessage}
      check={check}
      setCheck={setCheck}
    />
  );
}

function ProviderForm({
  workspaceId,
  settings,
  canManage,
  message,
  setMessage,
  check,
  setCheck,
}: {
  workspaceId: string;
  settings: ProviderSettings;
  canManage: boolean;
  message: Message | null;
  setMessage: (value: Message | null) => void;
  check: ProviderCheckResponse | null;
  setCheck: (value: ProviderCheckResponse | null) => void;
}) {
  const [values, setValues] = useState<ProviderFormValues>(() => formFromSettings(settings));
  const [errors, setErrors] = useState<ProviderFormErrors>({});
  const [confirmRemove, setConfirmRemove] = useState(false);
  const save = useSaveProvider(workspaceId);
  const remove = useRemoveProvider(workspaceId);
  const checker = useCheckProvider(workspaceId);

  const set = (name: keyof ProviderFormValues) => (event: { target: { value: string } }) => {
    setValues((previous) => ({ ...previous, [name]: event.target.value }) as ProviderFormValues);
    setMessage(null);
  };

  const onSave = async () => {
    setMessage(null);
    setCheck(null);
    const result = buildProviderRequest(values, settings);
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    setErrors({});
    try {
      await save.mutateAsync(result.request);
      setMessage({
        kind: 'ok',
        text: 'Saved. The key is stored encrypted and is not shown again.',
      });
    } catch (error) {
      setMessage({
        kind: 'error',
        text:
          error instanceof ApiError &&
          error.code === 'CONFLICT' &&
          error.currentVersion !== undefined
            ? CONFLICT_MESSAGE
            : describeError(error).message,
      });
    }
  };

  const onCheck = async () => {
    setCheck(null);
    try {
      setCheck(await checker.mutateAsync());
    } catch (error) {
      setCheck({ ok: false, code: 'UNREACHABLE', message: describeError(error).message });
    }
  };

  const onRemove = async () => {
    setMessage(null);
    try {
      await remove.mutateAsync();
      setConfirmRemove(false);
      setCheck(null);
      setMessage({ kind: 'ok', text: 'Removed. Generation uses the built-in test writer again.' });
    } catch (error) {
      setMessage({ kind: 'error', text: describeError(error).message });
    }
  };

  return (
    <div className="space-y-4">
      <p className="leading-relaxed" role="status">
        {settings.configured
          ? `Generation uses ${settings.provider === 'openrouter' ? 'OpenRouter' : 'your custom provider'} with the model ${settings.model ?? ''}.`
          : 'Generation uses the built-in test writer. It is free and writes simple placeholder copy. Save a provider below to use a real model.'}
      </p>
      {settings.canStoreKey ? null : (
        <p role="alert" className="leading-relaxed text-[var(--co-danger)]">
          This server has no encryption key for provider keys, so a key cannot be saved. Set
          SECRETS_ENCRYPTION_KEY (see .env.example) and restart the API and the worker.
        </p>
      )}
      {canManage ? null : (
        <p className="text-[var(--co-text-muted)]">
          Only an owner or admin can change these settings.
        </p>
      )}
      <fieldset disabled={!canManage || !settings.canStoreKey} className="space-y-4">
        <SelectField
          label="Provider"
          options={PRESETS}
          value={values.provider}
          onChange={set('provider')}
        />
        {values.provider === 'custom' ? (
          <TextField
            label="Address"
            hint="An https address that ends in /v1. We add /chat/completions."
            value={values.baseUrl}
            onChange={set('baseUrl')}
            {...(errors.baseUrl === undefined ? {} : { error: errors.baseUrl })}
            autoComplete="off"
          />
        ) : null}
        <TextField
          label="Model"
          hint="The model name exactly as your provider lists it."
          value={values.model}
          onChange={set('model')}
          {...(errors.model === undefined ? {} : { error: errors.model })}
          autoComplete="off"
        />
        <TextField
          label="API key"
          type="password"
          value={values.apiKey}
          onChange={set('apiKey')}
          autoComplete="off"
          hint={
            settings.keyLast4 === null
              ? 'Pasted once, stored encrypted on the server, and never shown again.'
              : `A key ending in ${settings.keyLast4} is saved. Leave this empty to keep it.`
          }
          {...(errors.apiKey === undefined ? {} : { error: errors.apiKey })}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            label="Input price (USD per 1M tokens)"
            inputMode="decimal"
            value={values.inputPrice}
            onChange={set('inputPrice')}
            {...(errors.inputPrice === undefined ? {} : { error: errors.inputPrice })}
          />
          <TextField
            label="Output price (USD per 1M tokens)"
            inputMode="decimal"
            value={values.outputPrice}
            onChange={set('outputPrice')}
            {...(errors.outputPrice === undefined ? {} : { error: errors.outputPrice })}
          />
          <TextField
            label="Plan multiplier"
            hint="For a reseller plan, for example 1.3. Leave empty for 1."
            inputMode="decimal"
            value={values.multiplier}
            onChange={set('multiplier')}
            {...(errors.multiplier === undefined ? {} : { error: errors.multiplier })}
          />
          <TextField
            label="Minimum per request (USD)"
            hint="If your plan bills at least this much per call."
            inputMode="decimal"
            value={values.minPerRequest}
            onChange={set('minPerRequest')}
            {...(errors.minPerRequest === undefined ? {} : { error: errors.minPerRequest })}
          />
          <TextField
            label="Baht per 1 USD of billed cost"
            hint="Shows costs in Thai baht. Leave empty for 35. A MaxPlus credit: 1 baht buys 3 USD, so enter 0.3333."
            inputMode="decimal"
            value={values.thbPerUsd}
            onChange={set('thbPerUsd')}
            {...(errors.thbPerUsd === undefined ? {} : { error: errors.thbPerUsd })}
          />
        </div>
        <TextField
          label="Monthly limit (USD)"
          hint="Optional. Generation stops before a call that could pass it. Needs both prices."
          inputMode="decimal"
          value={values.monthlyCap}
          onChange={set('monthlyCap')}
          {...(errors.monthlyCap === undefined ? {} : { error: errors.monthlyCap })}
        />
      </fieldset>
      {canManage ? (
        <div className="flex flex-wrap items-center gap-3">
          <Button
            loading={save.isPending}
            disabled={!settings.canStoreKey}
            onClick={() => void onSave()}
          >
            Save provider
          </Button>
          {settings.configured ? (
            <Button variant="secondary" loading={checker.isPending} onClick={() => void onCheck()}>
              Check connection
            </Button>
          ) : null}
          {settings.configured && !confirmRemove ? (
            <Button variant="secondary" onClick={() => setConfirmRemove(true)}>
              Remove provider
            </Button>
          ) : null}
        </div>
      ) : null}
      {confirmRemove ? (
        <div
          role="alertdialog"
          aria-label="Remove provider"
          className="space-y-2 rounded-lg border border-[var(--co-border)] p-3"
        >
          <p>Remove the saved provider and key? The key is deleted from the server.</p>
          <div className="flex gap-3">
            <Button loading={remove.isPending} onClick={() => void onRemove()}>
              Yes, remove it
            </Button>
            <Button variant="secondary" onClick={() => setConfirmRemove(false)}>
              Keep it
            </Button>
          </div>
        </div>
      ) : null}
      {message === null ? null : (
        <p
          role={message.kind === 'ok' ? 'status' : 'alert'}
          className={
            message.kind === 'ok'
              ? 'font-medium text-[var(--co-success)]'
              : 'text-[var(--co-danger)]'
          }
        >
          {message.text}
        </p>
      )}
      {check === null ? null : (
        <p
          role={check.ok ? 'status' : 'alert'}
          className={check.ok ? 'font-medium text-[var(--co-success)]' : 'text-[var(--co-danger)]'}
        >
          {check.message}
        </p>
      )}
    </div>
  );
}
