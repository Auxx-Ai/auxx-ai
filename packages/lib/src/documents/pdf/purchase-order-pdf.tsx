// packages/lib/src/documents/pdf/purchase-order-pdf.tsx
// @jsxRuntime automatic
// @jsxImportSource react

import { formatCurrency } from '@auxx/utils/currency'
import { Document, Page, Text, View } from '@react-pdf/renderer'
import type { PurchaseOrderPdfPayload, PurchaseOrderPdfVendor, QuotePdfContact } from '../payload'
import type { DocumentBusinessSettings } from '../resolve-settings'
import { DocumentHeader, type DocumentLineRow, LineItemsTable } from './parts'
import { createDocumentStyles, pageSizeFor } from './theme'

type Styles = ReturnType<typeof createDocumentStyles>

/**
 * Three-column party block — buyer / vendor / ship-to.
 *
 * Local rather than `parts.tsx`'s `BillingPartyBlock`, which is a two-column From/To built
 * around a `contact`: it has nowhere to put a ship-to at all, and it renders no street lines
 * for the addressee (a `contact` has none), so a vendor's street address would be silently
 * dropped. Composed from the same `theme.ts` styles, the way `invoice-pdf.tsx` builds its
 * payment-history table.
 */
function PurchaseOrderParties(props: {
  styles: Styles
  business: DocumentBusinessSettings
  vendor: PurchaseOrderPdfVendor
  /** The person the order is sent to — routinely empty, so every line is guarded. */
  contact: QuotePdfContact
  shipToLines: string[]
}) {
  const { styles, business, vendor, contact, shipToLines } = props
  const businessCityLine = [
    business.address?.city,
    business.address?.state,
    business.address?.zipCode,
  ]
    .filter(Boolean)
    .join(', ')
  const column = { width: '31%' }

  return (
    <View style={styles.partiesRow}>
      <View style={column}>
        <Text style={styles.label}>From</Text>
        <Text style={[styles.value, styles.bold]}>{business.companyName || ' '}</Text>
        {business.address?.street1 ? (
          <Text style={styles.value}>{business.address.street1}</Text>
        ) : null}
        {business.address?.street2 ? (
          <Text style={styles.value}>{business.address.street2}</Text>
        ) : null}
        {businessCityLine ? <Text style={styles.value}>{businessCityLine}</Text> : null}
        {business.address?.country ? (
          <Text style={styles.value}>{business.address.country}</Text>
        ) : null}
        {business.phone ? <Text style={styles.value}>{business.phone}</Text> : null}
        {business.email ? <Text style={styles.value}>{business.email}</Text> : null}
      </View>

      <View style={column}>
        <Text style={styles.label}>Vendor</Text>
        <Text style={[styles.value, styles.bold]}>{vendor.name || ' '}</Text>
        {vendor.addressLines.map((line) => (
          <Text key={line} style={styles.value}>
            {line}
          </Text>
        ))}
        {vendor.website ? <Text style={styles.value}>{vendor.website}</Text> : null}
        {contact.name ? <Text style={styles.value}>Attn: {contact.name}</Text> : null}
        {contact.email ? <Text style={styles.value}>{contact.email}</Text> : null}
        {contact.phone ? <Text style={styles.value}>{contact.phone}</Text> : null}
      </View>

      <View style={column}>
        <Text style={styles.label}>Ship to</Text>
        {shipToLines.length > 0 ? (
          shipToLines.map((line) => (
            <Text key={line} style={styles.value}>
              {line}
            </Text>
          ))
        ) : (
          <Text style={styles.value}> </Text>
        )}
      </View>
    </View>
  )
}

/**
 * Subtotal / discount / shipping / tax / total, right-aligned under the line table.
 *
 * Local rather than `parts.tsx`'s `TotalsBlock`, which has no row for freight: a purchase
 * order's `shippingTotal` is a stated header amount added on top of the discounted subtotal,
 * so without it the printed rows would not sum to the printed total. Same `theme.ts` styles
 * as the shared block, so the two are visually identical.
 */
function PurchaseOrderTotals(props: {
  styles: Styles
  currencyCode: string
  subtotal: number
  discountAmount: number
  shippingTotal: number
  taxTotal: number
  total: number
}) {
  const { styles, currencyCode, subtotal, discountAmount, shippingTotal, taxTotal, total } = props
  const fmt = (minorUnits: number) => formatCurrency(minorUnits, { currencyCode })

  return (
    <View style={styles.totalsBlock}>
      <View style={styles.totalsRow}>
        <Text style={styles.value}>Subtotal</Text>
        <Text style={styles.value}>{fmt(subtotal)}</Text>
      </View>
      {discountAmount > 0 ? (
        <View style={styles.totalsRow}>
          <Text style={styles.value}>Discount</Text>
          <Text style={styles.value}>-{fmt(discountAmount)}</Text>
        </View>
      ) : null}
      {shippingTotal > 0 ? (
        <View style={styles.totalsRow}>
          <Text style={styles.value}>Shipping</Text>
          <Text style={styles.value}>{fmt(shippingTotal)}</Text>
        </View>
      ) : null}
      {taxTotal > 0 ? (
        <View style={styles.totalsRow}>
          <Text style={styles.value}>Tax</Text>
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

/**
 * The purchase order PDF template (plans/purchasing/07 §1.3). Composes the same
 * `DocumentHeader` / `LineItemsTable` / `theme.ts` frame as `quote-pdf.tsx` and
 * `invoice-pdf.tsx`, but says what a purchase order says: it instructs a vendor rather than
 * selling to a customer, so there is no optional-line block, no acceptance language and no
 * customer-facing pricing presentation.
 *
 * The vendor SKU rides in each row's `tag` slot — `LineItemsTable` has a fixed
 * Description/Qty/Unit price/Amount shape with no SKU column, and a line whose
 * `purchase_order_line_vendor_part` is unset simply carries no tag.
 *
 * `lineDisplay` is pinned to `'full'` rather than read from settings: the
 * `documents.*.lineDisplay` `'amount_only'` mode exists to hide a cost breakdown from a
 * CUSTOMER, and a vendor order with no quantities or unit prices is not an order.
 */
export function PurchaseOrderPdf(props: {
  payload: PurchaseOrderPdfPayload
  logoBytes?: Buffer | null
  /** Accepted for the registry's component contract; a purchase order carries no photos. */
  photoBytes?: Map<string, Buffer>
  /** Batch-print copy label (P4) — see `DocumentHeader`'s `copyLabel`. */
  copyLabel?: string
}) {
  const { payload, logoBytes, copyLabel } = props
  const { settings } = payload
  const styles = createDocumentStyles(settings)
  const currencyCode = payload.currency

  const lines: DocumentLineRow[] = payload.lines.map((line) => ({
    name: line.name,
    description: null,
    qty: line.qty,
    unit: null,
    unitPrice: line.unitPrice,
    lineTotal: line.lineTotal,
    tag: line.vendorSku ? `SKU ${line.vendorSku}` : null,
  }))

  return (
    <Document title={`${payload.number} — Purchase Order`}>
      <Page size={pageSizeFor(settings.branding.paperSize)} style={styles.page} wrap>
        <DocumentHeader
          styles={styles}
          documentLabel='Purchase Order'
          number={payload.number}
          issuedAt={payload.issuedAt}
          secondaryDate={payload.expectedAt}
          secondaryDateLabel='Expected'
          dateFormat={settings.branding.dateFormat}
          logoBytes={logoBytes}
          copyLabel={copyLabel}
        />

        <PurchaseOrderParties
          styles={styles}
          business={settings.business}
          vendor={payload.vendor}
          contact={payload.contact}
          shipToLines={payload.shipToLines}
        />

        {payload.number ? (
          <View style={{ marginBottom: 12 }}>
            <Text style={styles.value}>
              Please quote purchase order {payload.number} on your invoice and packing slip.
            </Text>
          </View>
        ) : null}

        <LineItemsTable
          styles={styles}
          lines={lines}
          lineDisplay='full'
          showDescriptions={false}
          currencyCode={currencyCode}
        />

        <PurchaseOrderTotals
          styles={styles}
          currencyCode={currencyCode}
          subtotal={payload.subtotal}
          discountAmount={payload.discountAmount}
          shippingTotal={payload.shippingTotal}
          taxTotal={payload.taxTotal}
          total={payload.total}
        />

        {payload.vendorReference ? (
          <View style={styles.terms}>
            <Text style={styles.label}>Your reference</Text>
            <Text style={styles.value}>{payload.vendorReference}</Text>
          </View>
        ) : null}

        {payload.terms ? (
          <View style={styles.terms}>
            <Text style={styles.label}>Terms</Text>
            <Text style={styles.value}>{payload.terms}</Text>
          </View>
        ) : null}
      </Page>
    </Document>
  )
}
