import { Button, ErrorState, LoadingState } from '@creatorops/ui';

import { describeError } from '../errors.js';
import { useAcknowledgeAnomalies, useUsage } from './settingsQueries.js';

export const formatUsd = (value: number): string => `$${value.toFixed(value >= 1 ? 2 : 4)}`;

/** This month's real-provider calls and cost, and how much of the monthly limit is used. */
export function UsagePanel({
  workspaceId,
  canManage,
}: {
  workspaceId: string;
  canManage: boolean;
}) {
  const usage = useUsage(workspaceId);
  const acknowledge = useAcknowledgeAnomalies(workspaceId);
  if (usage.isPending) return <LoadingState label="Loading usage…" />;
  if (usage.isError) {
    const { message, requestId } = describeError(usage.error);
    return (
      <ErrorState
        message={message}
        requestId={requestId}
        retrying={usage.isFetching}
        onRetry={() => void usage.refetch()}
      />
    );
  }
  const data = usage.data;
  const percent =
    data.capUsd === null || data.capUsd === 0
      ? null
      : Math.min(100, Math.round((data.countedUsd / data.capUsd) * 100));
  return (
    <div className="space-y-3">
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label={`Calls in ${data.month}`} value={String(data.calls)} />
        <Stat label="Spent" value={formatUsd(data.spentUsd)} />
        <Stat label="Set aside" value={formatUsd(data.reservedUsd)} />
        <Stat
          label="Monthly limit"
          value={data.capUsd === null ? 'None' : formatUsd(data.capUsd)}
        />
      </dl>
      {percent === null ? null : (
        <div>
          <progress
            max={100}
            value={percent}
            aria-label="Monthly limit used"
            className="h-3 w-full"
          />
          <p className="text-sm text-[var(--co-text-muted)]">{percent}% of the limit is used.</p>
        </div>
      )}
      {data.costHold ? (
        <div role="alert" className="space-y-2 text-sm leading-relaxed text-[var(--co-danger)]">
          <p>
            New AI calls are paused: a call cost much more than your prices predict. Check the
            prices you entered and the plan you pay for, then continue.
          </p>
          {canManage ? (
            <Button
              variant="secondary"
              disabled={acknowledge.isPending}
              onClick={() => acknowledge.mutate()}
            >
              {acknowledge.isPending ? 'Continuing…' : 'I checked it, continue'}
            </Button>
          ) : (
            <p>Ask an owner or admin to continue.</p>
          )}
          {acknowledge.isError ? <p>{describeError(acknowledge.error).message}</p> : null}
        </div>
      ) : null}
      {data.anomalies > 0 ? (
        <p role="status" className="text-sm leading-relaxed text-[var(--co-danger)]">
          {data.anomalies} call{data.anomalies === 1 ? '' : 's'} cost much more than your prices
          predict. Check the prices you entered, or the plan you pay for.
        </p>
      ) : null}
      {data.byModel.length === 0 ? (
        <p className="text-[var(--co-text-muted)]">
          No real-provider calls yet this month. The built-in test writer is free.
        </p>
      ) : (
        <table className="w-full text-left text-sm">
          <caption className="sr-only">Cost by model</caption>
          <thead>
            <tr>
              <th className="py-1 pr-3">Model</th>
              <th className="py-1 pr-3">Calls</th>
              <th className="py-1">Cost</th>
            </tr>
          </thead>
          <tbody>
            {data.byModel.map((row) => (
              <tr key={`${row.provider}:${row.model}`}>
                <td className="py-1 pr-3 [overflow-wrap:anywhere]">{row.model}</td>
                <td className="py-1 pr-3">{row.calls}</td>
                <td className="py-1">{formatUsd(row.costUsd)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-[var(--co-border)] p-3">
      <dt className="text-sm text-[var(--co-text-muted)]">{label}</dt>
      <dd className="text-lg font-semibold">{value}</dd>
    </div>
  );
}
