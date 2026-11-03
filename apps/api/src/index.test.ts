import { describe, expect, it } from 'vitest';

import { APP_NAME } from './index.js';

describe('@creatorops/api', () => {
  it('exports its package name', () => {
    expect(APP_NAME).toBe('@creatorops/api');
  });
});
