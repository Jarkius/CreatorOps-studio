import { describe, expect, it } from 'vitest';

import { PACKAGE_NAME } from './index.js';

describe('@creatorops/provider-core', () => {
  it('exports its package name', () => {
    expect(PACKAGE_NAME).toBe('@creatorops/provider-core');
  });
});
