import { ApiError, type ApiClient, type Product, type Template } from '@creatorops/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef } from 'react';

import { panelKeys } from './campaignHooks.js';
import { campaignNameFor, newCreateKey } from './create.js';
import { PANEL_PRODUCT_LIMIT } from './ProductsPanel.js';

export const createKeys = {
  templates: (workspaceId: string) => ['create', 'templates', workspaceId] as const,
};

/**
 * The same query as the Products list (same key and limit), so the two panels share one request
 * and one cache entry: the form offers the newest active products listed in the panel.
 */
export function useCreateProducts(api: ApiClient, workspaceId: string) {
  return useQuery({
    queryKey: ['products', workspaceId],
    queryFn: () => api.products.list(workspaceId, { status: 'active', limit: PANEL_PRODUCT_LIMIT }),
    // A failed shared query is retried by the Products panel's own button, not on this mount.
    retryOnMount: false,
  });
}

export function useCreateTemplates(api: ApiClient, workspaceId: string) {
  return useQuery({
    queryKey: createKeys.templates(workspaceId),
    queryFn: () => api.templates.list(workspaceId),
  });
}

export interface CreateInput {
  readonly product: Product;
  readonly template: Template;
}

interface Pending {
  readonly productId: string;
  readonly templateId: string;
  readonly campaignId: string;
  readonly key: string;
}

/**
 * Creates a campaign for the product and mode, then starts its generation job. If the campaign
 * was created but starting the job failed, the next click starts the job for that same campaign
 * instead of creating a second one. The job key is reused only after a network error or timeout
 * (no response), exactly like the Generate button.
 */
export function useCreateContent(api: ApiClient, workspaceId: string) {
  const queryClient = useQueryClient();
  const pendingRef = useRef<Pending | null>(null);
  return useMutation({
    mutationFn: async ({ product, template }: CreateInput) => {
      let pending = pendingRef.current;
      if (
        pending === null ||
        pending.productId !== product.id ||
        pending.templateId !== template.id
      ) {
        const campaign = await api.campaigns.create(workspaceId, {
          productId: product.id,
          templateId: template.id,
          templateVersion: template.version,
          name: campaignNameFor(product, template),
          language: 'th',
          platform: 'tiktok',
          variants: 1,
        });
        pending = {
          productId: product.id,
          templateId: template.id,
          campaignId: campaign.id,
          key: newCreateKey(),
        };
        pendingRef.current = pending;
      }
      try {
        const job = await api.jobs.generateBrief(
          workspaceId,
          { campaignId: pending.campaignId },
          pending.key,
        );
        pendingRef.current = null;
        return { campaignId: pending.campaignId, job };
      } catch (error) {
        const noResponse =
          error instanceof ApiError && (error.code === 'NETWORK_ERROR' || error.code === 'TIMEOUT');
        // Keep the campaign for the retry; keep the key only when the request got no answer.
        if (!noResponse) pendingRef.current = { ...pending, key: newCreateKey() };
        throw error;
      }
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: panelKeys.campaigns(workspaceId) });
    },
  });
}
