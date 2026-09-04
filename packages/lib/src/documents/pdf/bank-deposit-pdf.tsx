// packages/lib/src/documents/pdf/bank-deposit-pdf.tsx
// @jsxRuntime automatic
// @jsxImportSource react

import { formatCurrency } from '@auxx/utils/currency'
import { Document, Page, Text, View } from '@react-pdf/renderer'
import type { BankDepositPdfPayload } from '../payload'
import type { DocumentBusinessSettings } from '../resolve-settings'
import { DocumentHeader, formatDocDate } from './parts'
import { createDocumentStyles, pageSizeFor } from './theme'

type Styles = ReturnType<typeof createDocumentStyles>

/**
 * Two-column head block - who is banking, and where.
 *
 * Local rather than `parts.tsx`'s `BillingPartyBlock`, which is a From/To built
 * around a `contact`: a deposit slip has no counterparty at all. It is OUR
 * document about OUR bank run, so the second column is the ACCOUNT rather than
 * a party.
 */
function BankDepositParties(props: {
  styles: Styles
  business: DocumentBusinessSettings
  bankAccountCode: string
  bankAccountName: string | null
  reference: string | null
  status: string
}) {
  const { styles, business, bankAccountCode, bankAccountName, reference, status } = props
  const businessCityLine = [
    business.address?.city,
    business.address?.state,
    business.address?.zipCode,
  ]
    .filter(Boolean)
    .join(', ')

  return (
    <View style={styles.partiesRow}>
      <View style={styles.partyBlock}>
        <Text style={styles.label}>Depositor</Text>
        <Text style={[styles.value, styles.bold]}>{business.companyName || ' '}</Text>
        {business.address?.street1 ? (
          <Text style={styles.value}>{business.address.street1}</Text>
        ) : null}
        {businessCityLine ? <Text style={styles.value}>{businessCityLine}</Text> : null}
        {business.phone ? <Text style={styles.value}>{business.phone}</Text> : null}
      </View>

      <View style={styles.partyBlock}>
        <Text style={styles.label}>Deposit to</Text>
        <Text style={[styles.value, styles.bold]}>
          {bankAccountName ? `${bankAccountCode} ${bankAccountName}` : bankAccountCode || ' '}
        </Text>
        {reference ? (
          <View style={{ marginTop: 4 }}>
            <Text style={styles.label}>Slip reference</Text>
            <Text style={styles.value}>{reference}</Text>
          </View>
        ) : null}
        <View style={{ marginTop: 4 }}>
          <Text style={styles.label}>Status</Text>
          <Text style={styles.value}>{status === 'cleared' ? 'Cleared' : 'Pending'}</Text>
        </View>
      </View>
    </View>
  )
}

/**
 * The banked payments, one row each.
 *
 * Local rather than `parts.tsx`'s `LineItemsTable`, whose columns are
 * Description / Qty / Unit price / Amount. A deposit slip's columns are Payer /
 * Method / Reference / Date / Amount: there is no quantity and no unit price,
 * and the REFERENCE is the column a teller actually reads, because it is the
 * cheque number. Composed from the same `theme.ts` styles, so the two tables
 * are visually identical.
 */
function BankDepositLines(props: {
  styles: Styles
  currencyCode: string
  dateFormat: string
  lines: BankDepositPdfPayload['lines']
}) {
  const { styles, currencyCode, dateFormat, lines } = props
  const col = { flex: 1, paddingHorizontal: 4 }

  return (
    <View style={styles.table}>
      <View style={styles.tableHeaderRow}>
        <Text style={[styles.label, { flex: 2, paddingHorizontal: 4 }]}>Payer</Text>
        <Text style={[styles.label, col]}>Method</Text>
        <Text style={[styles.label, col]}>Reference</Text>
        <Text style={[styles.label, col]}>Received</Text>
        <Text style={[styles.label, styles.colAmount]}>Amount</Text>
      </View>
      {lines.map((line, index) => (
        <View
          // No stable id on a slip line: the payer/reference pair repeats
          // legitimately (two cheques from one customer with no number written),
          // so the index is the only honest key.
          key={`${line.reference}-${line.payer}-${index}`}
          style={styles.tableRow}>
          <Text style={[styles.lineName, { flex: 2, paddingHorizontal: 4 }]}>
            {line.payer || '-'}
          </Text>
          <Text style={[styles.lineName, col]}>{line.method || '-'}</Text>
          <Text style={[styles.lineName, col]}>{line.reference || '-'}</Text>
          <Text style={[styles.lineName, col]}>
            {line.date ? formatDocDate(line.date, dateFormat) : '-'}
          </Text>
          <Text style={[styles.lineName, styles.colAmount]}>
            {formatCurrency(line.amount, { currencyCode })}
          </Text>
        </View>
      ))}
    </View>
  )
}

/**
 * The deposit slip (plans/accounting/ui-plan.md §5.3) - the internal document
 * that says which receipts make up one bank line.
 *
 * ⚠️ A BANK deposit, not a customer deposit. It is never sent to a customer:
 * it is carried to a teller or filed against the statement, which is why there
 * is no terms block, no payment link and no acceptance language.
 *
 * 🛑 The printed total is `payload.total`, TRANSCRIBED from the record, and the
 * count line is derived from the rows. If the two ever disagree the slip says
 * so out loud rather than quietly printing a recomputed sum, because the stored
 * total is what the ledger posted and what the bank will compare against.
 */
export function BankDepositPdf(props: {
  payload: BankDepositPdfPayload
  logoBytes?: Buffer | null
  /** Accepted for the registry's component contract; a deposit slip carries no photos. */
  photoBytes?: Map<string, Buffer>
  /** Batch-print copy label (P4) - see `DocumentHeader`'s `copyLabel`. */
  copyLabel?: string
}) {
  const { payload, logoBytes, copyLabel } = props
  const { settings } = payload
  const styles = createDocumentStyles(settings)
  const currencyCode = settings.currency
  const fmt = (minorUnits: number) => formatCurrency(minorUnits, { currencyCode })
  const lineSum = payload.lines.reduce((sum, line) => sum + line.amount, 0)

  return (
    <Document title={`${payload.number} - Deposit slip`}>
      <Page size={pageSizeFor(settings.branding.paperSize)} style={styles.page} wrap>
        <DocumentHeader
          styles={styles}
          documentLabel='Deposit slip'
          number={payload.number}
          issuedAt={payload.issuedAt}
          dateFormat={settings.branding.dateFormat}
          logoBytes={logoBytes}
          copyLabel={copyLabel}
        />

        <BankDepositParties
          styles={styles}
          business={settings.business}
          bankAccountCode={payload.bankAccountCode}
          bankAccountName={payload.bankAccountName}
          reference={payload.reference}
          status={payload.status}
        />

        <BankDepositLines
          styles={styles}
          currencyCode={currencyCode}
          dateFormat={settings.branding.dateFormat}
          lines={payload.lines}
        />

        <View style={styles.totalsBlock}>
          <View style={styles.totalsRow}>
            <Text style={styles.value}>
              {payload.lines.length} item{payload.lines.length === 1 ? '' : 's'}
            </Text>
            <Text style={styles.value}>{fmt(lineSum)}</Text>
          </View>
          <View style={styles.totalsRowFinal}>
            <Text style={[styles.value, styles.bold, styles.accentText]}>Deposit total</Text>
            <Text style={[styles.value, styles.bold, styles.accentText]}>{fmt(payload.total)}</Text>
          </View>
        </View>

        {lineSum !== payload.total ? (
          <View style={styles.terms}>
            <Text style={styles.value}>
              The listed items sum to {fmt(lineSum)} but this deposit was recorded and posted at{' '}
              {fmt(payload.total)}. Reverse the posting and regroup before banking this slip.
            </Text>
          </View>
        ) : null}
      </Page>
    </Document>
  )
}
