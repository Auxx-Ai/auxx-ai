// packages/lib/src/accounting/documents/lines/reads.ts

// No permission checks: the router asserts on the parent document (docs/lib-module-guide.md §6).
import { type Database, database, type Transaction } from '@auxx/database'
import { getAmbientWriteDb } from '../../../resources/crud/write-session-als'
import type { Line, LineDocumentType } from './client'
import { readStoredLineParent, readStoredLines, type StoredLine } from './storage/field-value'
import type { LineDocumentRef, LineForTotalsRow, ReadDocumentLinesInput } from './types'

/** Nulls last, then id: the order the builder renders. */
function bySortOrder(a: Line, b: Line): number {
  if (a.sortOrder !== b.sortOrder) {
    if (a.sortOrder === null) return 1
    if (b.sortOrder === null) return -1
    return a.sortOrder - b.sortOrder
  }
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

/** One document's own lines, ordered by `sortOrder, id`. */
export async function readDocumentLines(
  db: Database | Transaction,
  organizationId: string,
  input: ReadDocumentLinesInput
): Promise<Line[]> {
  const stored = await readStoredLines(db, organizationId, input.documentType, {
    documentId: input.documentId,
    includeArchived: input.includeArchived,
  })
  return stored
    .filter((row) => row.owned && matchesVisit(input, row.line))
    .map((row) => row.line)
    .sort(bySortOrder)
}

/** A visit's extras only, or the job's own set; the two never overlap. */
function matchesVisit(input: ReadDocumentLinesInput, line: Line): boolean {
  if (input.documentType !== 'work_order') return true
  return input.visitId ? line.visitId === input.visitId : !line.visitId
}

/** Lines by id, in the order asked for. Ids that are not live lines of this kind are absent. */
export async function readLines(
  db: Database | Transaction,
  organizationId: string,
  input: { documentType: LineDocumentType; ids: readonly string[] }
): Promise<Line[]> {
  if (input.ids.length === 0) return []
  const stored = await readStoredLines(db, organizationId, input.documentType, { ids: input.ids })
  const byId = new Map(stored.map((row) => [row.line.id, row.line]))
  return input.ids.flatMap((id) => byId.get(id) ?? [])
}

/** One line by id. */
export async function readLine(
  db: Database | Transaction,
  organizationId: string,
  input: { documentType: LineDocumentType; id: string }
): Promise<Line | null> {
  const [line] = await readLines(db, organizationId, {
    documentType: input.documentType,
    ids: [input.id],
  })
  return line ?? null
}

/**
 * The document a line belongs to. A work-order source line that was invoiced carries both
 * parents and reports the work order: quote, invoice without work order, order, work order.
 */
export async function readLineParent(
  db: Database | Transaction,
  organizationId: string,
  lineId: string
): Promise<LineDocumentRef | null> {
  return readStoredLineParent(db, organizationId, lineId)
}

/**
 * The ids of `ids` that are this document's own lines; `readDocumentLines`' membership rule
 * without the visit split.
 */
export async function readOwnedLineIds(
  db: Database | Transaction,
  organizationId: string,
  input: LineDocumentRef & { ids: readonly string[] }
): Promise<Set<string>> {
  if (input.ids.length === 0) return new Set()
  const stored = await readStoredLines(db, organizationId, input.documentType, { ids: input.ids })
  return new Set(
    stored
      .filter((row) => row.owned && row.line.documentId === input.documentId)
      .map((row) => row.line.id)
  )
}

/**
 * Every line's contribution to its document's totals. Ordered `createdAt DESC, id ASC`, the
 * order the totals engine has always seen: the discount allocation breaks ties by position.
 */
export async function readLinesForTotals(
  db: Database | Transaction | undefined,
  organizationId: string,
  input: LineDocumentRef
): Promise<LineForTotalsRow[]> {
  const conn = db ?? getAmbientWriteDb() ?? database
  const stored = await readStoredLines(conn, organizationId, input.documentType, {
    documentId: input.documentId,
  })
  return stored
    .filter((row) => row.owned)
    .sort(byCreatedDesc)
    .map(({ line }) => ({
      lineInstanceId: line.id,
      lineTotal: line.lineTotal,
      // A line entity with no `taxable` field is wholly taxable; with no rate it never surfaces.
      taxable: line.taxable ?? true,
      optional: line.optional ?? undefined,
      optionalSelected: line.optionalSelected ?? undefined,
      lineTax: input.documentType === 'credit_memo' ? line.taxTotal : null,
      storedNetTotal: line.netTotal,
    }))
}

function byCreatedDesc(a: StoredLine, b: StoredLine): number {
  const time = b.createdAt.getTime() - a.createdAt.getTime()
  if (time !== 0) return time
  return a.line.id < b.line.id ? -1 : a.line.id > b.line.id ? 1 : 0
}
