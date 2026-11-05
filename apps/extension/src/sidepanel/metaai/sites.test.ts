import { describe, expect, it } from 'vitest';

import { FLOW_SITE, META_AI_SITE, type HelperSite } from './sites.js';

/** A Chrome match pattern as far as these sites use it: scheme, host, and a path with `*` wildcards. */
function matches(pattern: string, address: string): boolean {
  const found = /^(https):\/\/([^/]+)(\/.*)$/.exec(pattern);
  if (found === null) throw new Error(`not a match pattern: ${pattern}`);
  const [, scheme, host, path] = found as unknown as [string, string, string, string];
  const url = new URL(address);
  if (url.protocol !== `${scheme}:` || url.host !== host) return false;
  const expression = new RegExp(
    `^${path.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`,
  );
  return expression.test(`${url.pathname}${url.search}`);
}

describe.each([META_AI_SITE, FLOW_SITE] as HelperSite[])('$name site description', (site) => {
  it('opens an address that its own permission patterns and tab patterns match', () => {
    expect(site.origins.some((pattern) => matches(pattern, site.startUrl))).toBe(true);
    expect(site.tabPatterns.some((pattern) => matches(pattern, site.startUrl))).toBe(true);
  });

  it('uses only https patterns on its own hosts, never a wildcard host or all sites', () => {
    for (const pattern of [...site.origins, ...site.tabPatterns]) {
      expect(pattern).toMatch(/^https:\/\/[a-z0-9.-]+\//);
      expect(pattern).not.toContain('*://');
      expect(pattern).not.toContain('<all_urls>');
    }
  });

  it('keeps every wait bounded', () => {
    expect(site.timeoutMs.image).toBeLessThanOrEqual(10 * 60_000);
    expect(site.timeoutMs.video).toBeLessThanOrEqual(10 * 60_000);
    expect(site.loginTimeoutMs).toBeLessThanOrEqual(5 * 60_000);
    expect(site.pollMs).toBeGreaterThanOrEqual(1000);
  });
});

describe('the pattern matcher used by these tests', () => {
  it('is exact about paths, which is the mistake it guards against', () => {
    expect(
      matches('https://labs.google/fx/tools/flow/*', 'https://labs.google/fx/tools/flow'),
    ).toBe(false);
    expect(matches('https://labs.google/fx/tools/flow*', 'https://labs.google/fx/tools/flow')).toBe(
      true,
    );
    expect(
      matches('https://labs.google/fx/tools/flow*', 'https://labs.google/fx/tools/flow/project/1'),
    ).toBe(true);
    expect(matches('https://labs.google/fx/tools/flow*', 'https://labs.google/other')).toBe(false);
    expect(matches('https://flow.google.com/*', 'https://flow.google.com.evil.example/x')).toBe(
      false,
    );
  });
});
