// packages/lib/src/accounting/connect-and-go/lock.ts

import { createHash } from 'node:crypto'
import type { Database } from '@auxx/database'
import { getPool } from '../../data-migrations/advisory-lock'
import { ConflictError } from '../../errors'

/** Per-org advisory-lock key, below 2^60 so it fits Postgres `bigint`. */
function lockKey(organizationId: string): string {
  const hex = createHash('sha1').update(`connect-and-go:${organizationId}`).digest('hex')
  return BigInt(`0x${hex.slice(0, 15)}`).toString()
}

/**
 * Run `fn` holding the org's setup lock, waiting up to two minutes for a run already in
 * progress: the queued prepare and the screen's own prepare otherwise import the chart twice.
 */
export async function withSetupLock<T>(
  db: Database,
  organizationId: string,
  fn: () => Promise<T>
): Promise<T> {
  const client = await getPool(db).connect()
  const key = lockKey(organizationId)
  try {
    try {
      await client.query("SET lock_timeout = '120s'")
      await client.query('SELECT pg_advisory_lock($1)', [key])
    } catch {
      throw new ConflictError('Accounting setup is already running. Try again in a minute.', {
        organizationId,
      })
    }
    try {
      return await fn()
    } finally {
      await client.query('SELECT pg_advisory_unlock($1)', [key])
    }
  } finally {
    await client.query('RESET lock_timeout').catch(() => undefined)
    client.release()
  }
}
