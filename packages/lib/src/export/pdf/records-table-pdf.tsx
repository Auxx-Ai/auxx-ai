// packages/lib/src/export/pdf/records-table-pdf.tsx
// @jsxRuntime automatic
// @jsxImportSource react

import { FieldType as FieldTypeEnum } from '@auxx/database/enums'
import type { FieldType } from '@auxx/database/types'
import { Document, Page, StyleSheet, Text, View } from '@react-pdf/renderer'
import type { ResolvedDocumentSettings } from '../../documents/resolve-settings'
import type { PrintConfig } from '../types'
import { PrintFooter, type PrintFrameTokens, PrintHeader } from './page-frame'
import { createDocumentStyles, pageSizeFor, resolveOrientation } from './theme'

/** One column header for `<RecordsTablePdf>`. `fieldType` drives its proportional width. */
export interface RecordsTableColumn {
  label: string
  /** Undefined when a column had no results in the run (empty page) — treated as a
   * medium-width default. */
  fieldType?: FieldType
}

/** Wide, text-heavy field types get more of the row's width. */
const WIDE_FIELD_TYPES = new Set<FieldType>([
  FieldTypeEnum.TEXT,
  FieldTypeEnum.RICH_TEXT,
  FieldTypeEnum.EMAIL,
  FieldTypeEnum.URL,
  FieldTypeEnum.ADDRESS,
  FieldTypeEnum.ADDRESS_STRUCT,
  FieldTypeEnum.NAME,
  FieldTypeEnum.RELATIONSHIP,
  FieldTypeEnum.MULTI_SELECT,
  FieldTypeEnum.TAGS,
])

/** Narrow, short-value field types get less of the row's width. */
const NARROW_FIELD_TYPES = new Set<FieldType>([
  FieldTypeEnum.CHECKBOX,
  FieldTypeEnum.NUMBER,
  FieldTypeEnum.CURRENCY,
  FieldTypeEnum.DATE,
  FieldTypeEnum.DATETIME,
  FieldTypeEnum.TIME,
  FieldTypeEnum.SINGLE_SELECT,
])

/** Column flex weight (react-pdf/Yoga flexbox) — mirrors `documents/pdf/theme.ts`'s
 * `colDescription: { flex: 3 }` / `colQty: { flex: 1 }` convention rather than computing
 * percentage widths. */
function columnFlexWeight(fieldType: FieldType | undefined): number {
  if (fieldType && WIDE_FIELD_TYPES.has(fieldType)) return 3
  if (fieldType && NARROW_FIELD_TYPES.has(fieldType)) return 1
  return 2
}

/** Base list font size at ≤5 columns; `'shrink'` fit mode steps it down per extra column,
 * floored at 6pt (plans/printing/01-unified-print.md §C). `'wrap'` mode ignores this and
 * always uses the base size, wrapping cell text instead of shrinking it. */
function shrinkFontSize(columnCount: number): number {
  const base = 9
  const excessColumns = Math.max(0, columnCount - 5)
  return Math.max(6, base - excessColumns)
}

const tableStyles = StyleSheet.create({
  table: { marginTop: 4 },
  headerRow: {
    flexDirection: 'row',
    borderBottom: '1 solid #111827',
    paddingVertical: 4,
  },
  row: {
    flexDirection: 'row',
    borderBottom: '1 solid #e5e7eb',
    paddingVertical: 4,
  },
  headerCell: { fontWeight: 'bold' },
  cell: { paddingHorizontal: 3 },
})

/**
 * Generic "rows as a table" print renderer (plans/printing/01-unified-print.md §C's
 * `list` print style) — one react-pdf `<Document>` for the whole run. Column headers repeat
 * on every page (`fixed`); cell values are the exact display strings the CSV export emits
 * (`buildRow`/`formatCell`) — this component does zero additional formatting. Column widths
 * are proportional by `fieldType` (relationship/text/email wider than boolean/number/date);
 * `fitMode: 'shrink'` scales the font down as column count grows, `'wrap'` keeps 9pt and
 * lets long cells wrap.
 */
export function RecordsTablePdf(props: {
  settings: ResolvedDocumentSettings
  logoBytes?: Buffer | null
  config: PrintConfig
  columns: RecordsTableColumn[]
  /** Pre-formatted display strings, in column order — the CSV job's `buildRow` output. */
  rows: string[][]
  tokens: PrintFrameTokens
}) {
  const { settings, logoBytes, config, columns, rows, tokens } = props
  const styles = createDocumentStyles(settings)
  const orientation = resolveOrientation(config.orientation, columns.length)
  const fitMode = config.list?.fitMode ?? 'shrink'
  const fontSize = fitMode === 'shrink' ? shrinkFontSize(columns.length) : 9
  const weights = columns.map((c) => columnFlexWeight(c.fieldType))

  return (
    <Document>
      <Page size={pageSizeFor(config.paperSize)} orientation={orientation} style={styles.page} wrap>
        <PrintHeader header={config.header} tokens={tokens} logoBytes={logoBytes} />

        <View style={tableStyles.table}>
          <View style={tableStyles.headerRow} fixed>
            {columns.map((column, i) => (
              <Text
                key={i}
                style={[tableStyles.cell, tableStyles.headerCell, { flex: weights[i], fontSize }]}>
                {column.label}
              </Text>
            ))}
          </View>
          {rows.map((row, r) => (
            <View key={r} style={tableStyles.row} wrap={false}>
              {row.map((cell, i) => (
                <Text key={i} style={[tableStyles.cell, { flex: weights[i], fontSize }]}>
                  {cell}
                </Text>
              ))}
            </View>
          ))}
        </View>

        <PrintFooter footer={config.footer} tokens={tokens} />
      </Page>
    </Document>
  )
}
