import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import type { Manifest } from './manifest.js';

/**
 * Checks the real build output, not just the builder: these are the guarantees the release
 * relies on (docs/07 Extension and Security). `pnpm test` builds first.
 */
const DIST = resolve(import.meta.dirname, '../dist');

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? files(full) : [full];
  });
}

if (!existsSync(join(DIST, 'manifest.json'))) {
  throw new Error(
    'apps/extension/dist is missing. Run `pnpm --filter @creatorops/extension build` first.',
  );
}

const manifest = JSON.parse(readFileSync(join(DIST, 'manifest.json'), 'utf8')) as Manifest;

describe('built manifest', () => {
  it('requests only the allowed permissions', () => {
    expect([...manifest.permissions].sort()).toEqual(['scripting', 'sidePanel', 'storage']);
    expect(manifest.optional_host_permissions).toEqual([
      'https://www.meta.ai/*',
      'https://flow.google.com/*',
    ]);
    expect(manifest.host_permissions).toHaveLength(1);
    expect(manifest.host_permissions[0]).toMatch(/^https?:\/\/[^*/]+(:\d+)?\/\*$/);
  });

  it('has no content scripts, no wildcard hosts, no remote-code relaxations', () => {
    const json = JSON.stringify(manifest);
    expect(json).not.toContain('content_scripts');
    expect(json).not.toContain('<all_urls>');
    expect(json).not.toMatch(/unsafe-eval|unsafe-inline/);
  });

  it('refers only to files that exist in the build', () => {
    expect(existsSync(join(DIST, manifest.side_panel.default_path))).toBe(true);
    expect(existsSync(join(DIST, manifest.background.service_worker))).toBe(true);
  });
});

describe('built files', () => {
  it('keeps the service worker standalone: no imports, so it can restart cleanly', () => {
    const worker = readFileSync(join(DIST, manifest.background.service_worker), 'utf8');
    expect(worker).not.toMatch(/\bimport\b/);
    expect(worker).not.toMatch(/\bfetch\(/);
  });

  it('loads scripts only from the extension itself', () => {
    const html = readFileSync(join(DIST, manifest.side_panel.default_path), 'utf8');
    expect(html).not.toMatch(/https?:\/\//);
    expect(html).not.toMatch(/<script(?![^>]*\bsrc=)[^>]*>[^<]/);
    expect(html).not.toMatch(/\son[a-z]+=/i);
  });

  it('contains no secrets, credentials or private keys in any file', () => {
    const forbidden: [string, RegExp][] = [
      ['session secret name', /SESSION_SECRET/],
      ['database url name', /DATABASE_URL/],
      ['private key block', /BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY/],
      ['provider-style api key', /\bsk-[A-Za-z0-9_-]{20,}/],
      ['bearer token literal', /Bearer [A-Za-z0-9._-]{20,}/],
      ['signed dev token literal', /\bv1\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/],
    ];
    for (const file of files(DIST)) {
      const content = readFileSync(file, 'utf8');
      for (const [label, pattern] of forbidden) {
        expect(content, `${label} in ${file}`).not.toMatch(pattern);
      }
    }
  });

  it('does not bundle provider adapters or server-only packages', () => {
    for (const file of files(DIST).filter((f) => /\.(js|html)$/.test(f))) {
      const content = readFileSync(file, 'utf8');
      expect(content, file).not.toMatch(/provider-core|drizzle|pino|fastify/);
    }
  });
});
