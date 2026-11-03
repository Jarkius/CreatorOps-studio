import { useDashboard } from '../../app/dashboard-context.js';
import { useAsset, useMediaRefresh } from './assetQueries.js';

/** The product's cover as a small thumbnail. Renders nothing while loading or when there is none. */
export function CoverThumb({ workspaceId, assetId }: { workspaceId: string; assetId: string }) {
  const { client } = useDashboard();
  const asset = useAsset(workspaceId, assetId);
  const refreshMedia = useMediaRefresh(workspaceId);
  const thumbUrl = asset.data?.thumbUrl ?? null;
  if (asset.data === undefined || thumbUrl === null) return null;
  return (
    <img
      src={client.resolveUrl(thumbUrl)}
      alt={`Cover: ${asset.data.originalFilename}`}
      onError={refreshMedia}
      className="size-16 shrink-0 rounded-md border border-[var(--co-border)] object-cover"
    />
  );
}
