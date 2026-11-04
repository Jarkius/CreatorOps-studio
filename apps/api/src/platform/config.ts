import { parseEnv, type EnvSource } from '@creatorops/config';
import { z } from 'zod';

const LOOPBACK_HOSTS: ReadonlySet<string> = new Set(['127.0.0.1', '::1', '[::1]', 'localhost']);

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
    // Where uploaded files are stored (local filesystem adapter). Relative paths resolve against the
    // working directory of the API process.
    DATA_DIR: z.string().min(1).default('.data/media'),
    RATE_LIMIT_MAX: z.coerce.number().int().min(1).max(100000).default(300),
    // Reverse-proxy hops to trust for the client address (X-Forwarded-For). 0 trusts none, so a
    // client cannot spoof its address. Set it to the number of proxies in front of the API.
    TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(10).default(0),
    // Mock auth hands out tokens without credentials, so it must stay on a loopback address
    // unless this is set on purpose.
    ALLOW_MOCK_AUTH_ON_NETWORK: z.stringbool().default(false),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
    // Queue for background jobs (D-054). Optional: without it the API still accepts jobs, which
    // wait in the database until a worker with Redis runs. The password inside is redacted in logs.
    REDIS_URL: z
      .string()
      .refine(
        (value) => isUrlWithProtocol(value, ['redis:', 'rediss:']),
        'must be a redis:// or rediss:// URL',
      )
      .optional(),
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
    if (
      env.AUTH_MODE === 'mock' &&
      !LOOPBACK_HOSTS.has(env.HOST) &&
      !env.ALLOW_MOCK_AUTH_ON_NETWORK
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['HOST'],
        message:
          'mock authentication may only listen on a loopback address; set ALLOW_MOCK_AUTH_ON_NETWORK=true to override deliberately',
      });
    }
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
