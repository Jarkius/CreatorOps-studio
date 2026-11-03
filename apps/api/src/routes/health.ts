import { HealthResponseSchema } from '@creatorops/contracts';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';

export function registerHealthRoutes(app: FastifyInstance): void {
  app.withTypeProvider<ZodTypeProvider>().get(
    '/api/v1/health',
    {
      schema: {
        tags: ['system'],
        summary: 'Liveness check',
        response: { 200: HealthResponseSchema },
      },
    },
    () => ({
      status: 'ok' as const,
      service: 'creatorops-api' as const,
      time: new Date().toISOString(),
    }),
  );
}
