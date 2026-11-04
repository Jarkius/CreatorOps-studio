import type { ReactNode } from 'react';
import { Link, useParams } from 'react-router';

import type { Campaign } from '@creatorops/contracts';
import {
  Button,
  EmptyState,
  ErrorState,
  LoadingState,
  StatusPill,
  buttonClassName,
} from '@creatorops/ui';

import { describeError, isNotFound } from '../errors.js';
import { formatDate } from '../products/format.js';
import { NotFoundNotice } from '../products/ProductStates.js';
import { campaignPath, newCampaignPath } from './paths.js';
import { useCampaignList } from './campaignQueries.js';
import { useCanWrite } from './useCanWrite.js';

function CampaignRow({ workspaceId, campaign }: { workspaceId: string; campaign: Campaign }) {
  return (
    <li className="flex flex-wrap items-start justify-between gap-3 px-4 py-3 leading-relaxed">
      <div className="min-w-0 flex-1">
        <Link
          to={campaignPath(workspaceId, campaign.id)}
          className="font-medium text-[var(--co-accent)] underline underline-offset-4 [overflow-wrap:anywhere]"
        >
          {campaign.name}
        </Link>
      </div>
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <StatusPill status={campaign.status} />
        <time dateTime={campaign.updatedAt} className="text-[var(--co-text-muted)]">
          Updated {formatDate(campaign.updatedAt)}
        </time>
      </div>
    </li>
  );
}

export function CampaignsPage() {
  const { workspaceId = '' } = useParams();
  const list = useCampaignList(workspaceId);
  const canWrite = useCanWrite(workspaceId);
  const items = list.data?.pages.flatMap((page) => page.items) ?? [];
  const hasData = list.data !== undefined;

  if (!hasData && list.isError && isNotFound(list.error)) {
    return (
      <NotFoundNotice
        title="Workspace not found"
        description="This workspace does not exist or you cannot open it."
        backTo="/"
        backLabel="Go to Overview"
      />
    );
  }

  const createLink = (
    <Link to={newCampaignPath(workspaceId)} className={buttonClassName('primary')}>
      Create campaign
    </Link>
  );

  let content: ReactNode;
  if (!hasData && list.isError) {
    const { message, requestId } = describeError(list.error);
    content = (
      <ErrorState
        message={message}
        requestId={requestId}
        retrying={list.isFetching}
        onRetry={() => void list.refetch()}
      />
    );
  } else if (!hasData) {
    content = <LoadingState label="Loading campaigns…" />;
  } else if (items.length === 0) {
    content = (
      <EmptyState
        title="No campaigns yet"
        description="Create a campaign for a product to generate its content."
        action={canWrite ? createLink : undefined}
      />
    );
  } else {
    content = (
      <div className="space-y-4">
        {list.isError ? (
          <ErrorState
            message={describeError(list.error).message}
            requestId={describeError(list.error).requestId}
            retrying={list.isFetching}
            onRetry={() => void list.refetch()}
          />
        ) : null}
        <ul
          aria-label="Campaigns"
          className="divide-y divide-[var(--co-border)] rounded-lg border border-[var(--co-border)] bg-[var(--co-surface)]"
        >
          {items.map((campaign) => (
            <CampaignRow key={campaign.id} workspaceId={workspaceId} campaign={campaign} />
          ))}
        </ul>
        {list.hasNextPage ? (
          <Button
            variant="secondary"
            loading={list.isFetchingNextPage}
            onClick={() => void list.fetchNextPage()}
          >
            {list.isFetchingNextPage ? 'Loading more…' : 'Load more'}
          </Button>
        ) : null}
      </div>
    );
  }

  return (
    <div className="max-w-4xl space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold leading-relaxed">Campaigns</h1>
        {canWrite ? createLink : null}
      </header>
      {content}
    </div>
  );
}
