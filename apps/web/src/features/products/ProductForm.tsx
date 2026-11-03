import { useEffect, useRef, useState } from 'react';
import { useFieldArray, useForm } from 'react-hook-form';
import type { FieldPath } from 'react-hook-form';

import { ApiError, PRODUCT_LIMITS } from '@creatorops/contracts';
import type { CreateProductRequest, Product, UpdateProductRequest } from '@creatorops/contracts';
import { Button, SelectField, TextAreaField, TextField } from '@creatorops/ui';

import {
  CURRENCY_OPTIONS,
  EMPTY_PRODUCT_FORM,
  RESOLVERS,
  buildDraft,
  changedFields,
  createBody,
  formFieldFor,
  valuesFromProduct,
} from './productForm.js';
import type { ProductFormValues, RowIndexes } from './productForm.js';

export interface ProductFormProps {
  mode: 'create' | 'edit';
  /** Edit mode: the product as last loaded or saved. Its version is sent with every save. */
  product?: Product;
  /** Edit mode: change this number to discard the typed values and show `product` again. */
  resetKey?: number;
  submitLabel: string;
  /** Sends the body and resolves with the saved product. Rejects with an ApiError on failure. */
  onSave: (body: CreateProductRequest | UpdateProductRequest) => Promise<Product>;
}

const GENERIC_SAVE_ERROR = 'The product could not be saved. Please try again.';

export function ProductForm({
  mode,
  product,
  resetKey = 0,
  submitLabel,
  onSave,
}: ProductFormProps) {
  const isEdit = mode === 'edit';
  const form = useForm<ProductFormValues>({
    defaultValues: product === undefined ? EMPTY_PRODUCT_FORM : valuesFromProduct(product),
    resolver: RESOLVERS[mode],
    reValidateMode: 'onChange',
  });
  const { control, register, handleSubmit, reset, setError, formState } = form;
  const { errors, isSubmitting } = formState;
  const selling = useFieldArray({ control, name: 'sellingPoints' });
  const claims = useFieldArray({ control, name: 'restrictedClaims' });

  const [notice, setNotice] = useState<'saved' | 'unchanged' | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  // The reset effect reads the latest product without re-running when it changes for other reasons.
  const productRef = useRef(product);
  useEffect(() => {
    productRef.current = product;
  });
  useEffect(() => {
    if (resetKey === 0 || productRef.current === undefined) return;
    reset(valuesFromProduct(productRef.current));
    setNotice(null);
    setFormError(null);
  }, [resetKey, reset]);

  const applyServerErrors = (error: ApiError, rows: RowIndexes) => {
    const unmapped: string[] = [];
    for (const issue of error.fields) {
      const target = formFieldFor(issue.path, rows);
      if (target === null) unmapped.push(issue.message);
      else
        setError(target as FieldPath<ProductFormValues>, {
          type: 'server',
          message: issue.message,
        });
    }
    if (error.fields.length === 0) setFormError(error.message);
    else if (unmapped.length > 0) setFormError(unmapped.join(' '));
  };

  const onValid = async (values: ProductFormValues) => {
    setFormError(null);
    setNotice(null);
    const built = buildDraft(values);
    let body: CreateProductRequest | UpdateProductRequest;
    if (isEdit) {
      if (product === undefined) return;
      const changes = changedFields(built.draft, product);
      if (Object.keys(changes).length === 0) {
        setNotice('unchanged');
        return;
      }
      body = { version: product.version, ...changes };
    } else {
      body = createBody(built.draft);
    }
    try {
      const saved = await onSave(body);
      if (isEdit) {
        reset(valuesFromProduct(saved));
        setNotice('saved');
      }
    } catch (error) {
      // A conflict is shown by the page (with "Load latest"), so the form stays quiet about it.
      if (error instanceof ApiError) {
        if (error.code === 'CONFLICT') return;
        applyServerErrors(error, built.rows);
      } else {
        setFormError(GENERIC_SAVE_ERROR);
      }
    }
  };

  const sellingFull = selling.fields.length >= PRODUCT_LIMITS.listItems;
  const claimsFull = claims.fields.length >= PRODUCT_LIMITS.listItems;

  return (
    <form
      noValidate
      aria-label={isEdit ? 'Edit product' : 'New product'}
      onSubmit={handleSubmit(onValid)}
      className="space-y-6"
    >
      {formError === null ? null : (
        <div
          role="alert"
          className="rounded-lg border border-[var(--co-danger)] p-4 leading-relaxed"
        >
          {formError}
        </div>
      )}

      <div className="space-y-5">
        <TextField
          label="Name"
          hint="Required. Up to 200 characters."
          autoComplete="off"
          error={errors.name?.message}
          {...register('name')}
        />
        <TextAreaField
          label="Description"
          rows={4}
          error={errors.description?.message}
          {...register('description')}
        />
        <TextField
          label="Source URL"
          type="url"
          inputMode="url"
          placeholder="https://"
          hint="Optional. The product page, starting with http:// or https://."
          error={errors.sourceUrl?.message}
          {...register('sourceUrl')}
        />
        <div className="grid gap-5 sm:grid-cols-2">
          <TextField
            label="Price amount"
            inputMode="decimal"
            placeholder="0.00"
            error={errors.priceAmount?.message}
            {...register('priceAmount')}
          />
          <SelectField
            label="Currency"
            options={CURRENCY_OPTIONS}
            error={errors.currency?.message}
            {...register('currency')}
          />
        </div>
      </div>

      <fieldset className="space-y-3">
        <legend className="text-base font-semibold">Selling points</legend>
        <p className="text-sm text-[var(--co-text-muted)]">
          Up to {PRODUCT_LIMITS.listItems}. Empty rows are removed when you save.
        </p>
        {selling.fields.map((field, index) => (
          <div key={field.id} className="flex items-end gap-3">
            <TextField
              className="min-w-0 flex-1"
              label={`Selling point ${index + 1}`}
              error={errors.sellingPoints?.[index]?.value?.message}
              {...register(`sellingPoints.${index}.value`)}
            />
            <Button
              variant="secondary"
              aria-label={`Remove selling point ${index + 1}`}
              onClick={() => selling.remove(index)}
            >
              Remove
            </Button>
          </div>
        ))}
        <Button
          variant="secondary"
          onClick={() => selling.append({ value: '' })}
          disabled={sellingFull}
        >
          Add selling point
        </Button>
      </fieldset>

      <div className="space-y-5">
        <TextField
          label="Target audience"
          hint="Optional. Up to 500 characters."
          error={errors.targetAudience?.message}
          {...register('targetAudience')}
        />
        <TextField
          label="Brand tone"
          hint="Optional. Up to 500 characters."
          error={errors.brandTone?.message}
          {...register('brandTone')}
        />
      </div>

      <fieldset className="space-y-3">
        <legend className="text-base font-semibold">Restricted claims</legend>
        <p className="text-sm text-[var(--co-text-muted)]">
          Claims the content must not make. Up to {PRODUCT_LIMITS.listItems}.
        </p>
        {claims.fields.map((field, index) => (
          <div key={field.id} className="flex items-end gap-3">
            <TextField
              className="min-w-0 flex-1"
              label={`Restricted claim ${index + 1}`}
              error={errors.restrictedClaims?.[index]?.value?.message}
              {...register(`restrictedClaims.${index}.value`)}
            />
            <Button
              variant="secondary"
              aria-label={`Remove restricted claim ${index + 1}`}
              onClick={() => claims.remove(index)}
            >
              Remove
            </Button>
          </div>
        ))}
        <Button
          variant="secondary"
          onClick={() => claims.append({ value: '' })}
          disabled={claimsFull}
        >
          Add restricted claim
        </Button>
      </fieldset>

      <div className="flex flex-wrap items-center gap-4">
        <Button type="submit" loading={isSubmitting} className="min-w-40">
          {isSubmitting ? 'Saving…' : submitLabel}
        </Button>
        {notice === 'saved' ? (
          <p role="status" className="font-medium text-[var(--co-success)]">
            Product saved
          </p>
        ) : null}
        {notice === 'unchanged' ? (
          <p role="status" className="text-[var(--co-text-muted)]">
            No changes to save.
          </p>
        ) : null}
      </div>
    </form>
  );
}
