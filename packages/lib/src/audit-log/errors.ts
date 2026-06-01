// packages/lib/src/audit-log/errors.ts

/** Error returned by audit-log read/write helpers (functional, never thrown). */
export interface AuditLogError {
  code: 'AUDIT_WRITE_FAILED' | 'AUDIT_READ_FAILED'
  message: string
  cause?: unknown
}
