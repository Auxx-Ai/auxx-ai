// apps/web/src/components/drawers/cards/product-vendor-card.tsx
'use client'

import { getInstanceId, isRecordId, type RecordId } from '@auxx/lib/resources/client'
import { FieldPanel, FieldPanelRow } from '~/components/global/forms/field-panel'
import { toRecordId, useResourceProperty } from '~/components/resources'
import { useSystemValues } from '~/components/resources/hooks/use-system-values'
import { RecordBadge } from '~/components/resources/ui/record-badge'
import type { DrawerTabProps } from '../drawer-tab-registry'

/** The product's vendor relation. */
const PRODUCT_VENDOR_ATTRIBUTES = ['product_vendor'] as const

/** Unwrap a RELATIONSHIP value into the related instance id. */
function relatedInstanceId(raw: unknown): string | undefined {
  const first = Array.isArray(raw) ? raw[0] : raw
  if (typeof first !== 'string') return undefined
  return isRecordId(first) ? getInstanceId(first) : first
}

/**
 * The company behind this product family, as a click-through
 * (plans/products/09-variant-ui.md §7).
 *
 * `product.vendor` is a relation to `company`, not a free-text brand string
 * (01 §2, D9) — a supplier is already a company, which `vendor_part.contact`
 * established. Shopify's free-text `vendor` lands in an app field instead and a
 * human links this relation, so it is null on most synced products.
 *
 * Renders NOTHING when there is no vendor, so `TabCardSection` hides the
 * section — which is the common case, and the reason this card is cheap.
 */
export function ProductVendorCard({ recordId }: DrawerTabProps) {
  const companyDefId = useResourceProperty('company', 'id')
  const { values } = useSystemValues(recordId, PRODUCT_VENDOR_ATTRIBUTES, { autoFetch: true })

  const vendorId = relatedInstanceId(values.product_vendor)
  if (!vendorId || !companyDefId) return null

  const vendorRecordId: RecordId = toRecordId(companyDefId, vendorId)

  return (
    <FieldPanel resizeId='product-vendor' defaultLabelWidth={130}>
      <FieldPanelRow title='Vendor'>
        <div className='flex min-h-8 flex-wrap items-center gap-2 text-sm'>
          <RecordBadge recordId={vendorRecordId} variant='link' link={{ tab: 'overview' }} />
        </div>
      </FieldPanelRow>
    </FieldPanel>
  )
}
