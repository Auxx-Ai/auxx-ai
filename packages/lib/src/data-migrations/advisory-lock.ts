// packages/lib/src/data-migrations/advisory-lock.ts

import type { Database } from '@auxx/database'
import type { Pool, PoolClient } from 'pg'

/**
 * Well-known Postgres advisory-lock key for the data-migration runner. A single
 * constant — only one runner pass may hold it at a time across the whole fleet.
 */
export const DATA_MIGRATION_LOCK_KEY = 4_307_748_291n

/** Reach through the drizzle client (and the replica wrapper, if present) to the pg Pool. */
function getPool(db: Database): Pool {
  const anyDb = db as unknown as { $client?: Pool; $primary?: { $client: Pool } }
  const pool = anyDb.$client ?? anyDb.$primary?.$client
  if (!pool) throw new Error('Could not resolve a pg Pool from the database client')
  return pool
}

/**
 * Run `fn` while holding a session-level Postgres advisory lock.
 *
 * Returns `'lock-held'` immediately (without running `fn`) if another holder has the
 * lock — this is how concurrent boots / button+boot overlaps are deduped. Otherwise
 * runs `fn` and returns its result.
 *
 * The lock is acquired and released on a single dedicated connection checked out of
 * the pool (session locks MUST unlock on the same connection that took them). The
 * connection is held idle for the duration of `fn`; the migrations inside run on
 * their own pooled connections.
 */
export async function withAdvisoryLock<T>(
  db: Database,
  key: bigint,
  fn: () => Promise<T>
): Promise<T | 'lock-held'> {
  const pool = getPool(db)
  const client: PoolClient = await pool.connect()
  try {
    const res = await client.query<{ locked: boolean }>(
      'SELECT pg_try_advisory_lock($1) AS locked',
      [key.toString()]
    )
    if (!res.rows[0]?.locked) return 'lock-held'

    try {
      return await fn()
    } finally {
      await client.query('SELECT pg_advisory_unlock($1)', [key.toString()])
    }
  } finally {
    client.release()
  }
}
