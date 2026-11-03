import { describe, expect, it } from 'vitest';

import { APP_NAME } from './index.js';

describe('@creatorops/extension', () => {
  it('exports its package name', () => {
    expect(APP_NAME).toBe('@creatorops/extension');
  });
});
