const LOOPBACK_NAMES = ['localhost', '127.0.0.1', '[::1]'] as const;

/**
 * The Host header values the mock-token endpoint accepts. A malicious page can make a victim's
 * browser reach a local API through DNS rebinding; the browser then sends the attacker's host
 * name in `Host`, so refusing every unexpected `Host` stops that request even though the browser
 * treats it as same-origin and CORS does not apply.
 *
 * If the API base URL is a loopback address, the other loopback spellings with the same port are
 * accepted too, because `localhost`, `127.0.0.1` and `[::1]` reach the same server.
 */
export function allowedMockHosts(apiBaseUrl: string): ReadonlySet<string> {
  const url = new URL(apiBaseUrl);
  const hosts = new Set<string>([url.host.toLowerCase()]);
  if ((LOOPBACK_NAMES as readonly string[]).includes(url.hostname.toLowerCase())) {
    for (const name of LOOPBACK_NAMES) hosts.add(url.port ? `${name}:${url.port}` : name);
  }
  return hosts;
}
