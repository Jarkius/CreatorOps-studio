/** The asset library of one workspace. */
export const assetsPath = (workspaceId: string): string =>
  `/w/${encodeURIComponent(workspaceId)}/assets`;
