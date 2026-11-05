import { createHash, createPublicKey } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { apiOriginFrom, buildManifest, EXTENSION_PERMISSIONS } from './manifest.js';

const base = { apiBaseUrl: 'http://localhost:3000', version: '0.1.0' };

describe('buildManifest', () => {
  it('is Manifest V3 with the side panel and a module service worker', () => {
    const manifest = buildManifest(base);
    expect(manifest.manifest_version).toBe(3);
    expect(manifest.side_panel).toEqual({ default_path: 'sidepanel.html' });
    expect(manifest.background).toEqual({ service_worker: 'sw.js', type: 'module' });
  });

  it('requests exactly sidePanel, storage and scripting, and host access to the API origin only', () => {
    const manifest = buildManifest({
      ...base,
      apiBaseUrl: 'https://api.example.com/some/path?x=1',
    });
    expect([...manifest.permissions]).toEqual(['sidePanel', 'storage', 'scripting']);
    expect([...manifest.permissions]).toEqual([...EXTENSION_PERMISSIONS]);
    expect([...manifest.host_permissions]).toEqual(['https://api.example.com/*']);
  });

  it('offers the helper sites as optional host permissions only (D-071, D-080)', () => {
    const manifest = buildManifest(base);
    expect([...manifest.optional_host_permissions]).toEqual([
      'https://www.meta.ai/*',
      'https://labs.google/fx/tools/flow/*',
      'https://flow.google.com/*',
    ]);
    const hosts = manifest.host_permissions.join(' ');
    for (const site of ['meta.ai', 'labs.google', 'flow.google']) expect(hosts).not.toContain(site);
  });

  it('grants the helper hosts at install only for an end-to-end test build', () => {
    const manifest = buildManifest({ ...base, grantMetaAiForTests: true });
    expect([...manifest.host_permissions]).toEqual([
      'http://localhost:3000/*',
      'https://www.meta.ai/*',
      'https://labs.google/fx/tools/flow/*',
      'https://flow.google.com/*',
    ]);
  });

  it('never requests broad access, tabs, or content scripts', () => {
    const json = JSON.stringify(buildManifest(base));
    for (const forbidden of [
      '<all_urls>',
      '*://*/*',
      'activeTab',
      '"tabs"',
      'webRequest',
      'cookies',
      'content_scripts',
      'externally_connectable',
      'web_accessible_resources',
    ]) {
      expect(json, forbidden).not.toContain(forbidden);
    }
  });

  it('sets a strict content security policy limited to itself and the API origin', () => {
    const csp = buildManifest(base).content_security_policy.extension_pages;
    expect(csp).toContain("script-src 'self'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'none'");
    expect(csp).toContain("connect-src 'self' http://localhost:3000");
    // Everything not listed falls back to the extension itself, so no other origin can load
    // styles, fonts, frames or form targets.
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("form-action 'none'");
    expect(csp).toContain("img-src 'self' http://localhost:3000");
    expect(csp).toContain('media-src http://localhost:3000');
    expect(csp).not.toMatch(/unsafe-eval|unsafe-inline|\*|https?:\/\/[^ ]*\*/);
  });

  it('includes the key only when given', () => {
    expect(buildManifest(base)).not.toHaveProperty('key');
    expect(buildManifest({ ...base, key: 'abc' })).toHaveProperty('key', 'abc');
  });

  it('rejects an invalid version', () => {
    for (const version of ['', 'v1', '1.2.3.4.5', '1.x', '1.2.3-beta']) {
      expect(() => buildManifest({ ...base, version }), version).toThrow(/version/i);
    }
  });
});

describe('apiOriginFrom', () => {
  it('reduces a URL to its origin', () => {
    expect(apiOriginFrom('http://localhost:3000/api/v1')).toBe('http://localhost:3000');
    expect(apiOriginFrom('https://api.example.com')).toBe('https://api.example.com');
  });

  it('rejects anything that could widen host access', () => {
    expect(() => apiOriginFrom('not a url')).toThrow();
    expect(() => apiOriginFrom('ftp://example.com')).toThrow(/http/);
    expect(() => apiOriginFrom('chrome://extensions')).toThrow(/http/);
    expect(() => apiOriginFrom('https://*.example.com')).toThrow();
    expect(() => apiOriginFrom('https://user:pass@example.com')).toThrow(/credentials/);
  });
});

describe('development key', () => {
  const stored = JSON.parse(
    readFileSync(resolve(import.meta.dirname, '../dev-extension-key.json'), 'utf8'),
  ) as { key: string; id: string };

  it('is a valid RSA public key (SPKI DER) and contains no private material', () => {
    const der = Buffer.from(stored.key, 'base64');
    const key = createPublicKey({ key: der, format: 'der', type: 'spki' });
    expect(key.type).toBe('public');
    expect(key.asymmetricKeyType).toBe('rsa');
    expect(JSON.stringify(stored)).not.toMatch(/PRIVATE|private/);
  });

  it('pins the extension id the way Chrome derives it', () => {
    const digest = createHash('sha256')
      .update(Buffer.from(stored.key, 'base64'))
      .digest()
      .subarray(0, 16);
    const id = [...digest.toString('hex')]
      .map((c) => String.fromCharCode('a'.charCodeAt(0) + parseInt(c, 16)))
      .join('');
    expect(id).toBe(stored.id);
    expect(id).toMatch(/^[a-p]{32}$/);
  });
});
