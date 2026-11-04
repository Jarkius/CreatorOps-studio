import { AppError } from './errors.js';

/** The position of the last row of a page: rows are ordered by (created_at, id), newest first. */
export interface PageCursor {
  readonly createdAt: Date;
  readonly id: string;
}

const invalid = () =>
  new AppError('VALIDATION_ERROR', 'The request is not valid.', [
    { path: 'cursor', message: 'is not a valid cursor' },
  ]);

/** An opaque, URL-safe token for the row a page ended on. */
export function encodeCursor(row: PageCursor): string {
  return Buffer.from(JSON.stringify({ t: row.createdAt.toISOString(), i: row.id })).toString(
    'base64url',
  );
}

/** Rejects anything that is not a cursor this API produced. */
export function decodeCursor(cursor: string): PageCursor {
  if (!/^[A-Za-z0-9_-]+$/.test(cursor)) throw invalid();
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as {
      t?: unknown;
      i?: unknown;
    };
    if (typeof parsed.t !== 'string' || typeof parsed.i !== 'string') throw invalid();
    const createdAt = new Date(parsed.t);
    if (Number.isNaN(createdAt.getTime()) || !/^[0-9a-f-]{36}$/i.test(parsed.i)) throw invalid();
    return { createdAt, id: parsed.i };
  } catch (error) {
    throw error instanceof AppError ? error : invalid();
  }
}
