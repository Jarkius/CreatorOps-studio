import { randomUUID } from 'node:crypto';

import { REQUEST_ID_HEADER } from '@creatorops/contracts';

// Accept a caller-supplied id only when it is short and made of safe characters, so it cannot
// inject newlines or markup into logs.
const SAFE_REQUEST_ID = /^[A-Za-z0-9._-]{8,64}$/;

export function generateRequestId(
  headers: Readonly<Record<string, string | string[] | undefined>>,
): string {
  const supplied = headers[REQUEST_ID_HEADER];
  if (typeof supplied === 'string' && SAFE_REQUEST_ID.test(supplied)) return supplied;
  return randomUUID();
}
