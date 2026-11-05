import { useState } from 'react';
import type { FormEvent } from 'react';

import { CAMPAIGN_COST_LIMITS, DRAFT_SCENE_VALUES } from '@creatorops/contracts';
import type { CampaignCost } from '@creatorops/contracts';
import { Button, ErrorState, LoadingState, SelectField, TextField } from '@creatorops/ui';

import { describeError } from '../errors.js';
import { useAddCampaignCost, useCampaignCost, useRemoveCampaignCost } from './campaignQueries.js';
import { formatBaht, formatUsdFromBaht, parseBahtInput, SCENE_LABELS } from './costFormat.js';

const SCENE_OPTIONS = [
  { value: '', label: 'Whole campaign' },
  ...DRAFT_SCENE_VALUES.map((scene) => ({ value: scene, label: SCENE_LABELS[scene] })),
];

/** The cost of one campaign in Thai baht: AI text from the ledger plus lines typed in by hand. */
export function CampaignCostPanel(props: {
  workspaceId: string;
  campaignId: string;
  canWrite: boolean;
}) {
  const { workspaceId, campaignId, canWrite } = props;
  const query = useCampaignCost(workspaceId, campaignId);
  const add = useAddCampaignCost(workspaceId, campaignId);
  const remove = useRemoveCampaignCost(workspaceId, campaignId);
  const [label, setLabel] = useState('');
  const [scene, setScene] = useState('');
  const [amount, setAmount] = useState('');
  const [errors, setErrors] = useState<{ label?: string; amount?: string }>({});
  const [failure, setFailure] = useState<string | null>(null);

  const cost = query.data;
  if (cost === undefined) {
    if (query.isError) {
      const { message, requestId } = describeError(query.error);
      return (
        <ErrorState
          message={message}
          requestId={requestId}
          retrying={query.isFetching}
          onRetry={() => void query.refetch()}
        />
      );
    }
    return <LoadingState label="Loading cost…" />;
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setFailure(null);
    const next: { label?: string; amount?: string } = {};
    const trimmed = label.trim();
    if (trimmed === '') next.label = 'Say what the cost was for.';
    else if (trimmed.length > CAMPAIGN_COST_LIMITS.label) next.label = 'The label is too long.';
    const parsed = parseBahtInput(amount);
    if (!parsed.ok) next.amount = parsed.error;
    setErrors(next);
    if (next.label !== undefined || !parsed.ok) return;
    try {
      await add.mutateAsync({
        label: trimmed,
        amountThb: parsed.amountThb,
        ...(scene === '' ? {} : { scene: scene as (typeof DRAFT_SCENE_VALUES)[number] }),
      });
      setLabel('');
      setScene('');
      setAmount('');
    } catch (error) {
      setFailure(describeError(error).message);
    }
  };

  const removeLine = async (costId: string) => {
    setFailure(null);
    try {
      await remove.mutateAsync(costId);
    } catch (error) {
      setFailure(describeError(error).message);
    }
  };

  return (
    <div className="space-y-4 rounded-lg border border-[var(--co-border)] bg-[var(--co-surface)] p-4">
      <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-3">
        <div>
          <dt className="text-sm text-[var(--co-text-muted)]">AI text</dt>
          <dd aria-label="AI text cost" className="text-lg font-semibold">
            <Money thb={cost.aiText.costThb} rate={cost.marketThbPerUsd} />
          </dd>
          <dd className="text-sm text-[var(--co-text-muted)]">{aiDetail(cost)}</dd>
        </div>
        <div>
          <dt className="text-sm text-[var(--co-text-muted)]">Scenes and tools (typed in)</dt>
          <dd aria-label="Typed-in cost" className="text-lg font-semibold">
            <Money thb={cost.manual.totalThb} rate={cost.marketThbPerUsd} />
          </dd>
        </div>
        <div>
          <dt className="text-sm text-[var(--co-text-muted)]">Total</dt>
          <dd aria-label="Total cost" className="text-lg font-semibold">
            <Money thb={cost.totalThb} rate={cost.marketThbPerUsd} />
          </dd>
        </div>
      </dl>
      {cost.aiText.anomalies > 0 ? (
        <p role="alert" className="text-[var(--co-danger)]">
          {cost.aiText.anomalies} AI call(s) cost far more than your entered prices predict. Check
          the prices in Settings.
        </p>
      ) : null}
      <p className="text-sm text-[var(--co-text-muted)]">
        {cost.rateSource === 'settings'
          ? `AI cost is converted at ฿${String(cost.thbPerUsd)} per 1 USD of billed cost (set in Settings).`
          : `AI cost is converted at the default ฿${String(cost.thbPerUsd)} per 1 USD. Set your rate in Settings.`}{' '}
        The US$ beside each baht amount is baht ÷ ฿{String(cost.marketThbPerUsd)} per real US dollar
        (set in Settings). Meta AI scene images use your own account and cost nothing here; add what
        you paid.
      </p>

      {cost.manual.items.length === 0 ? (
        <p className="text-[var(--co-text-muted)]">No typed-in costs yet.</p>
      ) : (
        <ul aria-label="Typed-in costs" className="divide-y divide-[var(--co-border)]">
          {cost.manual.items.map((item) => (
            <li key={item.id} className="flex flex-wrap items-center gap-3 py-2">
              <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">
                {item.label}
                <span className="ml-2 text-sm text-[var(--co-text-muted)]">
                  {item.scene === null ? 'Whole campaign' : SCENE_LABELS[item.scene]}
                </span>
              </span>
              <span className="font-medium">{formatBaht(item.amountThb)}</span>
              <span className="text-sm text-[var(--co-text-muted)]">
                ≈ {formatUsdFromBaht(item.amountThb, cost.marketThbPerUsd)}
              </span>
              {canWrite ? (
                <Button
                  variant="secondary"
                  aria-label={`Remove cost ${item.label}`}
                  loading={remove.isPending && remove.variables === item.id}
                  disabled={remove.isPending}
                  onClick={() => void removeLine(item.id)}
                >
                  Remove
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {canWrite ? (
        <form onSubmit={(event) => void submit(event)} className="space-y-3" noValidate>
          <h3 className="font-medium">Add a cost</h3>
          <div className="grid gap-3 sm:grid-cols-3">
            <TextField
              label="What for"
              value={label}
              maxLength={CAMPAIGN_COST_LIMITS.label}
              onChange={(event) => setLabel(event.target.value)}
              {...(errors.label === undefined ? {} : { error: errors.label })}
            />
            <SelectField
              label="Scene"
              options={SCENE_OPTIONS}
              value={scene}
              onChange={(event) => setScene(event.target.value)}
            />
            <TextField
              label="Amount (baht)"
              inputMode="decimal"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              {...(errors.amount === undefined ? {} : { error: errors.amount })}
            />
          </div>
          <Button type="submit" loading={add.isPending}>
            {add.isPending ? 'Adding…' : 'Add cost'}
          </Button>
        </form>
      ) : null}
      {failure === null ? null : (
        <p role="alert" className="text-[var(--co-danger)]">
          {failure}
        </p>
      )}
    </div>
  );
}

/** Baht and US dollars side by side: the baht amount is the figure, the dollars are a reading aid. */
function Money(props: { thb: number; rate: number }) {
  return (
    <>
      <span>{formatBaht(props.thb)}</span>{' '}
      <span className="text-sm font-normal text-[var(--co-text-muted)]">
        ≈ {formatUsdFromBaht(props.thb, props.rate)}
      </span>
    </>
  );
}

function aiDetail(cost: CampaignCost): string {
  const calls = cost.aiText.calls;
  if (calls === 0) return 'No AI calls yet';
  return `${String(calls)} call${calls === 1 ? '' : 's'}, $${cost.aiText.costUsd.toFixed(4)} billed`;
}
