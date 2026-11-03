import { pino, type DestinationStream, type Logger } from 'pino';

import { redactString, redactValue } from './redact.js';

export type { Logger };

export interface LoggerOptions {
  readonly level: string;
  /** Defaults to stdout. Tests pass an in-memory stream. */
  readonly stream?: DestinationStream;
}

interface RequestLike {
  readonly method?: string;
  readonly url?: string;
  readonly hostname?: string;
  readonly ip?: string;
}

interface ResponseLike {
  readonly statusCode?: number;
}

/**
 * Fastify passes its request and reply objects under `req` and `res`. Their useful fields are
 * prototype getters that a generic object walk would drop, so these two keys are reduced to a
 * fixed, safe set of fields here instead. The URL goes through string redaction because
 * signed media URLs carry their signature in the query string.
 */
function serializeRequest(request: RequestLike): Record<string, unknown> {
  return {
    method: request.method,
    url: typeof request.url === 'string' ? redactString(request.url) : undefined,
    host: request.hostname,
    remoteAddress: request.ip,
  };
}

function serializeResponse(response: ResponseLike): Record<string, unknown> {
  return { statusCode: response.statusCode };
}

function isPlainLogObject(arg: unknown): arg is Record<string, unknown> {
  return (
    typeof arg === 'object' &&
    arg !== null &&
    !Array.isArray(arg) &&
    !(arg instanceof Error) &&
    ('req' in arg || 'res' in arg)
  );
}

/** Redacts everything except `req` and `res`, which the serializers above handle. */
function redactLogArgument(arg: unknown): unknown {
  if (!isPlainLogObject(arg)) return redactValue(arg);
  const { req, res, ...rest } = arg;
  return {
    ...(redactValue(rest) as Record<string, unknown>),
    ...(req === undefined ? {} : { req }),
    ...(res === undefined ? {} : { res }),
  };
}

/**
 * Structured JSON logger. Every argument of every log call (object, message, interpolation
 * values) and every child-logger binding passes through redaction before pino serializes it.
 *
 * pino swaps the `formatters.bindings` hook for an identity function when it creates a child
 * logger, so that hook never sees child bindings. `child()` is wrapped instead; because child
 * loggers inherit from their parent, grandchildren are covered by the same wrapper.
 */
export function createLogger(options: LoggerOptions): Logger {
  const logger = pino(
    {
      level: options.level,
      base: undefined,
      serializers: { req: serializeRequest, res: serializeResponse },
      hooks: {
        logMethod(args, method) {
          const redacted = args.map(redactLogArgument) as unknown as Parameters<typeof method>;
          method.apply(this, redacted);
        },
      },
    },
    options.stream,
  );

  const originalChild = logger.child;
  logger.child = function child(this: Logger, bindings, childOptions) {
    return originalChild.call(this, redactValue(bindings) as typeof bindings, childOptions);
  } as Logger['child'];

  return logger;
}
