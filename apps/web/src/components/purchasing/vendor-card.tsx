// apps/web/src/components/purchasing/vendor-card.tsx
'use client'

// The vendor block for both purchasing documents — `purchase_order:vendor` and
// `vendor_bill:vendor` (plans/purchasing/01-build-plan.md §4.4 / §5.1).
//
// The `work-order-customer-site-card.tsx` recipe, pointed at a COMPANY rather than a
// contact: identity block + an address strip beneath it. One component for both
// documents because the only thing that differs is which relation attribute holds
// the company — a PO and a bill each link exactly one vendor, and the card is the
// same question on both.
//
// ⚠️ `company` carries no email or phone of its own (see `company-fields.ts` — the
// people live on `company_employees` / `company_primary_contact`), so this block
// leads with website + headquarters rather than the contact card's mail/phone rows.

import { extractRelationshipRecordIds, primaryValue } from '@auxx/lib/field-values/client'
import { getDefinitionId, type RecordId } from '@auxx/types/resource'
import { Button } from '@auxx/ui/components/button'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { type AddressStructValue, formatAddress } from '@auxx/utils/address'
import { ExternalLink, Globe, MapPin } from 'lucide-react'
import { useRouter } from 'next/navigation'
import type { DrawerTabProps } from '~/components/drawers/drawer-tab-registry'
import { useOpenRecord } from '~/components/records/record-drill-panels'
import { useRecord, useResource } from '~/components/resources'
import { useSystemValues } from '~/components/resources/hooks/use-system-values'
import { RecordIcon } from '~/components/resources/ui/record-icon'
import { useRecordLink } from '~/components/resources/utils/get-record-link'
import { useSettings } from '~/hooks/use-settings'

const COMPANY_ATTRS = ['company_website', 'company_domain', 'company_headquarters'] as const

/** `purchase_order:vendor` — the company this PO was placed with. */
export function PurchaseOrderVendorCard({ recordId }: DrawerTabProps) {
  return <VendorBlock recordId={recordId} vendorAttr='purchase_order_vendor' />
}

/** `vendor_bill:vendor` — the company that billed us. */
export function VendorBillVendorCard({ recordId }: DrawerTabProps) {
  return <VendorBlock recordId={recordId} vendorAttr='vendor_bill_vendor' />
}

function VendorBlock({ recordId, vendorAttr }: { recordId: RecordId; vendorAttr: string }) {
  const { values, isLoading } = useSystemValues(recordId, [vendorAttr], { autoFetch: true })
  const vendorRecordId = extractRelationshipRecordIds(values[vendorAttr])[0]

  if (isLoading) return <Skeleton className='h-12 w-full rounded-2xl' />

  // `vendor` is required on both defs, so an empty one is a half-written draft
  // rather than a legitimate state — say so instead of rendering nothing.
  if (!vendorRecordId) {
    return (
      <div className='rounded-2xl border border-dashed px-3 py-3 text-center text-muted-foreground text-xs'>
        No vendor linked
      </div>
    )
  }

  return <VendorDetails vendorRecordId={vendorRecordId} />
}

/** Inner component — only rendered once the vendor relation has resolved. */
function VendorDetails({ vendorRecordId }: { vendorRecordId: RecordId }) {
  const router = useRouter()
  const openRecord = useOpenRecord()
  const { record } = useRecord({ recordId: vendorRecordId, enabled: true })
  const { resource } = useResource(getDefinitionId(vendorRecordId))
  const { values, isLoading } = useSystemValues(vendorRecordId, [...COMPANY_ATTRS], {
    autoFetch: true,
  })
  const href = useRecordLink(vendorRecordId)

  const { getSetting } = useSettings({})
  const business = getSetting('documents.business') as { address?: { country?: string } } | null

  // `company_website` is multi-value (`options.multi`), so this is the primary of
  // several; `company_domain` is the plain-text fallback for a vendor recorded by
  // domain alone.
  const websiteValue = primaryValue(values.company_website)
  const domainValue = primaryValue(values.company_domain)
  const site =
    typeof websiteValue === 'string' && websiteValue
      ? websiteValue
      : typeof domainValue === 'string' && domainValue
        ? domainValue
        : null

  const headquarters = primaryValue(values.company_headquarters) as
    | Partial<AddressStructValue>
    | null
    | undefined
  const addressLine = headquarters
    ? formatAddress(headquarters, { domesticCountry: business?.address?.country }) || null
    : null

  const handleOpen = openRecord
    ? () => openRecord(vendorRecordId)
    : href
      ? () => router.push(href)
      : undefined

  return (
    <div className='space-y-2'>
      <div className='group flex items-center justify-between rounded-2xl border bg-primary-100/50 px-3 py-2 transition-colors duration-200 hover:bg-muted'>
        <div className='flex flex-row items-start gap-4'>
          <div className='flex size-8 shrink-0 items-center justify-center rounded-lg border bg-muted transition-colors group-hover:bg-secondary'>
            <RecordIcon
              avatarUrl={record?.avatarUrl}
              iconId={resource?.icon || 'building-2'}
              color={resource?.color || 'gray'}
              size='xs'
            />
          </div>
          <div className='flex min-w-0 flex-col'>
            <div className='flex flex-row items-center gap-1 font-medium text-sm'>
              {record ? (
                <span className='truncate'>{record.displayName ?? 'Unnamed vendor'}</span>
              ) : (
                <Skeleton className='h-4 w-24' />
              )}
            </div>
            <div className='text-muted-foreground text-xs'>
              {isLoading ? (
                <Skeleton className='mt-0.5 h-3 w-40' />
              ) : (
                site && (
                  <div className='flex items-center gap-1.5'>
                    <Globe className='size-3 shrink-0' />
                    <span className='truncate'>{site}</span>
                  </div>
                )
              )}
            </div>
          </div>
        </div>

        {handleOpen && (
          <Button variant='ghost' size='icon-sm' onClick={handleOpen}>
            <ExternalLink />
          </Button>
        )}
      </div>

      {addressLine && (
        <div className='flex items-start gap-2 rounded-2xl border bg-primary-100/50 px-3 py-2 text-muted-foreground text-xs'>
          <MapPin className='mt-0.5 size-3.5 shrink-0' />
          <span>{addressLine}</span>
        </div>
      )}
    </div>
  )
}
