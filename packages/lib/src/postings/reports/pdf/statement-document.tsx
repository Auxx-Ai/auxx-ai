// packages/lib/src/postings/reports/pdf/statement-document.tsx
// @jsxRuntime automatic
// @jsxImportSource react

import { Document, Page } from '@react-pdf/renderer'
import { createDocumentStyles, pageSizeFor } from '../../../documents/pdf/theme'
import type { ResolvedDocumentSettings } from '../../../documents/resolve-settings'
import type { CompletenessItem } from '../completeness'
import type { StatementColumn, StatementRow } from '../rows'
import {
  CompletenessBlock,
  GroupedRowsTable,
  StatementFooter,
  StatementTitleBlock,
} from './statement-parts'

/** Landscape once the column count passes this - a comparison column earns the extra width. */
const LANDSCAPE_COLUMN_THRESHOLD = 2

export function StatementPdfDocument(props: {
  settings: ResolvedDocumentSettings
  logoBytes?: Buffer | null
  orgName: string
  statementName: string
  rangeLabel: string
  runDateLabel: string
  columns: StatementColumn[]
  rows: StatementRow[]
  completeness: readonly CompletenessItem[]
}) {
  const {
    settings,
    logoBytes,
    orgName,
    statementName,
    rangeLabel,
    runDateLabel,
    columns,
    rows,
    completeness,
  } = props
  const styles = createDocumentStyles(settings)
  const orientation = columns.length > LANDSCAPE_COLUMN_THRESHOLD ? 'landscape' : 'portrait'

  return (
    <Document>
      <Page
        size={pageSizeFor(settings.branding.paperSize)}
        orientation={orientation}
        style={styles.page}
        wrap>
        <StatementTitleBlock
          styles={styles}
          orgName={orgName}
          statementName={statementName}
          rangeLabel={rangeLabel}
          currencyCode={settings.currency}
          logoBytes={logoBytes}
        />
        <CompletenessBlock items={completeness} />
        <GroupedRowsTable rows={rows} columns={columns} currencyCode={settings.currency} />
        <StatementFooter dateLabel={runDateLabel} />
      </Page>
    </Document>
  )
}
