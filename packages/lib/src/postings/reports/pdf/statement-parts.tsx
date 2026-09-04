// packages/lib/src/postings/reports/pdf/statement-parts.tsx
// @jsxRuntime automatic
// @jsxImportSource react
//
// The PDF twin of `StatementTable` (`ui-plan.md` §5.2), built from `documents/`'s
// parts rather than `export/`'s: `createDocumentStyles`, `pageSizeFor` and the
// logo-bytes contract (`DocumentHeader` in `documents/pdf/parts.tsx`) are the
// right borrow, because a statement is an org-identity document like a quote,
// not a print RUN over an `ExportJob`'s `PrintConfig` - there is no saved view,
// no record count, no per-run header/footer template to fill in here. The
// header/footer below are therefore this file's own, small and self-contained,
// rather than `export/pdf/page-frame.tsx`'s `PrintHeader`/`PrintFooter`, which
// take a `PrintConfig` this render has no use for. Page numbering still uses
// react-pdf's own `render={({ pageNumber, totalPages }) => ...}` callback, the
// same mechanism `page-frame.tsx` uses under the hood.

import { formatCurrency } from '@auxx/utils/currency'
import { Image, StyleSheet, Text, View } from '@react-pdf/renderer'
import type { ReactNode } from 'react'
import type { createDocumentStyles } from '../../../documents/pdf/theme'
import type { CompletenessItem } from '../completeness'
import type { StatementColumn, StatementRow } from '../rows'

type Styles = ReturnType<typeof createDocumentStyles>

const statementStyles = StyleSheet.create({
  titleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  titleBlock: { maxWidth: '70%' },
  h1: { fontSize: 16, fontWeight: 'bold', marginBottom: 2 },
  rangeText: { fontSize: 9, color: '#6b7280' },
  basisText: { fontSize: 8, color: '#9ca3af', marginTop: 2 },
  logo: { width: 100, maxHeight: 40, objectFit: 'contain' },
  completenessBox: {
    marginTop: 12,
    marginBottom: 8,
    padding: 8,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 3,
    backgroundColor: '#f9fafb',
  },
  completenessTitle: { fontSize: 8, fontWeight: 'bold', color: '#374151', marginBottom: 3 },
  completenessItem: { fontSize: 8, color: '#6b7280', marginBottom: 1 },
  table: { marginTop: 8 },
  sectionRow: { flexDirection: 'row', paddingTop: 10, paddingBottom: 2 },
  sectionLabel: { fontSize: 9, fontWeight: 'bold' },
  headerRow: { flexDirection: 'row', borderBottom: '1 solid #111827', paddingVertical: 4 },
  headerCell: { fontSize: 8, fontWeight: 'bold', color: '#6b7280' },
  rowBase: { flexDirection: 'row', borderBottom: '1 solid #f3f4f6', paddingVertical: 3 },
  labelCell: { fontSize: 9 },
  labelCellBold: { fontSize: 9, fontWeight: 'bold' },
  valueCell: { fontSize: 9, textAlign: 'right' },
  valueCellBold: { fontSize: 9, textAlign: 'right', fontWeight: 'bold' },
  subtotalRow: { flexDirection: 'row', borderTop: '1 solid #d1d5db', paddingVertical: 3 },
  totalRow: {
    flexDirection: 'row',
    borderTop: '1 solid #111827',
    paddingVertical: 4,
    marginTop: 2,
  },
  computedLabel: { fontSize: 9, fontStyle: 'italic', color: '#374151' },
  footerBand: {
    position: 'absolute',
    bottom: 24,
    left: 36,
    right: 36,
    fontSize: 8,
    color: '#9ca3af',
    borderTop: '1 solid #e5e7eb',
    paddingTop: 6,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
})

/** The title block: org name, statement name, the date range, and the accrual/currency basis line. */
export function StatementTitleBlock(props: {
  styles: Styles
  orgName: string
  statementName: string
  /** `'As of 31 Aug 2026'` or `'1 Aug – 31 Aug 2026'`, pre-formatted. */
  rangeLabel: string
  currencyCode: string
  logoBytes?: Buffer | null
}) {
  const { styles, orgName, statementName, rangeLabel, currencyCode, logoBytes } = props
  return (
    <View style={statementStyles.titleRow}>
      <View style={statementStyles.titleBlock}>
        <Text style={[statementStyles.h1, styles.accentText]}>{orgName}</Text>
        <Text style={statementStyles.h1}>{statementName}</Text>
        <Text style={statementStyles.rangeText}>{rangeLabel}</Text>
        <Text style={statementStyles.basisText}>Accrual · {currencyCode}</Text>
      </View>
      {logoBytes ? <Image style={statementStyles.logo} src={logoBytes} /> : null}
    </View>
  )
}

/**
 * The completeness banner, printed - the same items `CompletenessBanner`
 * renders on screen, boxed so it prints WITH the numbers rather than being
 * lost the moment the page is saved as a PDF (`04-statements.md` §3).
 */
export function CompletenessBlock(props: { items: readonly CompletenessItem[] }) {
  const { items } = props
  if (items.length === 0) return null
  return (
    <View style={statementStyles.completenessBox} wrap={false}>
      <Text style={statementStyles.completenessTitle}>Not reflected in this statement</Text>
      {items.map((item) => (
        <Text key={item.id} style={statementStyles.completenessItem}>
          • {item.label}
        </Text>
      ))}
    </View>
  )
}

/**
 * Every negative renders in parentheses, print-style - `ui-plan.md` §5.2:
 * the screen keeps `formatSignedMinor`'s leading minus, and the PDF is the one
 * place `negativeStyle: 'parentheses'` (added to `@auxx/utils/currency` for
 * exactly this) is used.
 */
function formatCell(value: number | null, currencyCode: string) {
  if (value === null) return ''
  return formatCurrency(value, { currencyCode, negativeStyle: 'parentheses' })
}

function StatementRowLine(props: {
  row: StatementRow
  columns: readonly StatementColumn[]
  currencyCode: string
}) {
  const { row, columns, currencyCode } = props
  const style =
    row.kind === 'total'
      ? statementStyles.totalRow
      : row.kind === 'subtotal'
        ? statementStyles.subtotalRow
        : statementStyles.rowBase
  const bold = row.kind === 'total' || row.kind === 'subtotal'
  const labelStyle =
    row.kind === 'computed'
      ? statementStyles.computedLabel
      : bold
        ? statementStyles.labelCellBold
        : statementStyles.labelCell
  const valueStyle = bold ? statementStyles.valueCellBold : statementStyles.valueCell

  return (
    <View style={style} wrap={false}>
      <Text style={[labelStyle, { flex: 3, paddingLeft: row.depth * 10 }]}>{row.label}</Text>
      {columns.map((column, index) => (
        <Text key={column.key} style={[valueStyle, { flex: 1 }]}>
          {formatCell(row.values[index] ?? null, currencyCode)}
        </Text>
      ))}
    </View>
  )
}

/**
 * The PDF twin of `StatementTable` (read mode): the same `StatementRow[]`
 * input the screen renders, right-aligned numerics, a bold rule on
 * subtotal/total rows, `wrap={false}` per row so a row never splits across a
 * page break, and the header repeating on every page via `fixed`.
 */
export function GroupedRowsTable(props: {
  rows: readonly StatementRow[]
  columns: readonly StatementColumn[]
  currencyCode: string
}) {
  const { rows, columns, currencyCode } = props

  const renderRow = (row: StatementRow): ReactNode => {
    if (row.kind === 'section') {
      return (
        <View key={row.id}>
          <View style={statementStyles.sectionRow} wrap={false}>
            <Text style={statementStyles.sectionLabel}>{row.label}</Text>
          </View>
          {(row.children ?? []).map((child) => renderRow(child))}
        </View>
      )
    }
    return <StatementRowLine key={row.id} row={row} columns={columns} currencyCode={currencyCode} />
  }

  return (
    <View style={statementStyles.table}>
      <View style={statementStyles.headerRow} fixed>
        <Text style={[statementStyles.headerCell, { flex: 3 }]} />
        {columns.map((column) => (
          <Text
            key={column.key}
            style={[statementStyles.headerCell, { flex: 1, textAlign: 'right' }]}>
            {column.label}
          </Text>
        ))}
      </View>
      {rows.map((row) => renderRow(row))}
    </View>
  )
}

/** The statement footer: run date on the left, `Page X of Y` on the right - `PrintFooter`'s defaults, self-contained. */
export function StatementFooter(props: { dateLabel: string }) {
  const { dateLabel } = props
  return (
    <View style={statementStyles.footerBand} fixed>
      <Text>{dateLabel}</Text>
      <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
    </View>
  )
}
