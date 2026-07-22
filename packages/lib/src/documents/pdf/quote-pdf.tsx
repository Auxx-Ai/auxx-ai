// packages/lib/src/documents/pdf/quote-pdf.tsx
// @jsxRuntime automatic
// @jsxImportSource react

import { Document, Page, Text, View } from '@react-pdf/renderer'
import type { QuotePdfPayload } from '../payload'
import {
  BillingPartyBlock,
  DocumentFooter,
  DocumentHeader,
  type DocumentLineRow,
  LineItemsTable,
  TotalsBlock,
} from './parts'
import { createDocumentStyles, pageSizeFor } from './theme'

/**
 * The quote PDF document template (money MQ2 build spec §B.2). Composes the
 * document-agnostic `parts.tsx` building blocks — MI1's `invoice-pdf.tsx` reuses the same
 * parts with an `invoice` settings bucket instead of `quote`.
 *
 * Optional line items (money plan 18 §7): pre-checked (`optional && optionalSelected`) lines
 * stay in the main list, tagged "Optional · included"; deselected options move to a visually
 * separated "Optional add-ons" block with prices but excluded from every total (they already
 * are — `payload.subtotal`/`total` were computed with the exclusion applied, decision 4). The
 * note that add-ons can be picked on the online quote page renders unconditionally: whether
 * `documents.quote.acceptancePageEnabled` is on isn't part of `QuotePdfPayload` today (only the
 * public quote-page's own payload carries it) and this wave intentionally doesn't plumb a new
 * setting through the PDF payload just for this note.
 */
export function QuotePdf(props: {
  payload: QuotePdfPayload
  logoBytes?: Buffer | null
  /** Batch-print copy label (P4) — see `DocumentHeader`'s `copyLabel`. */
  copyLabel?: string
}) {
  const { payload, logoBytes, copyLabel } = props
  const { settings } = payload
  const styles = createDocumentStyles(settings)
  const currencyCode = settings.currency

  const mainLines: DocumentLineRow[] = []
  const addOnLines: DocumentLineRow[] = []
  for (const line of payload.lines) {
    const row: DocumentLineRow = {
      name: line.name,
      description: line.description,
      qty: line.qty,
      unit: line.unit,
      unitPrice: line.unitPrice,
      lineTotal: line.lineTotal,
    }
    if (line.optional && !line.optionalSelected) {
      addOnLines.push(row)
    } else {
      mainLines.push(line.optional ? { ...row, tag: 'Optional · included' } : row)
    }
  }

  return (
    <Document title={`${payload.number} — ${payload.title}`}>
      <Page size={pageSizeFor(settings.branding.paperSize)} style={styles.page} wrap>
        <DocumentHeader
          styles={styles}
          documentLabel='Quote'
          number={payload.number}
          issuedAt={payload.issuedAt}
          secondaryDate={payload.validUntil}
          dateFormat={settings.branding.dateFormat}
          logoBytes={logoBytes}
          copyLabel={copyLabel}
        />

        <BillingPartyBlock styles={styles} business={settings.business} contact={payload.contact} />

        {payload.title ? (
          <View style={{ marginBottom: 12 }}>
            <Text style={[styles.value, styles.bold]}>{payload.title}</Text>
          </View>
        ) : null}

        <LineItemsTable
          styles={styles}
          lines={mainLines}
          lineDisplay={settings.quote.lineDisplay}
          showDescriptions={settings.quote.showDescriptions}
          currencyCode={currencyCode}
        />

        {addOnLines.length > 0 ? (
          <View style={{ marginTop: 16 }}>
            <Text style={[styles.label, { marginBottom: 6 }]}>Optional add-ons</Text>
            <LineItemsTable
              styles={styles}
              lines={addOnLines}
              lineDisplay={settings.quote.lineDisplay}
              showDescriptions={settings.quote.showDescriptions}
              currencyCode={currencyCode}
            />
            <Text style={[styles.value, { marginTop: 6, fontSize: 8, color: '#6b7280' }]}>
              These add-ons aren&apos;t included in the total above — they can be added on the
              online quote page.
            </Text>
          </View>
        ) : null}

        <TotalsBlock
          styles={styles}
          currencyCode={currencyCode}
          subtotal={payload.subtotal}
          discountType={payload.discountType}
          discountValue={payload.discountValue}
          discountAmount={payload.discountAmount}
          taxName={payload.taxName}
          taxRate={payload.taxRate}
          taxTotal={payload.taxTotal}
          total={payload.total}
        />

        {payload.terms ? (
          <View style={styles.terms}>
            <Text style={styles.label}>Terms</Text>
            <Text style={styles.value}>{payload.terms}</Text>
          </View>
        ) : null}

        <DocumentFooter styles={styles} text={settings.quote.footerText} />
      </Page>
    </Document>
  )
}
