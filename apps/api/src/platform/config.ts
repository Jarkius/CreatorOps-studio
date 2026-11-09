import { parseEnv, type EnvSource } from '@creatorops/config';
import { z } from 'zod';
import { existsSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';

/** Repo root: the nearest parent holding pnpm-workspace.yaml (falls back to the working directory). */
function repoRoot(start: string): string {
  let dir = resolve(start);
  for (;;) {
    if (existsSync(resolve(dir, 'pnpm-workspace.yaml'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return resolve(start);
    dir = parent;
  }
}

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
    // Where uploaded files are stored (local filesystem adapter). A relative path resolves against
    // the repo root, so the API and the worker agree whatever folder each one starts from.
    DATA_DIR: z
      .string()
      .min(1)
      .default('.data/media')
      .transform((value) => (isAbsolute(value) ? value : resolve(repoRoot(process.cwd()), value))),
    // The owner's own ffmpeg and ffprobe for the final video (D-086); a name on PATH or a full path.
    FFMPEG_PATH: z.string().min(1).default('ffmpeg'),
    FFPROBE_PATH: z.string().min(1).default('ffprobe'),
    // Font for the burned-in Thai subtitles; missing Thai glyphs fall back to an installed font.
    SUBTITLE_FONT: z.string().min(1).max(80).default('Sans'),
    // Retention (D-088): how long rows are kept. Every value has a floor, so a typo can never mean
    // "delete everything", and none of these ever touches the usage ledger or succeeded jobs.
    AUDIT_RETENTION_DAYS: z.coerce.number().int().min(90).max(3650).default(365),
    JOB_RETENTION_DAYS: z.coerce.number().int().min(14).max(3650).default(90),
    EXPORT_ROW_RETENTION_DAYS: z.coerce.number().int().min(7).max(3650).default(30),
    INTENT_RETENTION_DAYS: z.coerce.number().int().min(7).max(3650).default(30),
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
    // Key that encrypts provider API keys stored in the database (D-066): 32 random bytes, base64.
    // Distinct from SESSION_SECRET. Without it the settings screen refuses to save a key.
    SECRETS_ENCRYPTION_KEY: z
      .string()
      .refine((value) => {
        try {
          return Buffer.from(value, 'base64').length === 32 && /^[A-Za-z0-9+/]{43}=$/.test(value);
        } catch {
          return false;
        }
      }, 'must be 32 random bytes as base64 (44 characters); make one with: openssl rand -base64 32')
      .optional(),
    // Names the key above in stored values so it can be rotated later. Letters and digits only.
    SECRETS_ENCRYPTION_KEY_ID: z
      .string()
      .regex(/^[a-z0-9]{1,16}$/)
      .default('k1'),
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
