import { zodResolver } from '@hookform/resolvers/zod';
import type { FieldErrors, Resolver } from 'react-hook-form';

import {
  CreateProductRequestSchema,
  PRODUCT_LIMITS,
  UpdateProductRequestSchema,
} from '@creatorops/contracts';
import type { CreateProductRequest, Product } from '@creatorops/contracts';

export const CURRENCY_CODES = ['THB', 'USD', 'EUR', 'JPY'] as const;

/** The select's options. The empty value means "No price". */
export const CURRENCY_OPTIONS = [
  { value: '', label: 'No price' },
  ...CURRENCY_CODES.map((code) => ({ value: code, label: code })),
];

/** What react-hook-form holds. Every field is a string; lists are wrapped as {value} rows. */
export interface ProductFormValues {
  name: string;
  description: string;
  sourceUrl: string;
  priceAmount: string;
  currency: string;
  sellingPoints: { value: string }[];
  targetAudience: string;
  brandTone: string;
  restrictedClaims: { value: string }[];
}

export const EMPTY_PRODUCT_FORM: ProductFormValues = {
  name: '',
  description: '',
  sourceUrl: '',
  priceAmount: '',
  currency: '',
  sellingPoints: [],
  targetAudience: '',
  brandTone: '',
  restrictedClaims: [],
};

/** The canonical body fields: trimmed, empty text is null, blank list rows are gone. */
export interface ProductDraft {
  name: string;
  description: string | null;
  sourceUrl: string | null;
  priceAmount: string | null;
  currency: string | null;
  sellingPoints: string[];
  targetAudience: string | null;
  brandTone: string | null;
  restrictedClaims: string[];
}

type ListKey = 'sellingPoints' | 'restrictedClaims';

/** For each kept list item, the index of its form row (so server paths can be shown on the row). */
export interface RowIndexes {
  sellingPoints: number[];
  restrictedClaims: number[];
}

interface BuiltDraft {
  draft: ProductDraft;
  rows: RowIndexes;
  priceErrors: { priceAmount?: string; currency?: string };
}

const PRICE_TOGETHER_MESSAGE = {
  currency: 'Choose a currency for this price.',
  priceAmount: 'Enter a price, or set Currency to "No price".',
} as const;

function blankToNull(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

function keepRows(rows: { value: string }[]): { items: string[]; index: number[] } {
  const items: string[] = [];
  const index: number[] = [];
  rows.forEach((row, position) => {
    const trimmed = row.value.trim();
    if (trimmed !== '') {
      items.push(trimmed);
      index.push(position);
    }
  });
  return { items, index };
}

/** Turns form values into the canonical draft. A price without a currency (or the reverse) is flagged. */
export function buildDraft(values: ProductFormValues): BuiltDraft {
  let priceAmount = blankToNull(values.priceAmount);
  let currency = blankToNull(values.currency);
  const priceErrors: BuiltDraft['priceErrors'] = {};
  if (priceAmount !== null && currency === null) {
    priceErrors.currency = PRICE_TOGETHER_MESSAGE.currency;
  } else if (priceAmount === null && currency !== null) {
    priceErrors.priceAmount = PRICE_TOGETHER_MESSAGE.priceAmount;
  }
  if (Object.keys(priceErrors).length > 0) {
    // Keep the rest of the draft valid so only the price message is shown for this problem.
    priceAmount = null;
    currency = null;
  }
  const selling = keepRows(values.sellingPoints);
  const claims = keepRows(values.restrictedClaims);
  return {
    draft: {
      name: values.name.trim(),
      description: blankToNull(values.description),
      sourceUrl: blankToNull(values.sourceUrl),
      priceAmount,
      currency,
      sellingPoints: selling.items,
      targetAudience: blankToNull(values.targetAudience),
      brandTone: blankToNull(values.brandTone),
      restrictedClaims: claims.items,
    },
    rows: { sellingPoints: selling.index, restrictedClaims: claims.index },
    priceErrors,
  };
}

export function valuesFromProduct(product: Product): ProductFormValues {
  return {
    name: product.name,
    description: product.description ?? '',
    sourceUrl: product.sourceUrl ?? '',
    priceAmount: product.priceAmount ?? '',
    currency: product.currency ?? '',
    sellingPoints: product.sellingPoints.map((value) => ({ value })),
    targetAudience: product.targetAudience ?? '',
    brandTone: product.brandTone ?? '',
    restrictedClaims: product.restrictedClaims.map((value) => ({ value })),
  };
}

function draftFromProduct(product: Product): ProductDraft {
  return {
    name: product.name,
    description: product.description,
    sourceUrl: product.sourceUrl,
    priceAmount: product.priceAmount,
    currency: product.currency,
    sellingPoints: product.sellingPoints,
    targetAudience: product.targetAudience,
    brandTone: product.brandTone,
    restrictedClaims: product.restrictedClaims,
  };
}

/** The fields that differ from the product as last loaded. */
export function changedFields(draft: ProductDraft, product: Product): Partial<ProductDraft> {
  const base = draftFromProduct(product);
  const changes: Record<string, unknown> = {};
  for (const key of Object.keys(draft) as (keyof ProductDraft)[]) {
    if (JSON.stringify(draft[key]) !== JSON.stringify(base[key])) changes[key] = draft[key];
  }
  return changes as Partial<ProductDraft>;
}

export function createBody(draft: ProductDraft): CreateProductRequest {
  return { ...draft };
}

const CREATE_VALIDATOR = zodResolver(CreateProductRequestSchema, undefined, { raw: true });
const UPDATE_VALIDATOR = zodResolver(UpdateProductRequestSchema, undefined, { raw: true });

// Validation only. The real version is sent at save time; any positive number passes the schema.
const VALIDATION_VERSION = 1;

const LABELS: Record<string, string> = {
  name: 'Name',
  description: 'Description',
  sourceUrl: 'Source URL',
  priceAmount: 'Price amount',
  currency: 'Currency',
  targetAudience: 'Target audience',
  brandTone: 'Brand tone',
};

interface Leaf {
  type?: string;
  message?: string;
}

function isLeaf(value: unknown): value is Leaf {
  return typeof value === 'object' && value !== null && 'message' in value;
}

/** Replaces the schema's technical wording with the message a person should read. */
export function friendlyMessage(field: string, type: string | undefined, message: string): string {
  const max = (limit: number) => `Use ${limit} characters or fewer.`;
  if (type === 'too_big') {
    switch (field) {
      case 'name':
        return max(PRODUCT_LIMITS.name);
      case 'description':
        return max(PRODUCT_LIMITS.description);
      case 'sourceUrl':
        return max(PRODUCT_LIMITS.sourceUrl);
      case 'targetAudience':
      case 'brandTone':
        return max(PRODUCT_LIMITS.shortText);
      case 'sellingPoints':
      case 'restrictedClaims':
        return max(PRODUCT_LIMITS.listItemLength);
      default:
        return message;
    }
  }
  if (field === 'name' && type === 'too_small') return 'Enter a product name.';
  if (field === 'sourceUrl') {
    return 'Use a full link that starts with http:// or https://, without a username or password.';
  }
  if (field === 'priceAmount') {
    return 'Use digits with at most two decimal places, for example 990 or 99.50.';
  }
  if (field === 'currency') return 'Choose a currency from the list.';
  return message;
}

function leafError(field: string, leaf: Leaf) {
  return {
    type: leaf.type ?? 'validate',
    message: friendlyMessage(field, leaf.type, leaf.message ?? 'Check this value.'),
  };
}

function remapListErrors(list: ListKey, errors: unknown, rowIndexes: number[]) {
  const out: Record<number, { value: { type: string; message: string } }> = {};
  for (const [position, leaf] of Object.entries(errors as Record<string, unknown>)) {
    const row = rowIndexes[Number(position)];
    if (row === undefined || !isLeaf(leaf)) continue;
    out[row] = { value: leafError(list, leaf) };
  }
  return out;
}

/** Map a server field path (for example "sellingPoints.2") to the react-hook-form path of its input. */
export function formFieldFor(serverPath: string, rows: RowIndexes): string | null {
  const listMatch = /^(sellingPoints|restrictedClaims)\.(\d+)$/.exec(serverPath);
  if (listMatch !== null) {
    const key = listMatch[1] as ListKey;
    const row = rows[key][Number(listMatch[2])];
    return row === undefined ? null : `${key}.${row}.value`;
  }
  return serverPath in LABELS ? serverPath : null;
}

function makeResolver(mode: 'create' | 'edit'): Resolver<ProductFormValues> {
  const validate = mode === 'create' ? CREATE_VALIDATOR : UPDATE_VALIDATOR;
  return async (values, context, options) => {
    const built = buildDraft(values);
    const payload =
      mode === 'create' ? built.draft : { version: VALIDATION_VERSION, ...built.draft };
    const result = await validate(payload as never, context as never, options as never);
    const zodErrors = (result.errors ?? {}) as Record<string, unknown>;

    const errors: Record<string, unknown> = {};
    for (const [key, message] of Object.entries(built.priceErrors)) {
      errors[key] = { type: 'validate', message };
    }
    for (const [key, value] of Object.entries(zodErrors)) {
      if (key in built.priceErrors) continue;
      if (key === 'sellingPoints' || key === 'restrictedClaims') {
        errors[key] = remapListErrors(key, value, built.rows[key]);
      } else if (isLeaf(value)) {
        errors[key] = leafError(key, value);
      }
    }
    // RHF expects an empty `values` object when there are errors, and empty `errors` on success.
    if (Object.keys(errors).length > 0) {
      return { values: {}, errors: errors as FieldErrors<ProductFormValues> };
    }
    return { values, errors: {} };
  };
}

export const RESOLVERS = {
  create: makeResolver('create'),
  edit: makeResolver('edit'),
} as const;
