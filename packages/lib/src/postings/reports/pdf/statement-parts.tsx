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
import { describeProviderSyncCoverage, type ProviderSyncMarker } from '../../provider-sync/client'
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
  // 🛑 INVERTED, not tinted. The screen leans on amber and a PDF has no colour
  // affordance to lean on - it is printed, photocopied and read in greyscale.
  // A near-black fill with white type is the one treatment that survives all
  // three, and it is deliberately unlike anything else on the page: the
  // completeness box below is a hairline grey box with 8pt grey type.
  syncWarningBox: {
    marginTop: 12,
    marginBottom: 4,
    padding: 10,
    borderWidth: 2,
    borderColor: '#111827',
    borderRadius: 3,
    backgroundColor: '#111827',
  },
  syncWarningKicker: {
    fontSize: 7,
    fontWeight: 'bold',
    color: '#ffffff',
    letterSpacing: 1.5,
    marginBottom: 4,
  },
  syncWarningHeadline: { fontSize: 12, fontWeight: 'bold', color: '#ffffff', marginBottom: 4 },
  syncWarningDetail: { fontSize: 9, color: '#e5e7eb', lineHeight: 1.4 },
  syncedLine: { fontSize: 8, color: '#6b7280', marginTop: 8 },
  footerNotice: { fontSize: 8, fontWeight: 'bold', color: '#111827' },
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
 * The "synced through" marker, printed - brief 20 §7.3.
 *
 * The accounting firm posts December's depreciation in February, so auxx's
 * December balance sheet is incomplete until the sync runs and restates it, and
 * then it changes. 🛑 **The PDF is the copy that gets emailed to an accountant**
 * - a screen at least has a person in front of it who can go and look again,
 * and a saved file does not. So the printed statement has to carry its own lag
 * more loudly than the screen does, not less.
 *
 * The four states are {@link describeProviderSyncCoverage}'s and NOT this
 * file's. Two implementations of "is this statement complete" is exactly the
 * bug the feature exists to prevent, so the wording, the thresholds and the
 * render-nothing case all come from that one pure function, the same one
 * `ProviderSyncMarker` on screen calls.
 *
 *   * **not connected** - `null`. Nothing at all, not "synced through: never".
 *   * **never synced** - the inverted box: everything of theirs is missing.
 *   * **behind** - the inverted box. The case this exists for.
 *   * **current** - one quiet grey line, deliberately not a box.
 *
 * @param marker null when the marker could not be read at all, which renders
 *   nothing for the same reason `not_connected` does: a missing line is a much
 *   smaller problem than a wrong one.
 * @param through the LAST date this statement covers
 */
export function ProviderSyncBlock(props: { marker: ProviderSyncMarker | null; through: string }) {
  const { marker, through } = props
  if (!marker) return null

  const reading = describeProviderSyncCoverage(marker, through)
  if (!reading.headline) return null

  if (reading.coverage === 'current') {
    return <Text style={statementStyles.syncedLine}>{reading.headline}</Text>
  }

  return (
    <View style={statementStyles.syncWarningBox} wrap={false}>
      <Text style={statementStyles.syncWarningKicker}>STATEMENT INCOMPLETE</Text>
      <Text style={statementStyles.syncWarningHeadline}>{reading.headline}</Text>
      {reading.detail ? (
        <Text style={statementStyles.syncWarningDetail}>{reading.detail}</Text>
      ) : null}
    </View>
  )
}

/**
 * The same reading, condensed to the one line the footer repeats on every page.
 *
 * The box above is read once, at the top of page one, and a statement is often
 * flipped to the page holding the number somebody cares about. `StatementFooter`
 * is already `fixed` and absolutely positioned, so carrying the headline there
 * costs no flow space and no per-page work while making the warning impossible
 * to page past - which, with no colour to lean on, is the other half of what
 * makes it unmissable.
 *
 * Null for `current` as well as for the two silent states: a complete statement
 * does not stamp every page with a note saying so.
 */
export function providerSyncFooterNotice(
  marker: ProviderSyncMarker | null,
  through: string
): string | null {
  if (!marker) return null
  const reading = describeProviderSyncCoverage(marker, through)
  return reading.coverage === 'behind' || reading.coverage === 'never_synced'
    ? reading.headline
    : null
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

/**
 * The statement footer: run date on the left, `Page X of Y` on the right -
 * `PrintFooter`'s defaults, self-contained.
 *
 * `notice` is {@link providerSyncFooterNotice}'s one line, printed between them
 * in dark bold against the band's grey. The band is `fixed`, so it repeats on
 * every page for free.
 */
export function StatementFooter(props: { dateLabel: string; notice?: string | null }) {
  const { dateLabel, notice } = props
  return (
    <View style={statementStyles.footerBand} fixed>
      <Text>{dateLabel}</Text>
      {notice ? <Text style={statementStyles.footerNotice}>{notice}</Text> : null}
      <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
    </View>
  )
}
