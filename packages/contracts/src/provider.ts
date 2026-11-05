import { z } from 'zod';

/** Where a workspace's text provider comes from. `mock` is the built-in test writer. */
export const PROVIDER_PRESET_VALUES = ['openrouter', 'custom'] as const;
export const ProviderPresetSchema = z.enum(PROVIDER_PRESET_VALUES);
export type ProviderPreset = z.infer<typeof ProviderPresetSchema>;

export const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';

export const PROVIDER_LIMITS = {
  model: 120,
  apiKey: { min: 8, max: 400 },
  maxPricePerMillionUsd: 1000,
  maxMultiplier: 100,
  maxMinPerRequestUsd: 10,
  maxMonthlyCapUsd: 100000,
} as const;

const LOOPBACK_OR_PRIVATE_HOST =
  /^(localhost|.*\.localhost|.*\.local|.*\.internal|.*\.lan|metadata\.google\.internal)$/i;

/** True for an https URL on a public-looking host: no credentials, no query, no IP literal. */
export function isSafeProviderBaseUrl(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:') return false;
  if (url.username !== '' || url.password !== '' || url.search !== '' || url.hash !== '')
    return false;
  const host = url.hostname;
  // IPv4 and IPv6 literals are refused: a provider is reached by name.
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(':') || host.startsWith('['))
    return false;
  if (!host.includes('.')) return false;
  return !LOOPBACK_OR_PRIVATE_HOST.test(host);
}

export const ProviderPricingSchema = z
  .object({
    inputPerMillionUsd: z.number().min(0).max(PROVIDER_LIMITS.maxPricePerMillionUsd),
    outputPerMillionUsd: z.number().min(0).max(PROVIDER_LIMITS.maxPricePerMillionUsd),
    /** A plan or pool multiplier on the base price. */
    multiplier: z.number().min(0.1).max(PROVIDER_LIMITS.maxMultiplier).default(1),
    /** A fee per request below which a call is never billed. */
    minPerRequestUsd: z.number().min(0).max(PROVIDER_LIMITS.maxMinPerRequestUsd).default(0),
  })
  .strict();
export type ProviderPricing = z.infer<typeof ProviderPricingSchema>;

/** What the settings screen may read. The key itself is never returned, only its last four. */
export const ProviderSettingsSchema = z.object({
  configured: z.boolean(),
  /** `workspace` (saved here), `environment` (server variables) or `mock` (built-in writer). */
  source: z.enum(['workspace', 'environment', 'mock']),
  provider: ProviderPresetSchema.nullable(),
  baseUrl: z.string().nullable(),
  model: z.string().nullable(),
  keyLast4: z.string().nullable(),
  pricing: ProviderPricingSchema.nullable(),
  monthlyCapUsd: z.number().nullable(),
  /** False when the server has no SECRETS_ENCRYPTION_KEY, so a key cannot be saved. */
  canStoreKey: z.boolean(),
  version: z.number().int().nullable(),
  updatedAt: z.string().nullable(),
});
export type ProviderSettings = z.infer<typeof ProviderSettingsSchema>;

/**
 * PUT /api/v1/workspaces/:workspaceId/provider-settings. `apiKey` may be left out to keep the saved
 * key (when one exists). Send `version` from the last read when changing existing settings.
 */
export const PutProviderSettingsRequestSchema = z
  .object({
    provider: ProviderPresetSchema,
    baseUrl: z.string().trim().max(300).optional(),
    model: z.string().trim().min(1).max(PROVIDER_LIMITS.model),
    apiKey: z
      .string()
      .trim()
      .min(PROVIDER_LIMITS.apiKey.min)
      .max(PROVIDER_LIMITS.apiKey.max)
      .refine((value) => !/\s/.test(value), 'must not contain spaces or line breaks')
      .optional(),
    pricing: ProviderPricingSchema.nullish(),
    monthlyCapUsd: z.number().min(0).max(PROVIDER_LIMITS.maxMonthlyCapUsd).nullish(),
    version: z.number().int().min(1).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.provider === 'custom') {
      if (value.baseUrl === undefined || !isSafeProviderBaseUrl(value.baseUrl)) {
        ctx.addIssue({
          code: 'custom',
          path: ['baseUrl'],
          message: 'must be an https URL with a public host name (no address, no credentials)',
        });
      }
    } else if (value.baseUrl !== undefined && value.baseUrl !== OPENROUTER_BASE_URL) {
      ctx.addIssue({
        code: 'custom',
        path: ['baseUrl'],
        message: 'OpenRouter uses its own address; choose Custom to use another one',
      });
    }
  });
export type PutProviderSettingsRequest = z.input<typeof PutProviderSettingsRequestSchema>;
export type PutProviderSettingsRequestParsed = z.infer<typeof PutProviderSettingsRequestSchema>;

/** POST .../provider-settings/check: one free read-only call, never a generation. */
export const ProviderCheckResponseSchema = z.object({
  ok: z.boolean(),
  /** A stable word when not ok: AUTH_FAILED, BUDGET_EXCEEDED, UNREACHABLE, INVALID_REQUEST, NOT_CONFIGURED. */
  code: z.string().nullable(),
  message: z.string(),
});
export type ProviderCheckResponse = z.infer<typeof ProviderCheckResponseSchema>;

export const ProviderSettingsParamsSchema = z.object({ workspaceId: z.string() });
