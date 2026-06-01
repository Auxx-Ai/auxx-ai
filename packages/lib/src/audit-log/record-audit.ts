// packages/lib/src/audit-log/record-audit.ts

import { AuditLog, database, toAuditRow } from '@auxx/database'
import { ResultAsync } from 'neverthrow'
import type { AuditLogError } from './errors'
import type { AuditInput } from './types'

/**
 * Append one immutable row to the audit log. Both write paths funnel through here:
 * direct request-layer writes (with IP/UA in `input.context`) and the bus-projection
 * handler (no context). Functional — returns a Result, never throws, so callers can
 * fire-and-forget without risking the surrounding request.
 */
export function recordAudit(input: AuditInput): ResultAsync<void, AuditLogError> {
  return ResultAsync.fromPromise(
    database
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
