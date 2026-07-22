// packages/lib/src/export/pdf/detail-sheet-pdf.tsx
// @jsxRuntime automatic
// @jsxImportSource react

import { Document, Page, StyleSheet, Text, View } from '@react-pdf/renderer'
import type { ResolvedDocumentSettings } from '../../documents/resolve-settings'
import type { PrintConfig } from '../types'
import { PrintFooter, type PrintFrameTokens, PrintHeader } from './page-frame'
import { createDocumentStyles, pageSizeFor, resolveDetailOrientation } from './theme'

/** One field block shown in a detail sheet's label/value grid (the wizard's chosen columns,
 * relabeled "fields" for this style). */
export interface DetailSheetField {
  label: string
}

/** One printed record: its heading plus the same pre-formatted display strings the list style
 * emits, aligned 1:1 (by index) with `DetailSheetField[]`. */
export interface DetailSheetRecord {
  displayName: string
  values: string[]
}

/** Muted placeholder for a blank field value — the value column always shows something. */
const EMPTY_VALUE_PLACEHOLDER = '—'

const detailStyles = StyleSheet.create({
  record: { marginBottom: 18 },
  heading: {
    fontSize: 13,
    fontWeight: 'bold',
    color: '#111827',
    paddingBottom: 6,
    marginBottom: 6,
    borderBottom: '1 solid #111827',
  },
  fieldRow: {
    flexDirection: 'row',
    borderBottom: '1 solid #e5e7eb',
    paddingVertical: 4,
  },
  label: { width: '35%', fontSize: 9, color: '#6b7280', paddingRight: 8 },
  value: { flex: 1, fontSize: 9, color: '#111827' },
  emptyValue: { color: '#9ca3af' },
})

/**
 * Generic "one section per record, chosen fields as label/value blocks" print renderer
 * (plans/printing/01-unified-print.md §C's `detail` print style). One react-pdf `<Document>`
 * for the whole run: each record renders a heading (its `displayName`) followed by a
 * two-column label/value grid (~35% label column, the rest value) — a clean settings-sheet
 * look consistent with the `documents/` theme. Values are the exact same pre-formatted display
 * strings the list style's `rows: string[][]` carries (zero new formatting); a blank value
 * renders as a muted em-dash rather than an empty cell.
 *
 * `config.detail.pageBreakPerRecord` (default `true`) puts a hard page break (react-pdf
 * `break`) before every record after the first, so each record lands on its own page; when
 * `false`, records flow continuously, separated by the next heading's top border.
 *
 * Shares the exact `PrintHeader`/`PrintFooter` page frame and `createDocumentStyles`/
 * `pageSizeFor` tokens as `RecordsTablePdf` — only the orientation resolution differs (see
 * {@link resolveDetailOrientation}).
 */
export function DetailSheetPdf(props: {
  settings: ResolvedDocumentSettings
  logoBytes?: Buffer | null
  config: PrintConfig
  fields: DetailSheetField[]
  records: DetailSheetRecord[]
  tokens: PrintFrameTokens
}) {
  const { settings, logoBytes, config, fields, records, tokens } = props
  const styles = createDocumentStyles(settings)
  const orientation = resolveDetailOrientation(config.orientation)
  const pageBreakPerRecord = config.detail?.pageBreakPerRecord ?? true

  return (
    <Document>
      <Page size={pageSizeFor(config.paperSize)} orientation={orientation} style={styles.page} wrap>
        <PrintHeader header={config.header} tokens={tokens} logoBytes={logoBytes} />

        {records.map((record, r) => (
          <View key={r} style={detailStyles.record} break={pageBreakPerRecord && r > 0}>
            <Text style={detailStyles.heading}>
              {record.displayName || EMPTY_VALUE_PLACEHOLDER}
            </Text>
            {fields.map((field, i) => {
              const value = record.values[i]
              const isEmpty = !value
              return (
                <View key={i} style={detailStyles.fieldRow} wrap={false}>
                  <Text style={detailStyles.label}>{field.label}</Text>
                  <Text
                    style={
                      isEmpty ? [detailStyles.value, detailStyles.emptyValue] : detailStyles.value
                    }>
                    {isEmpty ? EMPTY_VALUE_PLACEHOLDER : value}
                  </Text>
                </View>
              )
            })}
          </View>
        ))}

        <PrintFooter footer={config.footer} tokens={tokens} />
      </Page>
    </Document>
  )
}
