import { pino, type DestinationStream, type Logger } from 'pino';

import { redactValue } from './redact.js';

export type { Logger };

export interface LoggerOptions {
  readonly level: string;
  /** Defaults to stdout. Tests pass an in-memory stream. */
  readonly stream?: DestinationStream;
}

/**
 * Structured JSON logger. Every argument of every log call (object, message, interpolation
 * values) passes through redaction before pino serializes it.
 */
export function createLogger(options: LoggerOptions): Logger {
  return pino(
    {
      level: options.level,
      base: undefined,
      hooks: {
        logMethod(args, method) {
          const redacted = args.map((arg) => redactValue(arg)) as unknown as Parameters<
            typeof method
          >;
          method.apply(this, redacted);
        },
      },
    },
    options.stream,
  );
}
