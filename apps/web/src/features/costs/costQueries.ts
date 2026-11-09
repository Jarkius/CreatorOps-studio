import { useQuery } from '@tanstack/react-query';

import { useDashboard } from '../../app/dashboard-context.js';

export const costReportKeys = {
  month: (workspaceId: string, month: string) => ['costs', workspaceId, 'report', month] as const,
};

/** The cost report of a month (`YYYY-MM`, UTC); an empty month means the current one. */
export function useCostReport(workspaceId: string, month: string) {
  const { client } = useDashboard();
  return useQuery({
    queryKey: costReportKeys.month(workspaceId, month),
    queryFn: () => client.costs.report(workspaceId, month === '' ? {} : { month }),
  });
}
