import { z } from 'zod';

export const PRODUCT_STATUS_VALUES = ['active', 'archived'] as const;
export const ProductStatusSchema = z.enum(PRODUCT_STATUS_VALUES);
export type ProductStatus = z.infer<typeof ProductStatusSchema>;

/** Limits shared by the API and the forms, so both reject the same input (D-037). */
export const PRODUCT_LIMITS = {
  name: 200,
  description: 5000,
  sourceUrl: 2048,
  shortText: 500,
  listItems: 20,
  listItemLength: 300,
} as const;

const shortText = z.string().trim().max(PRODUCT_LIMITS.shortText);
const listItem = z.string().trim().min(1).max(PRODUCT_LIMITS.listItemLength);
const textList = z.array(listItem).max(PRODUCT_LIMITS.listItems);

/** http or https only, no embedded credentials; `javascript:` and similar are refused. */
const sourceUrl = z
  .string()
  .trim()
  .max(PRODUCT_LIMITS.sourceUrl)
  .refine((value) => {
    try {
      const url = new URL(value);
      return (
        (url.protocol === 'http:' || url.protocol === 'https:') && !url.username && !url.password
      );
    } catch {
      return false;
    }
  }, 'must be an http or https URL without credentials');

/** A non-negative decimal with at most two fraction digits, as a string (never a float). */
const priceAmount = z
  .string()
  .trim()
  .regex(/^\d{1,10}(\.\d{1,2})?$/, 'must be a non-negative amount with at most 2 decimals');
const currency = z
  .string()
  .trim()
  .regex(/^[A-Z]{3}$/, 'must be a 3-letter currency code such as THB');

export const ProductSchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  sourceUrl: z.string().nullable(),
  priceAmount: z.string().nullable(),
  currency: z.string().nullable(),
  sellingPoints: z.array(z.string()),
  targetAudience: z.string().nullable(),
  brandTone: z.string().nullable(),
  restrictedClaims: z.array(z.string()),
  primaryAssetId: z.string().nullable(),
  status: ProductStatusSchema,
  /** Increases on every change; send it back with PATCH to detect conflicting edits. */
  version: z.number().int(),
  createdAt: z.string(),
  updatedAt: z.string(),
  archivedAt: z.string().nullable(),
});
export type Product = z.infer<typeof ProductSchema>;

const priceAndCurrencyTogether = (value: { priceAmount?: unknown; currency?: unknown }) =>
  (value.priceAmount === undefined || value.priceAmount === null) ===
  (value.currency === undefined || value.currency === null);

/** POST /api/v1/workspaces/:workspaceId/products. Unknown fields are rejected. */
export const CreateProductRequestSchema = z
  .object({
    name: z.string().trim().min(1).max(PRODUCT_LIMITS.name),
    description: z.string().trim().max(PRODUCT_LIMITS.description).nullish(),
    sourceUrl: sourceUrl.nullish(),
    priceAmount: priceAmount.nullish(),
    currency: currency.nullish(),
    sellingPoints: textList.default([]),
    targetAudience: shortText.nullish(),
    brandTone: shortText.nullish(),
    restrictedClaims: textList.default([]),
  })
  .strict()
  .refine(priceAndCurrencyTogether, {
    message: 'priceAmount and currency must be given together',
    path: ['currency'],
  });
export type CreateProductRequest = z.input<typeof CreateProductRequestSchema>;

/**
 * PATCH body: any subset of the editable fields plus the `version` the client last saw. A field
 * set to null is cleared. A stale version is answered with 409 and the current version.
 */
export const UpdateProductRequestSchema = z
  .object({
    version: z.number().int().min(1),
    name: z.string().trim().min(1).max(PRODUCT_LIMITS.name).optional(),
    description: z.string().trim().max(PRODUCT_LIMITS.description).nullable().optional(),
    sourceUrl: sourceUrl.nullable().optional(),
    priceAmount: priceAmount.nullable().optional(),
    currency: currency.nullable().optional(),
    sellingPoints: textList.optional(),
    targetAudience: shortText.nullable().optional(),
    brandTone: shortText.nullable().optional(),
    restrictedClaims: textList.optional(),
    /** The cover image: an image asset of this workspace, or null to clear it. */
    primaryAssetId: z.string().max(64).nullable().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).some((key) => key !== 'version'), {
    message: 'give at least one field to change',
    path: ['version'],
  });
export type UpdateProductRequest = z.input<typeof UpdateProductRequestSchema>;

/** GET /api/v1/workspaces/:workspaceId/products query string. */
export const ProductListQuerySchema = z
  .object({
    status: ProductStatusSchema.default('active'),
    limit: z.coerce.number().int().min(1).max(100).default(25),
    cursor: z.string().max(300).optional(),
  })
  .strict();
/** What clients may send (limit may be a string in a URL). */
export type ProductListQuery = z.input<typeof ProductListQuerySchema>;
/** What the API sees after parsing and defaults. */
export type ProductListQueryParsed = z.infer<typeof ProductListQuerySchema>;

export const ProductListResponseSchema = z.object({
  items: z.array(ProductSchema),
  /** Pass back as `cursor` for the next page; null when there are no more. */
  nextCursor: z.string().nullable(),
});
export type ProductListResponse = z.infer<typeof ProductListResponseSchema>;

export const ProductParamsSchema = z.object({ workspaceId: z.string(), productId: z.string() });
