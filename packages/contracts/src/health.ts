import { z } from 'zod';

export const HealthResponseSchema = z.object({
  status: z.literal('ok'),
  service: z.literal('creatorops-api'),
  /** ISO 8601 timestamp from the server clock. */
  time: z.string(),
});
export type HealthResponse = z.infer<typeof HealthResponseSchema>;
