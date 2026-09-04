// packages/lib/src/postings/reports/rows.ts
//
// The one row shape every statement, the opening trial balance, aging and the
// PDF parts render from - `ui-plan.md` §4.1's `StatementTable` contract, mirrored
// here so a lib read and the table that renders it can never disagree about
// what a row is. Client-safe: no db, no io, pure shaping functions only.
//
// `toCsvRows` rides `@auxx/utils/csv`'s `toCsv` - the same RFC 4180 serializer
// the audit-log exporter and the browser download helper share - rather than
// hand-rolling a second one.
//
// Two departures from the `StatementTable` prop types in `ui-plan.md` §4.1,
// both because this file has no framework to reach for: `meta.badge` is a
// plain string rather than a `ReactNode` (the web layer wraps it in whatever
// component it likes), and `meta.recordId` is a plain string rather than the
// app's branded `RecordId` (this package does not depend on `@auxx/types`'s
// web-facing id brands). Report these if the page agent needs a different shape.

import { toCsv } from '@auxx/utils/csv'

/** One column a `StatementTable`/PDF grouped table renders. */
export interface StatementColumn {
  key: string
  label: string
  align?: 'right'
  /** Render with `formatSignedMinor` (activity, variance) rather than `formatMinor`. */
  signed?: boolean
}

/** One row of a rendered statement - a section header, an account, a subtotal, or a computed figure. */
export interface StatementRow {
  id: string
  label: string
  depth: 0 | 1 | 2
  kind: 'section' | 'line' | 'subtotal' | 'total' | 'computed'
  /** Minor units, one per column. `null` renders `EMPTY_CELL`. */
  values: Array<number | null>
  meta?: { accountCode?: string; recordId?: string; badge?: string; note?: string }
  /** Aging's drill-down; empty for the three financial statements. */
  children?: StatementRow[]
}

/** One line item a `toStatementRows` adapter turns into a `StatementRow`. */
export interface StatementLineInput {
  id: string
  label: string
  /** Minor units, one per column, in column order. */
  values: Array<number | null>
  accountCode?: string
  note?: string
}

/**
 * Build one `'line'` row (depth 1) plus, when `total` is given, one `'total'`
 * row (depth 0) that sums the lines - the section-with-subtotal shape every
 * statement in this module renders: assets, liabilities and equity on the
 * balance sheet, revenue and expense on the P&L, every account code on the
 * trial balance.
 *
 * `sectionKind` lets a caller ask for `'subtotal'` instead of `'total'` for a
 * sub-grouping that is not the whole statement's bottom line (COGS under
 * expense, for instance).
 */
export function statementSection(
  sectionId: string,
  sectionLabel: string,
  lines: readonly StatementLineInput[],
  options?: { totalLabel?: string; sectionKind?: 'subtotal' | 'total' }
): StatementRow {
  const columnCount = lines.reduce((max, line) => Math.max(max, line.values.length), 0)
  const totals = Array.from({ length: columnCount }, (_, col) =>
    lines.reduce((sum, line) => sum + (line.values[col] ?? 0), 0)
  )

  const children: StatementRow[] = lines.map((line) => ({
    id: line.id,
    label: line.label,
    depth: 1,
    kind: 'line',
    values: line.values,
    meta:
      line.accountCode || line.note
        ? { accountCode: line.accountCode, note: line.note }
        : undefined,
  }))

  if (options?.totalLabel) {
    children.push({
      id: `${sectionId}:total`,
      label: options.totalLabel,
      depth: 1,
      kind: options.sectionKind ?? 'subtotal',
      values: totals,
    })
  }

  return {
    id: sectionId,
    label: sectionLabel,
    depth: 0,
    kind: 'section',
    values: totals,
    children,
  }
}

/** One `'computed'` row - a figure the reader derives (retained earnings, gross profit, net income). */
export function computedRow(
  id: string,
  label: string,
  values: Array<number | null>,
  note?: string
): StatementRow {
  return { id, label, depth: 0, kind: 'computed', values, meta: note ? { note } : undefined }
}

/** One `'total'` row at the top level - the statement's own bottom line. */
export function totalRow(id: string, label: string, values: Array<number | null>): StatementRow {
  return { id, label, depth: 0, kind: 'total', values }
}

/**
 * Flatten a `StatementRow[]` tree (section -> children) into CSV text, one line
 * per rendered row including section and total rows, indenting the label with
 * two spaces per depth so a flat CSV still reads as a hierarchy.
 *
 * Values are rendered as plain major-unit decimal strings (`'1234.56'`), never
 * a currency-formatted string - a CSV is for a spreadsheet, and a spreadsheet
 * that has to strip a `$` and a thousands separator back out defeats the point
 * of exporting. `null` becomes an empty cell, matching `EMPTY_CELL`'s meaning
 * on screen.
 */
export function toCsvRows(
  rows: readonly StatementRow[],
  columns: readonly StatementColumn[],
  currencyCode = 'USD'
): string {
  const exponent = minorExponent(currencyCode)
  const records: Array<Record<string, string>> = []

  const visit = (row: StatementRow, depth: number) => {
    const record: Record<string, string> = { Label: `${'  '.repeat(depth)}${row.label}` }
    columns.forEach((column, index) => {
      const value = row.values[index]
      record[column.label] =
        value === null || value === undefined ? '' : (value / 10 ** exponent).toFixed(exponent)
    })
    records.push(record)
    for (const child of row.children ?? []) visit(child, depth + 1)
  }

  for (const row of rows) visit(row, row.depth)
  return toCsv(records, ['Label', ...columns.map((c) => c.label)])
}

/** ISO 4217 minor-unit exponent, without importing `@auxx/utils` into a pure lib module. */
function minorExponent(currencyCode: string): number {
  try {
    return (
      new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: currencyCode,
      }).resolvedOptions().maximumFractionDigits ?? 2
    )
  } catch {
    return 2
  }
}
