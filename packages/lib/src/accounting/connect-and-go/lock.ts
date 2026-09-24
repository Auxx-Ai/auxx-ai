// packages/lib/src/accounting/connect-and-go/lock.ts

import { createHash } from 'node:crypto'
import type { Database } from '@auxx/database'
import { withAdvisoryLock } from '../../data-migrations/advisory-lock'
import { ConflictError } from '../../errors'

/** Per-org advisory-lock key, below 2^60 so it fits Postgres `bigint`. */
function lockKey(organizationId: string): bigint {
  const hex = createHash('sha1').update(`connect-and-go:${organizationId}`).digest('hex')
  return BigInt(`0x${hex.slice(0, 15)}`)
}

/** Run `fn` holding the org's setup lock, so the queued prepare and the screen's never import the chart twice. */
export async function withSetupLock<T>(
  db: Database,
  organizationId: string,
  fn: () => Promise<T>
): Promise<T> {
  const result = await withAdvisoryLock(db, lockKey(organizationId), fn)
  if (result === 'lock-held') {
    throw new ConflictError('Accounting setup is already running. Try again in a minute.', {
      organizationId,
    })
  }
  return result
}
