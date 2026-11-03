import { describe, expect, it } from 'vitest';

import { PACKAGE_NAME } from './index.js';

describe('@creatorops/config', () => {
  it('exports its package name', () => {
    expect(PACKAGE_NAME).toBe('@creatorops/config');
  });
});
