// apps/web/src/components/purchasing/purchase-order/purchase-order-bills-card.tsx
'use client'

// `purchase_order:bills` — the vendor bills charged against this PO
// (plans/purchasing/01-build-plan.md §4.4).
//
// `purchase_order_bills` is `showInPanel: false` in `purchase-order-fields.ts`, so
// without this card the inverse edge has NO surface at all: a bill knows its PO and
// the PO could not show its bills. That asymmetry is what the card exists to close.
//
// The work-order Billing card's shape — summary strip, then one row per related
// record — with `RelatedRecordRow` for the rows themselves, the same primitive the
// order's work-orders block uses. A bill is `hasDetailPage: false`, so its row opens
// as a drill panel rather than navigating.

import { extractRelationshipRecordIds } from '@auxx/lib/field-values/client'
import { formatCurrency } from '@auxx/utils/currency'
import {
  EmptyRow,
  RelatedRecordRow,
  RowSkeleton,
  TREE_SECONDARY_NOTRUNCATE,
} from '~/components/drawers/cards/related-record-row'
import type { DrawerTabProps } from '~/components/drawers/drawer-tab-registry'
import { useSystemValues } from '~/components/resources/hooks/use-system-values'
import { useSystemValuesForRecords } from '~/components/resources/hooks/use-system-values-for-records'
import { useSettings } from '~/hooks/use-settings'
import { numberValue, PurchasingSummaryStrip, unwrapValue } from '../purchasing-summary-strip'

const PO_ATTRS = [
  'purchase_order_bills',
  'purchase_order_total',
  'purchase_order_currency',
] as const

const BILL_ATTRS = ['vendor_bill_total'] as const

export function PurchaseOrderBillsCard({ recordId }: DrawerTabProps) {
  const { getSetting } = useSettings({})
  const { values, isLoading } = useSystemValues(recordId, [...PO_ATTRS], { autoFetch: true })

  const billRecordIds = extractRelationshipRecordIds(values.purchase_order_bills)
  const { valuesById, isLoading: billsLoading } = useSystemValuesForRecords(
    billRecordIds,
    BILL_ATTRS,
    { autoFetch: true, enabled: billRecordIds.length > 0 }
  )

  const currencyValue = unwrapValue(values.purchase_order_currency)
  const currencyCode =
    (typeof currencyValue === 'string' && currencyValue) ||
    (getSetting('organization.currency') as string | null) ||
    'USD'

  const orderTotal = numberValue(values.purchase_order_total)
  const billed = billRecordIds.reduce(
    (sum, billRecordId) => sum + numberValue(valuesById[billRecordId]?.vendor_bill_total),
    0
  )
  // Signed, not clamped: over-billing against a PO is exactly the condition the
  // three-way match exists to surface, so a negative unbilled figure is the news.
  const unbilled = orderTotal - billed

  if (isLoading || (billRecordIds.length > 0 && billsLoading)) return <RowSkeleton />

  return (
    <div className={`space-y-0.5 ${TREE_SECONDARY_NOTRUNCATE}`}>
      <PurchasingSummaryStrip
        className='pb-2'
        cells={[
          { label: 'Order total', value: formatCurrency(orderTotal, { currencyCode }) },
          { label: 'Billed', value: formatCurrency(billed, { currencyCode }) },
          {
            label: 'Unbilled',
            value: formatCurrency(unbilled, { currencyCode }),
            tone: unbilled === 0 ? 'muted' : 'default',
          },
        ]}
      />
      {billRecordIds.length === 0 ? (
        <EmptyRow label='No bills yet' />
      ) : (
        billRecordIds.map((billRecordId) => (
          <RelatedRecordRow
            key={billRecordId}
            recordId={billRecordId}
            statusAttr='vendor_bill_status'
          />
        ))
      )}
    </div>
  )
}
