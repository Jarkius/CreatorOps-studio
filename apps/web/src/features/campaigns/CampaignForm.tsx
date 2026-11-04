import { useState } from 'react';
import { useForm } from 'react-hook-form';
import type { FieldPath } from 'react-hook-form';

import { ApiError, CONTENT_LIMITS } from '@creatorops/contracts';
import type { Campaign, CreateCampaignRequest, Product, Template } from '@creatorops/contracts';
import { Button, SelectField, TextField } from '@creatorops/ui';

import { describeError } from '../errors.js';
import {
  EMPTY_CAMPAIGN_FORM,
  LANGUAGE_OPTIONS,
  PLATFORM_OPTIONS,
  VARIANT_OPTIONS,
  buildCreateCampaignBody,
  durationError,
} from './campaignForm.js';
import type { CampaignFormValues } from './campaignForm.js';

export interface CampaignFormProps {
  products: Product[];
  templates: Template[];
  /** Preselected product (from ?productId=). Ignored unless it is one of `products`. */
  defaultProductId: string;
  /** Sends the body and resolves with the created campaign. Rejects with an ApiError on failure. */
  onSave: (body: CreateCampaignRequest) => Promise<Campaign>;
}

/** Server paths that have an input in this form. templateVersion is shown on the template select. */
const FORM_FIELDS = new Set<string>([
  'productId',
  'templateId',
  'platform',
  'variants',
  'language',
  'durationSeconds',
  'tone',
  'name',
]);

export function CampaignForm({ products, templates, defaultProductId, onSave }: CampaignFormProps) {
  const initialProductId = products.some((product) => product.id === defaultProductId)
    ? defaultProductId
    : '';
  const form = useForm<CampaignFormValues>({
    defaultValues: { ...EMPTY_CAMPAIGN_FORM, productId: initialProductId },
  });
  const { register, handleSubmit, setError, watch, formState } = form;
  const { errors, isSubmitting } = formState;
  const [formError, setFormError] = useState<string | null>(null);

  const templateId = watch('templateId');
  const template = templates.find((item) => item.id === templateId);

  const applyServerErrors = (error: unknown) => {
    if (!(error instanceof ApiError) || error.fields.length === 0) {
      setFormError(describeError(error).message);
      return;
    }
    const unmapped: string[] = [];
    for (const issue of error.fields) {
      const field = issue.path === 'templateVersion' ? 'templateId' : issue.path;
      if (FORM_FIELDS.has(field)) {
        setError(field as FieldPath<CampaignFormValues>, {
          type: 'server',
          message: issue.message,
        });
      } else {
        unmapped.push(issue.message);
      }
    }
    if (unmapped.length > 0) setFormError(describeError(error).message);
  };

  const onValid = async (values: CampaignFormValues) => {
    setFormError(null);
    const chosen = templates.find((item) => item.id === values.templateId);
    if (chosen === undefined) return;
    try {
      await onSave(buildCreateCampaignBody(values, chosen));
    } catch (error) {
      applyServerErrors(error);
    }
  };

  return (
    <form
      noValidate
      aria-label="New campaign"
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

      <SelectField
        label="Product"
        options={[
          { value: '', label: 'Choose a product' },
          ...products.map((product) => ({ value: product.id, label: product.name })),
        ]}
        error={errors.productId?.message}
        {...register('productId', { required: 'Choose a product.' })}
      />

      <SelectField
        label="Template"
        options={[
          { value: '', label: 'Choose a template' },
          ...templates.map((item) => ({
            value: item.id,
            label: `${item.name.en} (${item.name.th})`,
          })),
        ]}
        hint={template?.description.en}
        error={errors.templateId?.message}
        {...register('templateId', { required: 'Choose a template.' })}
      />

      <div className="grid gap-5 sm:grid-cols-2">
        <SelectField
          label="Platform"
          options={PLATFORM_OPTIONS}
          error={errors.platform?.message}
          {...register('platform')}
        />
        <SelectField
          label="Variants"
          hint="How many drafts to write for this campaign."
          options={VARIANT_OPTIONS}
          error={errors.variants?.message}
          {...register('variants')}
        />
        <SelectField
          label="Language"
          options={LANGUAGE_OPTIONS}
          error={errors.language?.message}
          {...register('language')}
        />
        <TextField
          label="Duration seconds"
          inputMode="numeric"
          placeholder={template === undefined ? undefined : String(template.defaultDurationSeconds)}
          hint={`Optional. From ${CONTENT_LIMITS.durationSeconds.min} to ${CONTENT_LIMITS.durationSeconds.max} seconds.`}
          error={errors.durationSeconds?.message}
          {...register('durationSeconds', {
            validate: (value) => durationError(value) ?? true,
          })}
        />
      </div>

      <TextField
        label="Tone"
        hint={`Optional. Up to ${CONTENT_LIMITS.tone} characters.`}
        error={errors.tone?.message}
        {...register('tone', {
          validate: (value) =>
            value.trim().length <= CONTENT_LIMITS.tone ||
            `Use ${CONTENT_LIMITS.tone} characters or fewer.`,
        })}
      />

      <TextField
        label="Name"
        hint={`Optional. Up to ${CONTENT_LIMITS.campaignName} characters.`}
        error={errors.name?.message}
        {...register('name', {
          validate: (value) =>
            value.trim().length <= CONTENT_LIMITS.campaignName ||
            `Use ${CONTENT_LIMITS.campaignName} characters or fewer.`,
        })}
      />

      <div className="flex flex-wrap items-center gap-4">
        <Button type="submit" loading={isSubmitting} className="min-w-40">
          {isSubmitting ? 'Creating…' : 'Create campaign'}
        </Button>
      </div>
    </form>
  );
}
