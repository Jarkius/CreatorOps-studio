import { describe, expect, it } from 'vitest';

import { IdempotencyKeySchema } from '@creatorops/contracts';

import { newIdempotencyKey } from './idempotency.js';

const KEY_FORMAT = /^ui-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe('newIdempotencyKey', () => {
  it('returns ui- followed by a UUID, which the API accepts', () => {
    const key = newIdempotencyKey();
    expect(key).toMatch(KEY_FORMAT);
    expect(key).toHaveLength(39);
    expect(IdempotencyKeySchema.safeParse(key).success).toBe(true);
  });

  it('returns a different key on each call', () => {
    expect(newIdempotencyKey()).not.toBe(newIdempotencyKey());
  });
});
