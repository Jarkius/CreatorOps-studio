/**
 * Builds the Manifest V3 manifest (D-019, D-029, docs/03 section 4, docs/05 section 4).
 *
 * The permission set is deliberately tiny and fixed: `sidePanel`, `storage` and `scripting`, plus
 * host access to the configured API origin only. `scripting` (D-072) is only usable on hosts the
 * extension may access, and the only other host is the optional `https://www.meta.ai/*` (D-071),
 * which the user grants with a Chrome prompt when turning the Meta AI helper on. Adding anything
 * else (activeTab, tabs, <all_urls>, content scripts) needs its own decision entry; a test fails
 * if it appears.
 */
export const EXTENSION_PERMISSIONS = ['sidePanel', 'storage', 'scripting'] as const;

/** The one other site the extension may ever touch, and only after the user allows it (D-071). */
export const META_AI_HOST_PATTERN = 'https://www.meta.ai/*';

export interface ManifestInput {
  /** Base URL of the CreatorOps API, for example http://localhost:3000. */
  readonly apiBaseUrl: string;
  /** Extension version: 1 to 4 dot-separated integers. */
  readonly version: string;
  /** Public key that pins the extension id (development builds only). */
  readonly key?: string | undefined;
  /**
   * End-to-end test builds only: lists the Meta AI host as granted at install, because Chrome's
   * permission prompt cannot be clicked by a test. Never set for a release or demo build.
   */
  readonly grantMetaAiForTests?: boolean | undefined;
}

export interface Manifest {
  readonly manifest_version: 3;
  readonly name: string;
  readonly version: string;
  readonly description: string;
  readonly minimum_chrome_version: string;
  readonly action: { readonly default_title: string };
  readonly side_panel: { readonly default_path: string };
  readonly background: { readonly service_worker: string; readonly type: 'module' };
  readonly permissions: readonly string[];
  readonly host_permissions: readonly string[];
  readonly optional_host_permissions: readonly string[];
  readonly content_security_policy: { readonly extension_pages: string };
  readonly key?: string;
}

/** Returns the bare origin of the API URL, rejecting anything that could widen host access. */
export function apiOriginFrom(apiBaseUrl: string): string {
  let url: URL;
  try {
    url = new URL(apiBaseUrl);
  } catch {
    throw new Error(`Invalid API base URL for the extension manifest: "${apiBaseUrl}"`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('The extension API base URL must use http or https.');
  }
  if (url.username !== '' || url.password !== '') {
    throw new Error('The extension API base URL must not contain credentials.');
  }
  if (url.hostname.includes('*') || apiBaseUrl.includes('*')) {
    throw new Error('Wildcard hosts are not allowed in the extension manifest.');
  }
  return url.origin;
}

export function buildManifest(input: ManifestInput): Manifest {
  if (!/^\d{1,5}(\.\d{1,5}){0,3}$/.test(input.version)) {
    throw new Error(`Invalid extension version "${input.version}".`);
  }
  const origin = apiOriginFrom(input.apiBaseUrl);

  return {
    manifest_version: 3,
    name: 'CreatorOps Studio',
    version: input.version,
    description: 'Quick access to your CreatorOps Studio workspace from a side panel.',
    // chrome.sidePanel and setPanelBehavior need Chrome 114+; 116 keeps a safety margin.
    minimum_chrome_version: '116',
    action: { default_title: 'Open CreatorOps Studio' },
    side_panel: { default_path: 'sidepanel.html' },
    background: { service_worker: 'sw.js', type: 'module' },
    permissions: [...EXTENSION_PERMISSIONS],
    host_permissions: [
      `${origin}/*`,
      ...(input.grantMetaAiForTests === true ? [META_AI_HOST_PATTERN] : []),
    ],
    optional_host_permissions: [META_AI_HOST_PATTERN],
    content_security_policy: {
      // No remote code, no plugins, and everything not listed falls back to the extension itself.
      // Images and media may also load from the API origin (signed media URLs, D-039).
      extension_pages: `default-src 'self'; script-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; img-src 'self' ${origin}; media-src ${origin}; connect-src 'self' ${origin}`,
    },
    ...(input.key ? { key: input.key } : {}),
  };
}
