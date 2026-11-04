export const draftPath = (workspaceId: string, draftId: string): string =>
  `/w/${encodeURIComponent(workspaceId)}/drafts/${encodeURIComponent(draftId)}`;
