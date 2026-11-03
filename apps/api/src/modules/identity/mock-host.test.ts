import { describe, expect, it } from 'vitest';

import { allowedMockHosts } from './mock-host.js';

describe('allowedMockHosts', () => {
  it('allows all loopback spellings with the same port for a loopback API', () => {
    expect([...allowedMockHosts('http://localhost:3000')].sort()).toEqual([
      '127.0.0.1:3000',
      '[::1]:3000',
      'localhost:3000',
    ]);
  });

  it('omits the port for default ports', () => {
    expect([...allowedMockHosts('http://127.0.0.1')].sort()).toEqual([
      '127.0.0.1',
      '[::1]',
      'localhost',
    ]);
  });

  it('allows only the exact host for a non-loopback API, case-insensitively', () => {
    expect([...allowedMockHosts('https://API.Example.com:8443')]).toEqual(['api.example.com:8443']);
  });
});
