// packages/lib/src/audit-log/record-audit.ts

import { AuditLog, type Database, database, type Transaction, toAuditRow } from '@auxx/database'
import { ResultAsync } from 'neverthrow'
import type { AuditLogError } from './errors'
import type { AuditInput } from './types'

/**
 * Append one immutable row to the audit log. Both write paths funnel through here:
 * direct request-layer writes (with IP/UA in `input.context`) and the bus-projection
 * handler (no context). Functional — returns a Result, never throws, so callers can
 * fire-and-forget without risking the surrounding request. Pass `db` (a `Transaction`)
 * to commit the row atomically with the change it describes.
 */
export function recordAudit(
  input: AuditInput,
  db: Database | Transaction = database
): ResultAsync<void, AuditLogError> {
  return ResultAsync.fromPromise(
    db
      .insert(AuditLog)
      .values(toAuditRow(input))
      .then(() => undefined),
    (cause): AuditLogError => ({
      code: 'AUDIT_WRITE_FAILED',
      message: `Failed to write audit log "${input.category}:${input.action}"`,
      cause,
    })
  )
}
