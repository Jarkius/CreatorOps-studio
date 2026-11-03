import { parseEnv, type EnvSource } from '@creatorops/config';
import { z } from 'zod';

function isUrlWithProtocol(value: string, protocols: readonly string[]): boolean {
  try {
    return protocols.includes(new URL(value).protocol);
  } catch {
    return false;
  }
}

function isOrigin(value: string): boolean {
  try {
    const url = new URL(value);
    return (url.protocol === 'http:' || url.protocol === 'https:') && url.origin === value;
  } catch {
    return false;
  }
}

const httpUrl = z
  .string()
  .refine((value) => isUrlWithProtocol(value, ['http:', 'https:']), 'must be an http(s) URL');

const httpOrigin = z
  .string()
  .refine(
    isOrigin,
    'must be an origin such as http://localhost:5173 (scheme, host, optional port; no path or trailing slash)',
  );

/** Environment contract for the API (docs/ARCHITECTURE.md section 12). */
export const apiEnvSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    // Loopback by default; set HOST=0.0.0.0 deliberately when running in a container.
    HOST: z.string().min(1).default('127.0.0.1'),
    RATE_LIMIT_MAX: z.coerce.number().int().min(1).max(100000).default(300),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
    DATABASE_URL: z
      .string()
      .refine(
        (value) => isUrlWithProtocol(value, ['postgres:', 'postgresql:']),
        'must be a postgres:// or postgresql:// URL',
      ),
    AUTH_MODE: z.enum(['mock']),
    API_BASE_URL: httpUrl,
    WEB_ORIGIN: httpOrigin,
    // Optional until the extension exists (S1.4). When absent, no extension origin is allowed.
    EXTENSION_ORIGIN: z
      .string()
      .regex(/^chrome-extension:\/\/[a-p]{32}$/, 'must look like chrome-extension://<32-letter id>')
      .optional(),
    SESSION_SECRET: z.string().min(32),
  })
  .superRefine((env, ctx) => {
    if (env.AUTH_MODE === 'mock' && env.NODE_ENV === 'production') {
      ctx.addIssue({
        code: 'custom',
        path: ['AUTH_MODE'],
        message: 'mock authentication is development-only and cannot run with NODE_ENV=production',
      });
    }
  });

export type ApiConfig = Readonly<z.infer<typeof apiEnvSchema>>;

export function loadConfig(env: EnvSource): ApiConfig {
  return Object.freeze(parseEnv(apiEnvSchema, env));
}
