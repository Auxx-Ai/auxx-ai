// packages/lib/src/documents/pdf/invoice-pdf.tsx
// @jsxRuntime automatic
// @jsxImportSource react

import { formatCurrency } from '@auxx/utils/currency'
import { Document, Page, Text, View } from '@react-pdf/renderer'
import type { InvoicePdfPayload } from '../payload'
import {
  BillingPartyBlock,
  DocumentFooter,
  DocumentHeader,
  formatDocDate,
  LineItemsTable,
  TotalsBlock,
} from './parts'
import { createDocumentStyles, pageSizeFor } from './theme'

/**
 * Payment-history table — date · method · reference · amount (money MI1 build spec §H.1).
 * Reuses the shared line-table styles from `theme.ts`; only rendered by `<InvoicePdf>` when
 * `settings.invoice.showPaymentHistory` is on and there's at least one succeeded ledger row.
 */
function PaymentHistoryBlock(props: {
  styles: ReturnType<typeof createDocumentStyles>
  payments: InvoicePdfPayload['payments']
  dateFormat: string
  currencyCode: string
}) {
  const { styles, payments, dateFormat, currencyCode } = props

  return (
    <View style={{ marginTop: 20 }}>
      <Text style={[styles.label, { marginBottom: 6 }]}>Payment history</Text>
      <View style={styles.table}>
        <View style={styles.tableHeaderRow}>
          <Text style={[styles.colDescription, styles.label]}>Date</Text>
          <Text style={[styles.colQty, styles.label]}>Method</Text>
          <Text style={[styles.colUnitPrice, styles.label]}>Reference</Text>
          <Text style={[styles.colAmount, styles.label]}>Amount</Text>
        </View>
        {payments.map((payment, i) => (
          <View key={i} style={styles.tableRow}>
            <Text style={styles.colDescription}>{formatDocDate(payment.date, dateFormat)}</Text>
            <Text style={styles.colQty}>{payment.method || '—'}</Text>
            <Text style={styles.colUnitPrice}>{payment.reference || '—'}</Text>
            <Text style={styles.colAmount}>{formatCurrency(payment.amount, { currencyCode })}</Text>
          </View>
        ))}
      </View>
    </View>
  )
}

/**
 * The invoice PDF document template (money MI1 build spec §H.1). Composes the same
 * document-agnostic `parts.tsx` building blocks as `quote-pdf.tsx`, plus invoice-only
 * pieces: Amount paid / Balance due rows in the totals block (split into "Deposit applied" +
 * "Payments" when `depositApplied > 0` — deposit-accounting plan 16 §E, presentation only,
 * see `TotalsBlock`), a payment-history table
 * (rendered when `settings.invoice.showPaymentHistory` and payments exist), a "Pay online"
 * line (`payload.payLink`, money MP1 build spec §J — plain URL v1, only present when the
 * org's Stripe account is connected + chargesEnabled), and payment-instructions text
 * (`settings.invoice.paymentInstructions`, when non-empty).
 */
export function InvoicePdf(props: {
  payload: InvoicePdfPayload
  logoBytes?: Buffer | null
  /** Batch-print copy label (P4) — see `DocumentHeader`'s `copyLabel`. */
  copyLabel?: string
}) {
  const { payload, logoBytes, copyLabel } = props
  const { settings } = payload
  const styles = createDocumentStyles(settings)
  const currencyCode = settings.currency
  const showPaymentHistory = settings.invoice.showPaymentHistory && payload.payments.length > 0

  return (
    <Document title={`${payload.number} — Invoice`}>
      <Page size={pageSizeFor(settings.branding.paperSize)} style={styles.page} wrap>
        <DocumentHeader
          styles={styles}
          documentLabel='Invoice'
          number={payload.number}
          issuedAt={payload.issuedAt}
          secondaryDate={payload.dueDate}
          secondaryDateLabel='Due'
          dateFormat={settings.branding.dateFormat}
          logoBytes={logoBytes}
          copyLabel={copyLabel}
        />

        <BillingPartyBlock styles={styles} business={settings.business} contact={payload.contact} />

        <LineItemsTable
          styles={styles}
          lines={payload.lines}
          lineDisplay={settings.invoice.lineDisplay}
          showDescriptions={settings.invoice.showDescriptions}
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
          amountPaid={payload.amountPaid}
          balance={payload.balance}
          depositApplied={payload.depositApplied}
        />

        {showPaymentHistory ? (
          <PaymentHistoryBlock
            styles={styles}
            payments={payload.payments}
            dateFormat={settings.branding.dateFormat}
            currencyCode={currencyCode}
          />
        ) : null}

        {payload.payLink ? (
          <View style={styles.terms}>
            <Text style={styles.label}>Pay online</Text>
            <Text style={styles.value}>{payload.payLink}</Text>
          </View>
        ) : null}

        {settings.invoice.paymentInstructions ? (
          <View style={styles.terms}>
            <Text style={styles.label}>Payment instructions</Text>
            <Text style={styles.value}>{settings.invoice.paymentInstructions}</Text>
          </View>
        ) : null}

        {payload.terms ? (
          <View style={styles.terms}>
            <Text style={styles.label}>Terms</Text>
            <Text style={styles.value}>{payload.terms}</Text>
          </View>
        ) : null}

        <DocumentFooter styles={styles} text={settings.invoice.footerText} />
      </Page>
    </Document>
  )
}
