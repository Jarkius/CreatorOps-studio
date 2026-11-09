import { ProviderPricingSchema } from '@creatorops/contracts';
import {
  OpenAiCompatibleTextProvider,
  ProviderError,
  type HttpTransport,
  type TextProvider,
} from '@creatorops/provider-core';

import type { Db } from '../../db/client.js';
import { SecretError, type SecretsKey } from '../../platform/secrets.js';
import { MeteredTextProvider } from '../usage/metered-provider.js';
import { findCredentialOf } from './repo.js';
import { openKey } from './service.js';

export interface ResolverDeps {
  readonly db: Db;
  /** The built-in writer, used when a workspace has not saved a provider. */
  readonly fallback: TextProvider;
  readonly secrets: SecretsKey | undefined;
  /** Replaceable so tests never reach a network. */
  readonly transport?: HttpTransport;
  readonly allowLocalHttp?: boolean;
  readonly maxOutputTokens?: number;
  readonly log?: {
    warn(object: Record<string, unknown>, message: string): void;
    info?(object: Record<string, unknown>, message: string): void;
  };
}

export const DEFAULT_MAX_OUTPUT_TOKENS = 2000;

/**
 * The text provider for one job, chosen from the job's own workspace (never from client input).
 * A workspace without a saved provider gets the built-in writer. A saved provider is opened with
 * the server key here, in the worker, and wrapped so each call is metered. A key that cannot be
 * opened fails the job with PROVIDER_AUTH: the owner has to enter it again.
 */
export async function resolveProvider(
  deps: ResolverDeps,
  job: { id: string; workspaceId: string },
  attempt: number,
): Promise<TextProvider> {
  const row = await findCredentialOf(deps.db, job.workspaceId);
  if (row === null) return deps.fallback;
  if (deps.secrets === undefined) throw new ProviderError('AUTH_FAILED');
  let apiKey: string;
  try {
    apiKey = openKey(deps.secrets, row);
  } catch (error) {
    if (error instanceof SecretError) throw new ProviderError('AUTH_FAILED');
    throw error;
  }
  const pricingParsed = ProviderPricingSchema.safeParse(row.pricing);
  const pricing = pricingParsed.success ? pricingParsed.data : null;
  const maxOutputTokens = deps.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS;
  const inner = new OpenAiCompatibleTextProvider({
    id: row.provider,
    baseUrl: row.baseUrl,
    apiKey,
    model: row.model,
    maxOutputTokens,
    // Prices are applied by the meter, so a cost the adapter returns is always one the provider reported.
    ...(deps.transport === undefined ? {} : { transport: deps.transport }),
    ...(deps.allowLocalHttp === true ? { allowLocalHttp: true } : {}),
    ...(row.provider === 'openrouter' ? { extraBody: { usage: { include: true } } } : {}),
  });
  return new MeteredTextProvider(inner, {
    db: deps.db,
    workspaceId: job.workspaceId,
    jobId: job.id,
    attempt,
    model: row.model,
    pricing,
    capUsd: row.monthlyCapUsd === null ? null : Number(row.monthlyCapUsd),
    maxOutputTokens,
    ...(deps.log === undefined ? {} : { log: deps.log }),
  });
}
