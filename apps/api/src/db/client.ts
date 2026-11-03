import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import type pg from 'pg';

import * as schema from './schema.js';

export type Db = NodePgDatabase<typeof schema>;
/** The handle passed to a transaction callback. Repositories accept either a Db or a Tx. */
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
export type DbOrTx = Db | Tx;

export function createDb(pool: pg.Pool): Db {
  return drizzle(pool, { schema });
}

export { schema };
