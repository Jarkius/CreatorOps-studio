import {
  isSafeProviderBaseUrl,
  OPENROUTER_BASE_URL,
  PROVIDER_LIMITS,
  type ProviderSettings,
  type PutProviderSettingsRequest,
} from '@creatorops/contracts';

/** What the form holds: everything as the person typed it. */
export interface ProviderFormValues {
  provider: 'openrouter' | 'custom';
  baseUrl: string;
  model: string;
  apiKey: string;
  inputPrice: string;
  outputPrice: string;
  multiplier: string;
  minPerRequest: string;
  thbPerUsd: string;
  marketThbPerUsd: string;
  monthlyCap: string;
}

export type ProviderFormErrors = Partial<Record<keyof ProviderFormValues, string>>;

export const EMPTY_FORM: ProviderFormValues = {
  provider: 'openrouter',
  baseUrl: '',
  model: '',
  apiKey: '',
  inputPrice: '',
  outputPrice: '',
  multiplier: '',
  minPerRequest: '',
  thbPerUsd: '',
  marketThbPerUsd: '',
  monthlyCap: '',
};

const text = (value: number | null | undefined): string => (value == null ? '' : String(value));

/** The form values for what is saved. The key box stays empty: the key is never sent back. */
export function formFromSettings(settings: ProviderSettings | undefined): ProviderFormValues {
  if (settings === undefined || !settings.configured) return { ...EMPTY_FORM };
  return {
    provider: settings.provider ?? 'openrouter',
    baseUrl: settings.provider === 'custom' ? (settings.baseUrl ?? '') : '',
    model: settings.model ?? '',
    apiKey: '',
    inputPrice: text(settings.pricing?.inputPerMillionUsd),
    outputPrice: text(settings.pricing?.outputPerMillionUsd),
    multiplier: settings.pricing === null ? '' : text(settings.pricing?.multiplier),
    minPerRequest: settings.pricing === null ? '' : text(settings.pricing?.minPerRequestUsd),
    thbPerUsd: text(settings.pricing?.thbPerUsd),
    marketThbPerUsd: text(settings.pricing?.marketThbPerUsd),
    monthlyCap: text(settings.monthlyCapUsd),
  };
}

function number(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed === '' || !/^\d+(\.\d+)?$/.test(trimmed)) return Number.NaN;
  return Number(trimmed);
}

export type ProviderFormResult =
  { ok: true; request: PutProviderSettingsRequest } | { ok: false; errors: ProviderFormErrors };

/** Checks the form like the server does and builds the request. Pure. */
export function buildProviderRequest(
  values: ProviderFormValues,
  saved: ProviderSettings | undefined,
): ProviderFormResult {
  const errors: ProviderFormErrors = {};
  const model = values.model.trim();
  if (model === '') errors.model = 'Enter the model name, for example the one your provider lists.';
  if (model.length > PROVIDER_LIMITS.model) errors.model = 'The model name is too long.';

  const hasSaved = saved?.configured === true;
  const key = values.apiKey.trim();
  if (key === '' && !hasSaved) errors.apiKey = 'Enter the API key.';
  if (key !== '' && (key.length < PROVIDER_LIMITS.apiKey.min || /\s/.test(key))) {
    errors.apiKey = 'The key looks wrong: it must be one piece with no spaces.';
  }

  const baseUrl = values.baseUrl.trim();
  if (values.provider === 'custom' && !isSafeProviderBaseUrl(baseUrl)) {
    errors.baseUrl =
      'Use an https address with a public host name (for example https://gateway.example.com/v1).';
  }

  const anyPrice = [values.inputPrice, values.outputPrice].some((v) => v.trim() !== '');
  const input = number(values.inputPrice);
  const output = number(values.outputPrice);
  if (anyPrice) {
    if (input === null || Number.isNaN(input))
      errors.inputPrice = 'Enter a number such as 3 or 0.5.';
    if (output === null || Number.isNaN(output)) errors.outputPrice = 'Enter a number such as 15.';
  }
  const multiplier = values.multiplier.trim() === '' ? 1 : number(values.multiplier);
  if (
    anyPrice &&
    (multiplier === null ||
      Number.isNaN(multiplier) ||
      multiplier < 0.1 ||
      multiplier > PROVIDER_LIMITS.maxMultiplier)
  ) {
    errors.multiplier = 'Use a number from 0.1 to 100.';
  }
  const minimum = values.minPerRequest.trim() === '' ? 0 : number(values.minPerRequest);
  if (
    anyPrice &&
    (minimum === null || Number.isNaN(minimum) || minimum > PROVIDER_LIMITS.maxMinPerRequestUsd)
  ) {
    errors.minPerRequest = 'Use a number from 0 to 10.';
  }

  const rate = values.thbPerUsd.trim() === '' ? undefined : number(values.thbPerUsd);
  if (
    anyPrice &&
    rate !== undefined &&
    (rate === null || Number.isNaN(rate) || rate < 0.01 || rate > 1000)
  ) {
    errors.thbPerUsd = 'Use a number from 0.01 to 1000, for example 35 or 0.3333.';
  }

  const market = values.marketThbPerUsd.trim() === '' ? undefined : number(values.marketThbPerUsd);
  if (
    anyPrice &&
    market !== undefined &&
    (market === null || Number.isNaN(market) || market < 0.01 || market > 1000)
  ) {
    errors.marketThbPerUsd = 'Use a number from 0.01 to 1000, for example 35.';
  }

  const cap = values.monthlyCap.trim() === '' ? null : number(values.monthlyCap);
  if (cap !== null && (Number.isNaN(cap) || cap > PROVIDER_LIMITS.maxMonthlyCapUsd)) {
    errors.monthlyCap = 'Enter an amount in US dollars, for example 20.';
  } else if (
    cap !== null &&
    (input === null || output === null || Number.isNaN(input) || Number.isNaN(output))
  ) {
    errors.monthlyCap = 'Enter both prices first, so the limit can be checked.';
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };

  const request: PutProviderSettingsRequest = {
    provider: values.provider,
    model,
    ...(values.provider === 'custom' ? { baseUrl } : { baseUrl: OPENROUTER_BASE_URL }),
    ...(key === '' ? {} : { apiKey: key }),
    pricing: anyPrice
      ? {
          inputPerMillionUsd: input ?? 0,
          outputPerMillionUsd: output ?? 0,
          multiplier: multiplier ?? 1,
          minPerRequestUsd: minimum ?? 0,
          ...(rate === undefined || rate === null ? {} : { thbPerUsd: rate }),
          ...(market === undefined || market === null ? {} : { marketThbPerUsd: market }),
        }
      : null,
    monthlyCapUsd: cap,
    ...(hasSaved && saved?.version != null ? { version: saved.version } : {}),
  };
  return { ok: true, request };
}
