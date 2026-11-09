import { useState } from 'react';

import { EXPORT_LIMITS } from '@creatorops/contracts';
import type { DraftAsset } from '@creatorops/contracts';
import { Button } from '@creatorops/ui';

import { useDashboard } from '../../app/dashboard-context.js';
import { describeError } from '../errors.js';
import { buildAttachments } from './attachments.js';
import { useProductFiles, useSaveAttachments } from './exportQueries.js';

/**
 * Lets an editor choose which of the product's files go with the draft, and which picture is the
 * cover. Saving replaces the whole list in one call (D-067), so it can be repeated safely.
 */
export function AttachFiles({
  workspaceId,
  draftId,
  productId,
  current,
}: {
  workspaceId: string;
  draftId: string;
  productId: string;
  current: readonly DraftAsset[];
}) {
  const { client } = useDashboard();
  const [open, setOpen] = useState(false);
  const files = useProductFiles(workspaceId, productId, open);
  const save = useSaveAttachments(workspaceId, draftId);
  const [selected, setSelected] = useState<string[]>([]);
  const [cover, setCover] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const start = () => {
    setSelected(current.map((item) => item.assetId));
    setCover(current.find((item) => item.role === 'cover')?.assetId ?? null);
    setError(null);
    setSaved(false);
    setOpen(true);
  };

  const toggle = (id: string) => {
    setSelected((previous) =>
      previous.includes(id) ? previous.filter((item) => item !== id) : [...previous, id],
    );
    setCover((previous) => (previous === id ? null : previous));
  };

  const onSave = async () => {
    setError(null);
    try {
      await save.mutateAsync({ assets: buildAttachments(current, selected, cover) });
      setSaved(true);
      setOpen(false);
    } catch (failure) {
      setError(describeError(failure).message);
    }
  };

  if (!open) {
    return (
      <div className="space-y-2">
        <Button variant="secondary" onClick={start}>
          Choose files
        </Button>
        {saved ? <p role="status">Files saved</p> : null}
      </div>
    );
  }

  const items = files.data?.items ?? [];
  const full = selected.length >= EXPORT_LIMITS.maxAssetsPerDraft;
  return (
    <fieldset className="space-y-3 rounded-lg border border-[var(--co-border)] p-3">
      <legend className="px-1 font-medium">Choose the product files for this draft</legend>
      {files.isPending ? <p role="status">Loading files…</p> : null}
      {files.isError ? (
        <p role="alert" className="text-[var(--co-danger)]">
          Could not load the files: {describeError(files.error).message}
        </p>
      ) : null}
      {files.data !== undefined && items.length === 0 ? (
        <p className="text-[var(--co-text-muted)]">
          This product has no files yet. Upload them on the product page.
        </p>
      ) : null}
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {items.map((asset) => {
          const checked = selected.includes(asset.id);
          return (
            <li
              key={asset.id}
              className="space-y-1 rounded-md border border-[var(--co-border)] p-2"
            >
              {asset.thumbUrl === null ? null : (
                <img
                  src={client.resolveUrl(asset.thumbUrl)}
                  alt=""
                  className="aspect-square w-full rounded object-cover"
                />
              )}
              <label className="flex min-h-11 items-center gap-2 text-sm [overflow-wrap:anywhere]">
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={!checked && full}
                  onChange={() => toggle(asset.id)}
                />
                {asset.originalFilename}
              </label>
              {checked && asset.type === 'image' ? (
                <label className="flex min-h-11 items-center gap-2 text-sm">
                  <input
                    type="radio"
                    name="draft-cover"
                    checked={cover === asset.id}
                    onChange={() => setCover(asset.id)}
                  />
                  Cover
                </label>
              ) : null}
            </li>
          );
        })}
      </ul>
      <p className="text-sm text-[var(--co-text-muted)]">
        {selected.length} of {EXPORT_LIMITS.maxAssetsPerDraft} files chosen.
      </p>
      {error === null ? null : (
        <p role="alert" className="text-[var(--co-danger)]">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-3">
        <Button loading={save.isPending} onClick={() => void onSave()}>
          Save files
        </Button>
        <Button variant="secondary" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </fieldset>
  );
}
