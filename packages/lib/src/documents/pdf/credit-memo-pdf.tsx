// packages/lib/src/documents/pdf/credit-memo-pdf.tsx
// @jsxRuntime automatic
// @jsxImportSource react

import { formatCurrency } from '@auxx/utils/currency'
import { Document, Page, Text, View } from '@react-pdf/renderer'
import type { CreditMemoPdfPayload } from '../payload'
import { BillingPartyBlock, DocumentFooter, DocumentHeader } from './parts'
import { createDocumentStyles, pageSizeFor } from './theme'

type Styles = ReturnType<typeof createDocumentStyles>

/** Formats a quantity without trailing zeros, up to 3 decimal places, like the line table. */
function formatQty(qty: number): string {
  return String(Number(qty.toFixed(3)))
}

/**
 * The credited-lines table: description, qty, unit price, subtotal, tax. Five columns
 * rather than `LineItemsTable`'s four because a memo's tax is transcribed per line and the
 * customer needs to see which part of the credit is tax. A `null` tax prints blank: the
 * field doc says null is not zero.
 */
function CreditLinesTable(props: {
  styles: Styles
  lines: CreditMemoPdfPayload['lines']
  currencyCode: string
}) {
  const { styles, lines, currencyCode } = props
  const colTax = { flex: 1, paddingHorizontal: 4, textAlign: 'right' as const }

  return (
    <View style={styles.table}>
      <View style={styles.tableHeaderRow}>
        <Text style={[styles.colDescription, styles.label]}>Description</Text>
        <Text style={[styles.colQty, styles.label]}>Qty</Text>
        <Text style={[styles.colUnitPrice, styles.label]}>Unit price</Text>
        <Text style={[styles.colAmount, styles.label]}>Subtotal</Text>
        <Text style={[colTax, styles.label]}>Tax</Text>
      </View>
      {lines.map((line) => (
        <View key={line.lineInstanceId} style={styles.tableRow}>
          <View style={styles.colDescription}>
            <Text style={styles.lineName}>{line.name}</Text>
          </View>
          <Text style={styles.colQty}>{formatQty(line.qty)}</Text>
          <Text style={styles.colUnitPrice}>
            {formatCurrency(line.unitPrice, { currencyCode })}
          </Text>
          <Text style={styles.colAmount}>{formatCurrency(line.subtotal, { currencyCode })}</Text>
          <Text style={colTax}>
            {line.taxTotal === null ? '' : formatCurrency(line.taxTotal, { currencyCode })}
          </Text>
        </View>
      ))}
    </View>
  )
}

/**
 * Subtotal / tax / total credit block, then the settlement rows (applied, refunded,
 * remaining) whenever any settlement has happened. Not `TotalsBlock`: that component's
 * extra rows are named for an invoice ("Amount paid", "Balance due") and a credit memo
 * reads the other way round.
 */
function CreditTotalsBlock(props: { styles: Styles; payload: CreditMemoPdfPayload }) {
  const { styles, payload } = props
  const currencyCode = payload.settings.currency
  const fmt = (cents: number) => formatCurrency(cents, { currencyCode })
  const settled = payload.amountApplied > 0 || payload.amountRefunded > 0

  return (
    <View style={styles.totalsBlock}>
      <View style={styles.totalsRow}>
        <Text style={styles.value}>Subtotal</Text>
        <Text style={styles.value}>{fmt(payload.subtotal)}</Text>
      </View>
      {payload.taxTotal > 0 ? (
        <View style={styles.totalsRow}>
          <Text style={styles.value}>Tax</Text>
          <Text style={styles.value}>{fmt(payload.taxTotal)}</Text>
        </View>
      ) : null}
      <View style={styles.totalsRowFinal}>
        <Text style={[styles.value, styles.bold, styles.accentText]}>Total credit</Text>
        <Text style={[styles.value, styles.bold, styles.accentText]}>{fmt(payload.total)}</Text>
      </View>
      {payload.amountApplied > 0 ? (
        <View style={styles.totalsRow}>
          <Text style={styles.value}>Applied to invoices</Text>
          <Text style={styles.value}>-{fmt(payload.amountApplied)}</Text>
        </View>
      ) : null}
      {payload.amountRefunded > 0 ? (
        <View style={styles.totalsRow}>
          <Text style={styles.value}>Refunded</Text>
          <Text style={styles.value}>-{fmt(payload.amountRefunded)}</Text>
        </View>
      ) : null}
      {settled ? (
        <View style={styles.totalsRow}>
          <Text style={[styles.value, styles.bold]}>Remaining credit</Text>
          <Text style={[styles.value, styles.bold]}>{fmt(payload.balance)}</Text>
        </View>
      ) : null}
    </View>
  )
}

/**
 * The credit memo PDF (plans/accounting/tasks/10-credit-memos.md §6.3): the invoice
 * layout with the title changed, the original invoice number printed when the memo was
 * raised against one, and the credited lines with their transcribed tax. Reuses the
 * invoice's `lineDisplay`/footer settings, since a credit memo is the same customer-facing
 * document family and has no settings block of its own.
 */
export function CreditMemoPdf(props: {
  payload: CreditMemoPdfPayload
  logoBytes?: Buffer | null
  /** Accepted for the shared registry contract; a credit memo carries no photos. */
  photoBytes?: Map<string, Buffer>
  /** Batch-print copy label, see `DocumentHeader`'s `copyLabel`. */
  copyLabel?: string
}) {
  const { payload, logoBytes, copyLabel } = props
  const { settings } = payload
  const styles = createDocumentStyles(settings)
  const currencyCode = settings.currency

  return (
    <Document title={`${payload.number} - Credit Memo`}>
      <Page size={pageSizeFor(settings.branding.paperSize)} style={styles.page} wrap>
        <DocumentHeader
          styles={styles}
          documentLabel='Credit Memo'
          number={payload.number}
          issuedAt={payload.issuedAt}
          dateFormat={settings.branding.dateFormat}
          logoBytes={logoBytes}
          copyLabel={copyLabel}
        />

        <BillingPartyBlock styles={styles} business={settings.business} contact={payload.contact} />

        {payload.invoiceNumber || payload.reason ? (
          <View style={{ flexDirection: 'row', gap: 24, marginTop: 12 }}>
            {payload.invoiceNumber ? (
              <View>
                <Text style={styles.label}>Original invoice</Text>
                <Text style={styles.value}>{payload.invoiceNumber}</Text>
              </View>
            ) : null}
            {payload.reason ? (
              <View>
                <Text style={styles.label}>Reason</Text>
                <Text style={styles.value}>{payload.reason}</Text>
              </View>
            ) : null}
          </View>
        ) : null}

        <CreditLinesTable styles={styles} lines={payload.lines} currencyCode={currencyCode} />

        <CreditTotalsBlock styles={styles} payload={payload} />

        {payload.note ? (
          <View style={styles.terms}>
            <Text style={styles.label}>Note</Text>
            <Text style={styles.value}>{payload.note}</Text>
          </View>
        ) : null}

        <DocumentFooter styles={styles} text={settings.invoice.footerText} />
      </Page>
    </Document>
  )
}
