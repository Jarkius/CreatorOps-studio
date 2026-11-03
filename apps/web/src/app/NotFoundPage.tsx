import { Link } from 'react-router';

import { EmptyState } from '@creatorops/ui';

export function NotFoundPage() {
  return (
    <EmptyState
      title="Page not found"
      description="This page does not exist in CreatorOps Studio."
      action={
        <Link
          to="/"
          className="inline-flex min-h-11 items-center rounded-md px-1 font-medium text-[var(--co-accent)] underline underline-offset-4"
        >
          Go to Overview
        </Link>
      }
    />
  );
}
