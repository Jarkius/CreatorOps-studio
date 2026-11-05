import {
  OPENROUTER_BASE_URL,
  ProviderPricingSchema,
  type ProviderCheckResponse,
  type ProviderPricing,
  type ProviderSettings,
  type PutProviderSettingsRequestParsed,
} from '@creatorops/contracts';
import { checkConnection, type HttpTransport } from '@creatorops/provider-core';

import type { Db } from '../../db/client.js';
import { AppError } from '../../platform/errors.js';
import {
  decryptSecret,
  encryptSecret,
  lastFour,
  SecretError,
  type SecretsKey,
} from '../../platform/secrets.js';
import { recordAuditEvent } from '../audit/repo.js';
import type { RequestContext } from '../identity/context.js';
import { assertCanManageProvider } from '../identity/permissions.js';
import {
  deleteCredential,
  findCredential,
  insertCredential,
  updateCredential,
  type CredentialRow,
  type CredentialValues,
} from './repo.js';

export interface ProviderSettingsDeps {
  readonly db: Db;
  /** Undefined when the server has no SECRETS_ENCRYPTION_KEY: nothing can be saved or used. */
  readonly secrets: SecretsKey | undefined;
  /** Replaceable so tests never reach a network. */
  readonly transport?: HttpTransport;
  /** Tests only: the check call may use http://localhost. */
  readonly allowLocalHttp?: boolean;
}

const NOT_CONFIGURED =
  'The server has no encryption key for provider keys (SECRETS_ENCRYPTION_KEY).';

export function pricingOf(row: CredentialRow): ProviderPricing | null {
  const parsed = ProviderPricingSchema.safeParse(row.pricing);
  return parsed.success ? parsed.data : null;
}

export function toSettings(row: CredentialRow | null, canStoreKey: boolean): ProviderSettings {
  if (row === null) {
    return {
      configured: false,
      source: 'mock',
      provider: null,
      baseUrl: null,
      model: null,
      keyLast4: null,
      pricing: null,
      monthlyCapUsd: null,
      canStoreKey,
      version: null,
      updatedAt: null,
    };
  }
  return {
    configured: true,
    source: 'workspace',
    provider: row.provider === 'openrouter' ? 'openrouter' : 'custom',
    baseUrl: row.baseUrl,
    model: row.model,
    keyLast4: row.keyLast4 === '' ? null : row.keyLast4,
    pricing: pricingOf(row),
    monthlyCapUsd: row.monthlyCapUsd === null ? null : Number(row.monthlyCapUsd),
    canStoreKey,
    version: row.version,
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Any member may read: the key is never returned, only its last four characters. */
export async function getProviderSettings(
  deps: ProviderSettingsDeps,
  ctx: RequestContext,
): Promise<ProviderSettings> {
  return toSettings(await findCredential(deps.db, ctx), deps.secrets !== undefined);
}

export async function putProviderSettings(
  deps: ProviderSettingsDeps,
  ctx: RequestContext,
  input: PutProviderSettingsRequestParsed,
): Promise<ProviderSettings> {
  assertCanManageProvider(ctx);
  if (deps.secrets === undefined) throw new AppError('CONFLICT', NOT_CONFIGURED);

  const existing = await findCredential(deps.db, ctx);
  if (existing === null && input.apiKey === undefined) {
    throw new AppError('VALIDATION_ERROR', 'The request is not valid.', [
      { path: 'apiKey', message: 'is required the first time' },
    ]);
  }
  if (existing !== null && input.version === undefined) {
    throw new AppError('VALIDATION_ERROR', 'The request is not valid.', [
      { path: 'version', message: 'is required when changing saved settings' },
    ]);
  }

  const values: CredentialValues = {
    provider: input.provider,
    baseUrl: input.provider === 'openrouter' ? OPENROUTER_BASE_URL : (input.baseUrl ?? ''),
    model: input.model,
    keyEncrypted:
      input.apiKey === undefined
        ? (existing?.keyEncrypted ?? '')
        : encryptSecret(input.apiKey, deps.secrets, ctx.workspaceId),
    keyLast4: input.apiKey === undefined ? (existing?.keyLast4 ?? '') : lastFour(input.apiKey),
    pricing: input.pricing ?? null,
    monthlyCapUsd:
      input.monthlyCapUsd === null || input.monthlyCapUsd === undefined
        ? null
        : input.monthlyCapUsd.toFixed(2),
  };

  const saved = await deps.db.transaction(async (tx) => {
    let row: CredentialRow | null;
    if (existing === null) {
      row = await insertCredential(tx, ctx, values);
      // A second save at the same moment found the row first: ask the caller to reload.
      if (row === null)
        throw new AppError('CONFLICT', 'The settings were saved by someone else. Reload them.');
    } else {
      row = await updateCredential(tx, ctx, input.version ?? existing.version, values);
      if (row === null) {
        const current = await findCredential(tx, ctx);
        throw new AppError(
          'CONFLICT',
          'The settings changed since you opened them. Reload and try again.',
          undefined,
          current === null ? {} : { currentVersion: current.version },
        );
      }
    }
    // The audit record names the provider and model, never the key.
    await recordAuditEvent(tx, ctx, {
      action: existing === null ? 'provider.settings_created' : 'provider.settings_updated',
      resourceType: 'provider_settings',
      resourceId: row.id,
      metadata: {
        provider: row.provider,
        model: row.model,
        keyChanged: input.apiKey !== undefined,
      },
    });
    return row;
  });
  return toSettings(saved, true);
}

export async function deleteProviderSettings(
  deps: ProviderSettingsDeps,
  ctx: RequestContext,
): Promise<ProviderSettings> {
  assertCanManageProvider(ctx);
  await deps.db.transaction(async (tx) => {
    const existing = await findCredential(tx, ctx);
    if (existing === null) return;
    await deleteCredential(tx, ctx);
    await recordAuditEvent(tx, ctx, {
      action: 'provider.settings_removed',
      resourceType: 'provider_settings',
      resourceId: existing.id,
      metadata: { provider: existing.provider, model: existing.model },
    });
  });
  return toSettings(null, deps.secrets !== undefined);
}

/** Decrypts the saved key for one workspace. Only the worker and the check call use this. */
export function openKey(secrets: SecretsKey, row: CredentialRow): string {
  return decryptSecret(row.keyEncrypted, secrets, row.workspaceId);
}

/** One free read-only call with the saved key. It shows a stable code, never the provider's text. */
export async function checkProviderSettings(
  deps: ProviderSettingsDeps,
  ctx: RequestContext,
): Promise<ProviderCheckResponse> {
  assertCanManageProvider(ctx);
  const row = await findCredential(deps.db, ctx);
  if (row === null) {
    return { ok: false, code: 'NOT_CONFIGURED', message: 'No provider is saved yet.' };
  }
  if (deps.secrets === undefined) {
    return { ok: false, code: 'NOT_CONFIGURED', message: NOT_CONFIGURED };
  }
  let apiKey: string;
  try {
    apiKey = openKey(deps.secrets, row);
  } catch (error) {
    if (error instanceof SecretError) {
      return {
        ok: false,
        code: 'NOT_CONFIGURED',
        message: 'The saved key cannot be opened with this server. Enter the key again.',
      };
    }
    throw error;
  }
  const result = await checkConnection({
    baseUrl: row.baseUrl,
    apiKey,
    ...(deps.transport === undefined ? {} : { transport: deps.transport }),
    ...(deps.allowLocalHttp === true ? { allowLocalHttp: true } : {}),
    signal: AbortSignal.timeout(10_000),
  });
  await recordAuditEvent(deps.db, ctx, {
    action: 'provider.settings_checked',
    resourceType: 'provider_settings',
    resourceId: row.id,
    metadata: { ok: result.ok, code: result.code },
  });
  const messages = {
    AUTH_FAILED: 'The provider did not accept the key.',
    BUDGET_EXCEEDED: 'The provider says the account has no credit or reached its limit.',
    INVALID_REQUEST: 'The provider did not understand the request. Check the address.',
    UNREACHABLE: 'The provider could not be reached. Check the address and try again.',
  } as const;
  return result.ok
    ? { ok: true, code: null, message: 'Connected. The key is accepted.' }
    : { ok: false, code: result.code, message: messages[result.code ?? 'UNREACHABLE'] };
}
