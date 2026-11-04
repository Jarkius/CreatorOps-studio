import type { Job } from '@creatorops/contracts';

/** How many of the newest non-archived campaigns the panel shows. */
export const PANEL_CAMPAIGN_LIMIT = 10;

/** Owner, admin and editor may start generation (the same roles as the dashboard `useCanWrite`). */
export function canStartGeneration(role: string | undefined): boolean {
  return role === 'owner' || role === 'admin' || role === 'editor';
}

/** True while any listed job is still queued or running, so the panel must keep polling. */
export function hasActiveJob(jobs: readonly Job[]): boolean {
  return jobs.some((job) => job.status === 'queued' || job.status === 'running');
}

/** Plain text for a job's state. Failure text is the API's safe message (never a raw error). */
export function jobStatusText(job: Job): string {
  switch (job.status) {
    case 'queued':
      return 'Waiting to start';
    case 'running':
      return `Writing your content… attempt ${job.attempts} of ${job.maxAttempts}`;
    case 'succeeded':
      return 'Done. Review the drafts in the dashboard.';
    case 'failed':
      return job.errorMessage ?? 'The job failed.';
    case 'cancelled':
      return 'Cancelled';
  }
}

/** One key per user action, as the API requires (8 to 128 letters, digits, `_` or `-`). */
export function newExtensionIdempotencyKey(): string {
  return `ext-${crypto.randomUUID()}`;
}

/** Dashboard path of a campaign page, where its drafts are edited. */
export function dashboardCampaignPath(workspaceId: string, campaignId: string): string {
  return `/w/${encodeURIComponent(workspaceId)}/campaigns/${encodeURIComponent(campaignId)}`;
}

/** Dashboard path of the new-campaign form. */
export function dashboardNewCampaignPath(workspaceId: string): string {
  return `/w/${encodeURIComponent(workspaceId)}/campaigns/new`;
}

/** Dashboard path of the campaign list. */
export function dashboardCampaignsPath(workspaceId: string): string {
  return `/w/${encodeURIComponent(workspaceId)}/campaigns`;
}
