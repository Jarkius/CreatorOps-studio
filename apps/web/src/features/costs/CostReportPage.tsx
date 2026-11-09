import { useState } from 'react';
import { Link, useParams } from 'react-router';

import { formatBaht, formatUsdFromBaht } from '@creatorops/contracts';
import { EmptyState, ErrorState, LoadingState, TextField } from '@creatorops/ui';

import { campaignPath } from '../campaigns/paths.js';
import { describeError } from '../errors.js';
import { useCostReport } from './costQueries.js';

/** Month the page opens on: the server's current month (empty), until the person picks another. */
export function CostReportPage() {
  const { workspaceId = '' } = useParams();
  const [month, setMonth] = useState('');
  const [monthError, setMonthError] = useState<string | null>(null);
  const report = useCostReport(workspaceId, month);

  const pick = (value: string) => {
    if (value === '') {
      setMonthError(null);
      setMonth('');
    } else if (/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) {
      setMonthError(null);
      setMonth(value);
    } else {
      setMonthError('Pick a month, for example 2026-11.');
    }
  };

  let body;
  if (report.isPending) {
    body = <LoadingState label="Loading costs…" />;
  } else if (report.isError) {
    const { message, requestId } = describeError(report.error);
    body = (
      <ErrorState
        message={message}
        requestId={requestId}
        retrying={report.isFetching}
        onRetry={() => void report.refetch()}
      />
    );
  } else {
    const data = report.data;
    const money = (thb: number) => (
      <>
        <span>{formatBaht(thb)}</span>{' '}
        <span className="text-sm text-[var(--co-text-muted)]">
          ≈ {formatUsdFromBaht(thb, data.marketThbPerUsd)}
        </span>
      </>
    );
    body =
      data.campaigns.length === 0 ? (
        <EmptyState
          title={`No costs in ${data.month}`}
          description="AI text calls and typed-in costs of this month will be listed here."
        />
      ) : (
        <div className="space-y-3">
          <dl className="grid gap-3 sm:grid-cols-3">
            <div>
              <dt className="text-sm text-[var(--co-text-muted)]">
                AI text ({data.totals.aiCalls} calls)
              </dt>
              <dd aria-label="AI text total" className="text-lg font-semibold">
                {money(data.totals.aiThb)}
              </dd>
            </div>
            <div>
              <dt className="text-sm text-[var(--co-text-muted)]">Typed in</dt>
              <dd aria-label="Typed-in total" className="text-lg font-semibold">
                {money(data.totals.manualThb)}
              </dd>
            </div>
            <div>
              <dt className="text-sm text-[var(--co-text-muted)]">Total</dt>
              <dd aria-label="Month total" className="text-lg font-semibold">
                {money(data.totals.totalThb)}
              </dd>
            </div>
          </dl>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[32rem] text-left">
              <caption className="sr-only">Cost per campaign in {data.month}</caption>
              <thead>
                <tr className="border-b border-[var(--co-border)] text-sm text-[var(--co-text-muted)]">
                  <th scope="col" className="py-2 pr-3 font-medium">
                    Campaign
                  </th>
                  <th scope="col" className="py-2 pr-3 font-medium">
                    AI calls
                  </th>
                  <th scope="col" className="py-2 pr-3 font-medium">
                    AI text
                  </th>
                  <th scope="col" className="py-2 pr-3 font-medium">
                    Typed in
                  </th>
                  <th scope="col" className="py-2 font-medium">
                    Total
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.campaigns.map((row) => (
                  <tr key={row.campaignId} className="border-b border-[var(--co-border)]">
                    <th scope="row" className="py-2 pr-3 font-normal [overflow-wrap:anywhere]">
                      <Link
                        to={campaignPath(workspaceId, row.campaignId)}
                        className="text-[var(--co-accent)] underline underline-offset-4"
                      >
                        {row.name}
                      </Link>
                    </th>
                    <td className="py-2 pr-3">{row.aiCalls}</td>
                    <td className="py-2 pr-3">{money(row.aiThb)}</td>
                    <td className="py-2 pr-3">{money(row.manualThb)}</td>
                    <td className="py-2 font-medium">{money(row.totalThb)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {data.truncated ? (
            <p role="status" className="text-sm text-[var(--co-text-muted)]">
              Showing the 100 most expensive campaigns. The totals include all of them.
            </p>
          ) : null}
          <p className="text-sm text-[var(--co-text-muted)]">
            {data.rateSource === 'settings'
              ? `AI cost is converted at ฿${String(data.thbPerUsd)} per 1 USD of billed cost`
              : `AI cost is converted at the default ฿${String(data.thbPerUsd)} per 1 USD (set your rate in Settings)`}
            ; US$ is baht ÷ ฿{String(data.marketThbPerUsd)}. Months are UTC.
          </p>
        </div>
      );
  }

  return (
    <div className="max-w-4xl space-y-6">
      <h1 className="text-2xl font-semibold">Costs</h1>
      <TextField
        label="Month"
        hint="Leave empty for this month. Format YYYY-MM."
        placeholder="2026-11"
        inputMode="numeric"
        defaultValue=""
        onChange={(event) => pick(event.target.value.trim())}
        {...(monthError === null ? {} : { error: monthError })}
      />
      <section aria-label="Cost report">{body}</section>
    </div>
  );
}
