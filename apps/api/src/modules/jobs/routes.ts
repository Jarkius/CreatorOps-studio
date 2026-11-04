import {
  GenerateBriefJobRequestSchema,
  JobListQuerySchema,
  JobListResponseSchema,
  JobParamsSchema,
  JobSchema,
  WorkspaceParamsSchema,
} from '@creatorops/contracts';
import type {
  FastifyInstance,
  FastifyRequest,
  onRequestAsyncHookHandler,
  preValidationAsyncHookHandler,
} from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';

import type { Db } from '../../db/client.js';
import { AppError } from '../../platform/errors.js';
import type { RequestContext } from '../identity/context.js';
import type { JobQueue } from './queue.js';
import { cancelJob, createGenerateBriefJob, getJob, listJobs } from './service.js';

export interface JobRouteOptions {
  readonly db: Db;
  readonly guard: onRequestAsyncHookHandler;
  readonly scope: preValidationAsyncHookHandler;
  readonly queue: JobQueue;
  /** Per-client limit on job-creating requests per minute. */
  readonly createsPerMinute?: number;
}

function contextOf(request: FastifyRequest): RequestContext {
  if (request.workspace === null) throw new AppError('NOT_FOUND', 'Workspace not found.');
  return request.workspace;
}

// Documented for the OpenAPI document only: the service validates the value after the permission
// check, so a read-only member gets 403 whatever they send.
const IdempotencyHeaders = z.object({ 'idempotency-key': z.string().optional() });

export function registerJobRoutes(app: FastifyInstance, options: JobRouteOptions): void {
  const { db, guard, scope, queue } = options;
  const typed = app.withTypeProvider<ZodTypeProvider>();
  const base = '/api/v1/workspaces/:workspaceId/jobs';
  const common = { onRequest: guard, preValidation: scope };
  const tags = ['jobs'];
  const security = [{ bearerAuth: [] }];

  typed.post(
    `${base}/generate-brief`,
    {
      ...common,
      config: { rateLimit: { max: options.createsPerMinute ?? 20, timeWindow: '1 minute' } },
      schema: {
        tags,
        summary: 'Start generating content for a campaign (requires an Idempotency-Key header)',
        security,
        params: WorkspaceParamsSchema,
        headers: IdempotencyHeaders,
        body: GenerateBriefJobRequestSchema,
        response: { 200: JobSchema, 202: JobSchema },
      },
    },
    async (request, reply) => {
      const { job, created } = await createGenerateBriefJob(
        db,
        queue,
        request.log,
        contextOf(request),
        request.body,
        request.headers['idempotency-key'],
      );
      return reply.code(created ? 202 : 200).send(job);
    },
  );

  typed.get(
    base,
    {
      ...common,
      schema: {
        tags,
        summary: 'List jobs, newest first',
        security,
        params: WorkspaceParamsSchema,
        querystring: JobListQuerySchema,
        response: { 200: JobListResponseSchema },
      },
    },
    (request) => listJobs(db, contextOf(request), request.query),
  );

  typed.get(
    `${base}/:jobId`,
    {
      ...common,
      schema: {
        tags,
        summary: 'Get a job',
        security,
        params: JobParamsSchema,
        response: { 200: JobSchema },
      },
    },
    (request) => getJob(db, contextOf(request), request.params.jobId),
  );

  typed.post(
    `${base}/:jobId/cancel`,
    {
      ...common,
      schema: {
        tags,
        summary: 'Cancel a job',
        security,
        params: JobParamsSchema,
        response: { 200: JobSchema },
      },
    },
    (request) => cancelJob(db, contextOf(request), request.params.jobId),
  );
}
