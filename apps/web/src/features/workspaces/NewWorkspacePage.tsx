import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useNavigate } from 'react-router';

import { ApiError } from '@creatorops/contracts';
import {
  Button,
  ErrorState,
  SelectField,
  TextAreaField,
  TextField,
  buttonClassName,
} from '@creatorops/ui';

import { productsPath } from '../products/paths.js';
import { useCreateWorkspace } from './useWorkspaces.js';
import {
  EMPTY_WORKSPACE_FORM,
  LANGUAGE_OPTIONS,
  createWorkspaceBody,
  isWorkspaceField,
  workspaceResolver,
} from './workspaceForm.js';
import type { WorkspaceFormValues } from './workspaceForm.js';

const GENERIC_SAVE_ERROR = 'The workspace could not be created. Please try again.';

interface FormProblem {
  message: string;
  requestId?: string;
  /** A workspace limit (409) is shown as a plain alert, without a support reference. */
  limit: boolean;
}

export function NewWorkspacePage() {
  const navigate = useNavigate();
  const create = useCreateWorkspace();
  const form = useForm<WorkspaceFormValues>({
    defaultValues: EMPTY_WORKSPACE_FORM,
    resolver: workspaceResolver,
    reValidateMode: 'onChange',
  });
  const { register, handleSubmit, setError, formState } = form;
  const { errors, isSubmitting } = formState;
  const [problem, setProblem] = useState<FormProblem | null>(null);

  const onValid = async (values: WorkspaceFormValues) => {
    setProblem(null);
    try {
      const workspace = await create.mutateAsync(createWorkspaceBody(values));
      navigate(productsPath(workspace.id));
    } catch (error) {
      if (!(error instanceof ApiError)) {
        setProblem({ message: GENERIC_SAVE_ERROR, limit: false });
        return;
      }
      if (error.code === 'CONFLICT') {
        setProblem({ message: error.message, limit: true });
        return;
      }
      const unmapped: string[] = [];
      for (const issue of error.fields) {
        if (isWorkspaceField(issue.path)) {
          setError(issue.path, { type: 'server', message: issue.message });
        } else {
          unmapped.push(issue.message);
        }
      }
      if (error.fields.length === 0 || unmapped.length > 0) {
        setProblem({
          message: unmapped.length > 0 ? unmapped.join(' ') : error.message,
          requestId: error.requestId,
          limit: false,
        });
      }
    }
  };

  return (
    <div className="max-w-2xl space-y-6">
      <header>
        <h1 className="text-2xl font-semibold leading-relaxed">New workspace</h1>
        <p className="mt-1 text-[var(--co-text-muted)]">
          A workspace holds the products, assets and drafts of one brand or team.
        </p>
      </header>

      {problem === null ? null : problem.limit ? (
        <div
          role="alert"
          className="rounded-lg border border-[var(--co-danger)] p-4 leading-relaxed"
        >
          {problem.message}
        </div>
      ) : (
        <ErrorState message={problem.message} requestId={problem.requestId} />
      )}

      <form
        noValidate
        aria-label="New workspace"
        onSubmit={handleSubmit(onValid)}
        className="space-y-5"
      >
        <TextField
          label="Name"
          hint="Required. Up to 100 characters."
          autoComplete="off"
          error={errors.name?.message}
          {...register('name')}
        />
        <SelectField
          label="Default language"
          options={LANGUAGE_OPTIONS}
          error={errors.defaultLanguage?.message}
          {...register('defaultLanguage')}
        />
        <TextAreaField
          label="Brand voice (optional)"
          hint="How your content should sound"
          rows={4}
          error={errors.brandVoice?.message}
          {...register('brandVoice')}
        />

        <div className="flex flex-wrap items-center gap-4">
          <Button type="submit" loading={isSubmitting} className="min-w-40">
            {isSubmitting ? 'Creating…' : 'Create workspace'}
          </Button>
          <Link to="/" className={buttonClassName('secondary')}>
            Cancel
          </Link>
        </div>
      </form>
    </div>
  );
}
