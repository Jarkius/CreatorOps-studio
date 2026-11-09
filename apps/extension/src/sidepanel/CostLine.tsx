import type { ApiClient } from '@creatorops/contracts';
import { formatBaht, formatUsdFromBaht } from '@creatorops/contracts';

import { usePanelCampaignCost } from './campaignHooks.js';

/** One line under a campaign: what it cost so far in baht, with US dollars beside it. */
export function CostLine({
  api,
  workspaceId,
  campaignId,
  jobKey,
}: {
  api: ApiClient;
  workspaceId: string;
  campaignId: string;
  jobKey: string;
}) {
  const cost = usePanelCampaignCost(api, workspaceId, campaignId, jobKey);
  if (cost.isPending) {
    return <p className="mt-1 text-sm text-[var(--co-text-muted)]">Cost: loading…</p>;
  }
  if (cost.isError) {
    return <p className="mt-1 text-sm text-[var(--co-text-muted)]">Cost unavailable</p>;
  }
  const { totalThb, marketThbPerUsd, aiText, manual } = cost.data;
  return (
    <p className="mt-1 text-sm [overflow-wrap:anywhere]" aria-label="Campaign cost">
      <span className="text-[var(--co-text-muted)]">Cost: </span>
      <span className="font-medium">{formatBaht(totalThb)}</span>{' '}
      <span className="text-[var(--co-text-muted)]">
        ≈ {formatUsdFromBaht(totalThb, marketThbPerUsd)} · AI {formatBaht(aiText.costThb)}
        {manual.items.length > 0 ? ` · typed in ${formatBaht(manual.totalThb)}` : ''}
      </span>
    </p>
  );
}
