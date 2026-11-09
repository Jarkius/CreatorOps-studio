export const settingsPath = (workspaceId: string): string =>
  `/w/${encodeURIComponent(workspaceId)}/settings`;
