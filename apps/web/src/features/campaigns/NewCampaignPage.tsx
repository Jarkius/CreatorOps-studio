import type { ReactNode } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';

import type { Campaign, CreateCampaignRequest } from '@creatorops/contracts';
import { EmptyState, ErrorState, LoadingState, buttonClassName } from '@creatorops/ui';

import { describeError } from '../errors.js';
import { productsPath } from '../products/paths.js';
import { useWorkspaces } from '../workspaces/useWorkspaces.js';
import { CampaignForm } from './CampaignForm.js';
import { campaignPath, campaignsPath } from './paths.js';
import { useActiveProductOptions, useCreateCampaign, useTemplates } from './campaignQueries.js';
import { useCanWrite } from './useCanWrite.js';

export function NewCampaignPage() {
  const { workspaceId = '' } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const workspaces = useWorkspaces();
  const canWrite = useCanWrite(workspaceId);
  const templates = useTemplates(workspaceId);
  const products = useActiveProductOptions(workspaceId);
  const create = useCreateCampaign(workspaceId);

  const save = async (body: CreateCampaignRequest): Promise<Campaign> => {
    const campaign = await create.mutateAsync(body);
    navigate(campaignPath(workspaceId, campaign.id));
    return campaign;
  };

  let body: ReactNode;
  if (workspaces.data === undefined) {
    body = workspaces.isError ? (
      <ErrorState
        message={describeError(workspaces.error).message}
        requestId={describeError(workspaces.error).requestId}
        onRetry={() => void workspaces.refetch()}
      />
    ) : (
      <LoadingState label="Loading…" />
    );
  } else if (!canWrite) {
    body = (
      <EmptyState
        title="You do not have permission to create campaigns."
        description="Ask a workspace owner, admin or editor to create the campaign."
        action={
          <Link to={campaignsPath(workspaceId)} className={buttonClassName('secondary')}>
            Back to campaigns
          </Link>
        }
      />
    );
  } else if (templates.isError || products.isError) {
    const failure = templates.isError ? templates.error : products.error;
    const { message, requestId } = describeError(failure);
    body = (
      <ErrorState
        message={message}
        requestId={requestId}
        retrying={templates.isFetching || products.isFetching}
        onRetry={() => {
          void templates.refetch();
          void products.refetch();
        }}
      />
    );
  } else if (templates.data === undefined || products.data === undefined) {
    body = <LoadingState label="Loading campaign options…" />;
  } else if (products.data.items.length === 0) {
    body = (
      <EmptyState
        title="Create a product first"
        description="A campaign is made for an active product."
        action={
          <Link to={productsPath(workspaceId)} className={buttonClassName('primary')}>
            Go to products
          </Link>
        }
      />
    );
  } else {
    body = (
      <CampaignForm
        products={products.data.items}
        templates={templates.data.items}
        defaultProductId={searchParams.get('productId') ?? ''}
        onSave={save}
      />
    );
  }

  return (
    <div className="max-w-3xl space-y-6">
      <header className="space-y-2">
        <Link
          to={campaignsPath(workspaceId)}
          className="inline-flex min-h-11 items-center text-[var(--co-accent)] underline underline-offset-4"
        >
          Back to campaigns
        </Link>
        <h1 className="text-2xl font-semibold leading-relaxed">New campaign</h1>
      </header>
      {body}
    </div>
  );
}
