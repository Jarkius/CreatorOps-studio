import pg from 'pg';

/** Creates a connection pool. The connection string is the only database contract (D-026). */
export function createPool(databaseUrl: string): pg.Pool {
  return new pg.Pool({ connectionString: databaseUrl, max: 5, connectionTimeoutMillis: 5000 });
}

/** Resolves when the database answers a trivial query; rejects otherwise. */
export async function checkDatabase(pool: pg.Pool): Promise<void> {
  const result = await pool.query<{ ok: number }>('select 1 as ok');
  if (result.rows[0]?.ok !== 1) throw new Error('Unexpected response from the database');
}
