// packages/lib/src/documents/pdf/parts.tsx
// @jsxRuntime automatic
// @jsxImportSource react

import { formatCurrency } from '@auxx/utils/currency'
import { Image, Text, View } from '@react-pdf/renderer'
import { format } from 'date-fns'
import type { DocumentBusinessSettings } from '../resolve-settings'
import type { createDocumentStyles } from './theme'

/** Safe date formatter — `dateFormat` is a `date-fns` pattern (catalog options are literal tokens). */
export function formatDocDate(iso: string | null, dateFormat: string): string {
  if (!iso) return ''
  try {
    return format(new Date(iso), dateFormat)
  } catch {
    return iso
  }
}

type Styles = ReturnType<typeof createDocumentStyles>

/** Top header block — logo, document label ("Quote"/"Invoice"), number, dates. */
export function DocumentHeader(props: {
  styles: Styles
  documentLabel: string
  number: string
  issuedAt: string
  validUntil?: string | null
  dateFormat: string
  logoBytes?: Buffer | null
}) {
  const { styles, documentLabel, number, issuedAt, validUntil, dateFormat, logoBytes } = props
  return (
    <View style={styles.headerRow}>
      <View>
        <Text style={styles.h1}>{documentLabel}</Text>
        <Text style={styles.value}>{number}</Text>
      </View>
      <View style={{ alignItems: 'flex-end' }}>
        {logoBytes ? <Image style={styles.logo} src={logoBytes} /> : null}
        <View style={{ marginTop: 8 }}>
          <Text style={styles.label}>Issued</Text>
          <Text style={styles.value}>{formatDocDate(issuedAt, dateFormat)}</Text>
        </View>
        {validUntil ? (
          <View style={{ marginTop: 4 }}>
            <Text style={styles.label}>Valid until</Text>
            <Text style={styles.value}>{formatDocDate(validUntil, dateFormat)}</Text>
          </View>
        ) : null}
      </View>
    </View>
  )
}

/** Two-column billing-party block — "From" (business identity) / "To" (contact). */
export function BillingPartyBlock(props: {
  styles: Styles
  business: DocumentBusinessSettings
  contact: {
    name: string
    email?: string | null
    phone?: string | null
    city?: string | null
    region?: string | null
    country?: string | null
  }
}) {
  const { styles, business, contact } = props
  const businessCityLine = [business.address?.city, business.address?.region, business.address?.zip]
    .filter(Boolean)
    .join(', ')
  const contactCityLine = [contact.city, contact.region].filter(Boolean).join(', ')

  return (
    <View style={styles.partiesRow}>
      <View style={styles.partyBlock}>
        <Text style={styles.label}>From</Text>
        <Text style={[styles.value, styles.bold]}>{business.companyName || ' '}</Text>
        {business.address?.line1 ? (
          <Text style={styles.value}>{business.address.line1}</Text>
        ) : null}
        {business.address?.line2 ? (
          <Text style={styles.value}>{business.address.line2}</Text>
        ) : null}
        {businessCityLine ? <Text style={styles.value}>{businessCityLine}</Text> : null}
        {business.address?.country ? (
          <Text style={styles.value}>{business.address.country}</Text>
        ) : null}
        {business.phone ? <Text style={styles.value}>{business.phone}</Text> : null}
        {business.email ? <Text style={styles.value}>{business.email}</Text> : null}
        {business.taxId ? (
          <Text style={styles.value}>
            {business.taxId.label}: {business.taxId.value}
          </Text>
        ) : null}
      </View>
      <View style={styles.partyBlock}>
        <Text style={styles.label}>To</Text>
        <Text style={[styles.value, styles.bold]}>{contact.name || ' '}</Text>
        {contactCityLine ? <Text style={styles.value}>{contactCityLine}</Text> : null}
        {contact.country ? <Text style={styles.value}>{contact.country}</Text> : null}
        {contact.email ? <Text style={styles.value}>{contact.email}</Text> : null}
        {contact.phone ? <Text style={styles.value}>{contact.phone}</Text> : null}
      </View>
    </View>
  )
}

/** One line-item row shape shared by quote + (MI1) invoice tables. */
export interface DocumentLineRow {
  name: string
  description?: string | null
  qty: number
  unitPrice: number | null
  lineTotal: number | null
}

/**
 * Line-item table. `lineDisplay: 'amount_only'` collapses qty/unit-price into a single
 * amount column — the fixed-price mode that hides the internal cost breakdown from the
 * customer (money MQ2 build spec §A.2/§B.2).
 */
export function LineItemsTable(props: {
  styles: Styles
  lines: DocumentLineRow[]
  lineDisplay: 'full' | 'amount_only'
  showDescriptions: boolean
  currencyCode: string
}) {
  const { styles, lines, lineDisplay, showDescriptions, currencyCode } = props
  const full = lineDisplay === 'full'

  return (
    <View style={styles.table}>
      <View style={styles.tableHeaderRow}>
        <Text style={[styles.colDescription, styles.label]}>Description</Text>
        {full ? <Text style={[styles.colQty, styles.label]}>Qty</Text> : null}
        {full ? <Text style={[styles.colUnitPrice, styles.label]}>Unit price</Text> : null}
        <Text style={[styles.colAmount, styles.label]}>Amount</Text>
      </View>
      {lines.map((line, i) => (
        <View key={i} style={styles.tableRow}>
          <View style={styles.colDescription}>
            <Text style={styles.lineName}>{line.name}</Text>
            {showDescriptions && line.description ? (
              <Text style={styles.lineDescription}>{line.description}</Text>
            ) : null}
          </View>
          {full ? <Text style={styles.colQty}>{line.qty}</Text> : null}
          {full ? (
            <Text style={styles.colUnitPrice}>
              {formatCurrency(line.unitPrice, { currencyCode })}
            </Text>
          ) : null}
          <Text style={styles.colAmount}>{formatCurrency(line.lineTotal, { currencyCode })}</Text>
        </View>
      ))}
    </View>
  )
}

/** Subtotal / discount / tax / total block, right-aligned under the line table. */
export function TotalsBlock(props: {
  styles: Styles
  currencyCode: string
  subtotal: number
  discountType?: 'percent' | 'amount' | null
  discountValue?: number | null
  discountAmount: number
  taxName?: string | null
  taxRate?: number | null
  taxTotal: number
  total: number
}) {
  const { styles, currencyCode, subtotal, discountType, discountValue, discountAmount } = props
  const { taxName, taxRate, taxTotal, total } = props
  const fmt = (cents: number) => formatCurrency(cents, { currencyCode })

  return (
    <View style={styles.totalsBlock}>
      <View style={styles.totalsRow}>
        <Text style={styles.value}>Subtotal</Text>
        <Text style={styles.value}>{fmt(subtotal)}</Text>
      </View>
      {discountAmount > 0 ? (
        <View style={styles.totalsRow}>
          <Text style={styles.value}>
            Discount{discountType === 'percent' && discountValue ? ` (${discountValue}%)` : ''}
          </Text>
          <Text style={styles.value}>-{fmt(discountAmount)}</Text>
        </View>
      ) : null}
      {taxTotal > 0 ? (
        <View style={styles.totalsRow}>
          <Text style={styles.value}>
            {taxName || 'Tax'}
            {taxRate ? ` (${taxRate}%)` : ''}
          </Text>
          <Text style={styles.value}>{fmt(taxTotal)}</Text>
        </View>
      ) : null}
      <View style={styles.totalsRowFinal}>
        <Text style={[styles.value, styles.bold, styles.accentText]}>Total</Text>
        <Text style={[styles.value, styles.bold, styles.accentText]}>{fmt(total)}</Text>
      </View>
    </View>
  )
}

/** Fixed footer — printed on every page via react-pdf's `fixed` prop. */
export function DocumentFooter(props: { styles: Styles; text?: string | null }) {
  const { styles, text } = props
  if (!text) return null
  return (
    <Text style={styles.footer} fixed>
      {text}
    </Text>
  )
}
