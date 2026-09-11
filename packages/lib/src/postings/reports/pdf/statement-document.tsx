// packages/lib/src/postings/reports/pdf/statement-document.tsx
// @jsxRuntime automatic
// @jsxImportSource react

import { Document, Page } from '@react-pdf/renderer'
import { createDocumentStyles, pageSizeFor } from '../../../documents/pdf/theme'
import type { ResolvedDocumentSettings } from '../../../documents/resolve-settings'
import type { ProviderSyncMarker } from '../../provider-sync/client'
import type { CompletenessItem } from '../completeness'
import type { StatementColumn, StatementRow } from '../rows'
import {
  CompletenessBlock,
  GroupedRowsTable,
  ProviderSyncBlock,
  providerSyncFooterNotice,
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
  /**
   * How far the inbound provider sync has read, or null when the org has none
   * and when the marker could not be read (brief 20 §7.3).
   */
  providerSyncMarker: ProviderSyncMarker | null
  /** The LAST date this statement covers, which is what the marker is judged against. */
  statementThrough: string
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
    providerSyncMarker,
    statementThrough,
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
        {/* Above the completeness box on purpose: "these figures will change"
            outranks "here is what is not in them yet". */}
        <ProviderSyncBlock marker={providerSyncMarker} through={statementThrough} />
        <CompletenessBlock items={completeness} />
        <GroupedRowsTable rows={rows} columns={columns} currencyCode={settings.currency} />
        <StatementFooter
          dateLabel={runDateLabel}
          notice={providerSyncFooterNotice(providerSyncMarker, statementThrough)}
        />
      </Page>
    </Document>
  )
}
