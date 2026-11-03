import { Link } from 'react-router';

import { EmptyState, buttonClassName } from '@creatorops/ui';

export function NotFoundNotice({
  title,
  description,
  backTo,
  backLabel,
}: {
  title: string;
  description: string;
  backTo: string;
  backLabel: string;
}) {
  return (
    <EmptyState
      title={title}
      description={description}
      action={
        <Link to={backTo} className={buttonClassName('secondary')}>
          {backLabel}
        </Link>
      }
    />
  );
}
