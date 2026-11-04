import { zodResolver } from '@hookform/resolvers/zod';
import type { FieldErrors, Resolver } from 'react-hook-form';

import { CreateWorkspaceRequestSchema } from '@creatorops/contracts';
import type { CreateWorkspaceRequest, Language } from '@creatorops/contracts';

/** Limits mirror CreateWorkspaceRequestSchema (name 1-100, brand voice up to 2000). */
const NAME_MAX = 100;
const BRAND_VOICE_MAX = 2000;

export const LANGUAGE_OPTIONS: { value: Language; label: string }[] = [
  { value: 'th', label: 'Thai' },
  { value: 'en', label: 'English' },
];

/** What react-hook-form holds. Every field is a string. */
export interface WorkspaceFormValues {
  name: string;
  defaultLanguage: Language;
  brandVoice: string;
}

export const EMPTY_WORKSPACE_FORM: WorkspaceFormValues = {
  name: '',
  defaultLanguage: 'th',
  brandVoice: '',
};

/** The form fields that can carry a server field error, keyed by the API's field path. */
export const WORKSPACE_FIELDS = ['name', 'defaultLanguage', 'brandVoice'] as const;

/** Trims text; blank brand voice is sent as null, which the API accepts. */
export function createWorkspaceBody(values: WorkspaceFormValues): CreateWorkspaceRequest {
  const brandVoice = values.brandVoice.trim();
  return {
    name: values.name.trim(),
    defaultLanguage: values.defaultLanguage,
    brandVoice: brandVoice === '' ? null : brandVoice,
  };
}

const VALIDATOR = zodResolver(CreateWorkspaceRequestSchema, undefined, { raw: true });

interface Leaf {
  type?: string;
  message?: string;
}

function isLeaf(value: unknown): value is Leaf {
  return typeof value === 'object' && value !== null && 'message' in value;
}

/** Replaces the schema's technical wording with the message a person should read. */
export function friendlyMessage(field: string, type: string | undefined): string | undefined {
  if (field === 'name') {
    if (type === 'too_small') return 'Enter a workspace name.';
    if (type === 'too_big') return `Use ${NAME_MAX} characters or fewer.`;
  }
  if (field === 'brandVoice' && type === 'too_big') {
    return `Use ${BRAND_VOICE_MAX} characters or fewer.`;
  }
  if (field === 'defaultLanguage') return 'Choose a language from the list.';
  return undefined;
}

/** Client-side validation with the contracts schema, with person-friendly messages. */
export const workspaceResolver: Resolver<WorkspaceFormValues> = async (
  values,
  context,
  options,
) => {
  const result = await VALIDATOR(values as never, context as never, options as never);
  const zodErrors = (result.errors ?? {}) as Record<string, unknown>;

  const errors: Record<string, unknown> = {};
  for (const [field, leaf] of Object.entries(zodErrors)) {
    if (!isLeaf(leaf)) continue;
    errors[field] = {
      type: leaf.type ?? 'validate',
      message: friendlyMessage(field, leaf.type) ?? leaf.message ?? 'Check this value.',
    };
  }
  // RHF expects an empty `values` object when there are errors, and empty `errors` on success.
  if (Object.keys(errors).length > 0) {
    return { values: {}, errors: errors as FieldErrors<WorkspaceFormValues> };
  }
  return { values, errors: {} };
};

/** True when a server field path is one of the form's fields. */
export function isWorkspaceField(path: string): path is (typeof WORKSPACE_FIELDS)[number] {
  return (WORKSPACE_FIELDS as readonly string[]).includes(path);
}
