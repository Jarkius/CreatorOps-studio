export const costsPath = (workspaceId: string): string =>
  `/w/${encodeURIComponent(workspaceId)}/costs`;
