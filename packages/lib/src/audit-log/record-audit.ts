// packages/lib/src/audit-log/record-audit.ts

import { AuditLog, type Database, database, type Transaction, toAuditRow } from '@auxx/database'
import { ResultAsync } from 'neverthrow'
import type { AuditLogError } from './errors'
import type { AuditInput } from './types'

/**
 * Append one immutable row to the audit log. On the default global `database` this
 * is fire-and-forget (returns a Result, never throws) for request-layer and
 * bus-projection writes; pass an explicit `db`/`Transaction` to commit the row
 * atomically with the change it describes — on that path an insert failure THROWS
 * (rolling back the transaction) instead of returning `err`, because a swallowed
 * failure there would silently commit the change with no audit row.
 */
export function recordAudit(
  input: AuditInput,
  db: Database | Transaction = database
): ResultAsync<void, AuditLogError> {
  const insert = db
    .insert(AuditLog)
    .values(toAuditRow(input))
    .then(() => undefined)
  if (db !== database) return ResultAsync.fromSafePromise(insert)
  return ResultAsync.fromPromise(
    insert,
    (cause): AuditLogError => ({
      code: 'AUDIT_WRITE_FAILED',
      message: `Failed to write audit log "${input.category}:${input.action}"`,
      cause,
    })
  )
}
