// packages/lib/src/documents/pdf/quote-pdf.tsx
// @jsxRuntime automatic
// @jsxImportSource react

import { Document, Page, Text, View } from '@react-pdf/renderer'
import type { QuotePdfPayload } from '../payload'
import {
  BillingPartyBlock,
  DocumentFooter,
  DocumentHeader,
  LineItemsTable,
  TotalsBlock,
} from './parts'
import { createDocumentStyles, pageSizeFor } from './theme'

/**
 * The quote PDF document template (money MQ2 build spec §B.2). Composes the
 * document-agnostic `parts.tsx` building blocks — MI1's `invoice-pdf.tsx` reuses the same
 * parts with an `invoice` settings bucket instead of `quote`.
 */
export function QuotePdf(props: { payload: QuotePdfPayload; logoBytes?: Buffer | null }) {
  const { payload, logoBytes } = props
  const { settings } = payload
  const styles = createDocumentStyles(settings)
  const currencyCode = settings.currency

  return (
    <Document title={`${payload.number} — ${payload.title}`}>
      <Page size={pageSizeFor(settings.branding.paperSize)} style={styles.page} wrap>
        <DocumentHeader
          styles={styles}
          documentLabel='Quote'
          number={payload.number}
          issuedAt={payload.issuedAt}
          validUntil={payload.validUntil}
          dateFormat={settings.branding.dateFormat}
          logoBytes={logoBytes}
        />

        <BillingPartyBlock styles={styles} business={settings.business} contact={payload.contact} />

        {payload.title ? (
          <View style={{ marginBottom: 12 }}>
            <Text style={[styles.value, styles.bold]}>{payload.title}</Text>
          </View>
        ) : null}

        <LineItemsTable
          styles={styles}
          lines={payload.lines}
          lineDisplay={settings.quote.lineDisplay}
          showDescriptions={settings.quote.showDescriptions}
          currencyCode={currencyCode}
        />

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
