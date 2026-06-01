// packages/lib/src/audit-log/export-audit-events.ts

import { AuditLog, database } from '@auxx/database'
import { and, desc, eq, gte, lte, type SQL } from 'drizzle-orm'
import { ResultAsync } from 'neverthrow'
import type { AuditLogError } from './errors'
import type { AuditLogEntity, ListAllAuditEventsInput } from './types'

/** Hard cap on a single export to keep memory bounded. Paginate for larger ranges. */
const EXPORT_CAP = 10_000

export type AuditExportFormat = 'csv' | 'ndjson'

export interface AuditExportInput extends Omit<ListAllAuditEventsInput, 'cursor' | 'limit'> {
  format?: AuditExportFormat
}

export interface AuditExportResult {
  content: string
  contentType: string
  filename: string
  count: number
  truncated: boolean
}

const CSV_COLUMNS: (keyof AuditLogEntity)[] = [
  'id',
  'createdAt',
  'organizationId',
  'category',
  'action',
  'actorType',
  'actorId',
  'targetType',
  'targetId',
  'ipAddress',
  'userAgent',
  'sessionId',
  'visibility',
  'reason',
  'previousState',
  'newState',
  'metadata',
]

function csvCell(value: unknown): string {
  if (value == null) return ''
  const str =
    value instanceof Date
      ? value.toISOString()
      : typeof value === 'object'
        ? JSON.stringify(value)
        : String(value)
  // Quote if it contains a comma, quote, or newline; escape embedded quotes.
  return /[",\n\r]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str
}

function toCsv(rows: AuditLogEntity[]): string {
  const header = CSV_COLUMNS.join(',')
  const lines = rows.map((row) => CSV_COLUMNS.map((col) => csvCell(row[col])).join(','))
  return [header, ...lines].join('\n')
}

function toNdjson(rows: AuditLogEntity[]): string {
  return rows.map((row) => JSON.stringify(row)).join('\n')
}

/**
 * Export audit rows for auditors / SIEM. Immutable source → safe to serialize verbatim.
 * Bounded by {@link EXPORT_CAP}; `truncated` flags when the range exceeded the cap.
 */
export function exportAuditEvents(
  input: AuditExportInput = {}
): ResultAsync<AuditExportResult, AuditLogError> {
  const format: AuditExportFormat = input.format ?? 'csv'

  const conditions: (SQL | undefined)[] = []
  if (input.organizationId) conditions.push(eq(AuditLog.organizationId, input.organizationId))
  if (input.category) conditions.push(eq(AuditLog.category, input.category))
  if (input.actorId) conditions.push(eq(AuditLog.actorId, input.actorId))
  if (input.action) conditions.push(eq(AuditLog.action, input.action))
  if (input.visibility) conditions.push(eq(AuditLog.visibility, input.visibility))
  if (input.from) conditions.push(gte(AuditLog.createdAt, input.from))
  if (input.to) conditions.push(lte(AuditLog.createdAt, input.to))

  const where = conditions.length ? and(...conditions) : undefined

  return ResultAsync.fromPromise(
    database
      .select()
      .from(AuditLog)
      .where(where)
      .orderBy(desc(AuditLog.createdAt), desc(AuditLog.id))
      .limit(EXPORT_CAP + 1),
    (cause): AuditLogError => ({
      code: 'AUDIT_READ_FAILED',
      message: 'Failed to export audit events',
      cause,
    })
  ).map((allRows) => {
    const truncated = allRows.length > EXPORT_CAP
    const rows = truncated ? allRows.slice(0, EXPORT_CAP) : allRows
    const content = format === 'ndjson' ? toNdjson(rows) : toCsv(rows)
    return {
      content,
      contentType: format === 'ndjson' ? 'application/x-ndjson' : 'text/csv',
      filename: `audit-log.${format === 'ndjson' ? 'ndjson' : 'csv'}`,
      count: rows.length,
      truncated,
    }
  })
}
