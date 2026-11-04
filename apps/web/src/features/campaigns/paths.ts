export const campaignsPath = (workspaceId: string): string =>
  `/w/${encodeURIComponent(workspaceId)}/campaigns`;

export const newCampaignPath = (workspaceId: string): string => `${campaignsPath(workspaceId)}/new`;

export const campaignPath = (workspaceId: string, campaignId: string): string =>
  `${campaignsPath(workspaceId)}/${encodeURIComponent(campaignId)}`;
