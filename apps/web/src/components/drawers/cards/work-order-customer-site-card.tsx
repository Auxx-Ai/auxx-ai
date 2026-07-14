// apps/web/src/components/drawers/cards/work-order-customer-site-card.tsx
'use client'

import { extractRelationshipRecordIds } from '@auxx/lib/field-values/client'
import type { RecordId } from '@auxx/types/resource'
import { getInstanceId } from '@auxx/types/resource'
import { Avatar, AvatarFallback } from '@auxx/ui/components/avatar'
import { Button } from '@auxx/ui/components/button'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { getFullName, getInitials } from '@auxx/utils'
import { ExternalLink, Mail, MapPin, Phone } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useOpenRecord } from '~/components/records/record-drill-panels'
import { useSystemValues } from '~/components/resources/hooks/use-system-values'
import type { DrawerTabProps } from '../drawer-tab-registry'

const WORK_ORDER_ATTRS = ['work_order_contact', 'work_order_address'] as const
const CONTACT_ATTRS = ['first_name', 'last_name', 'primary_email', 'phone'] as const

/** ADDRESS_STRUCT shape (see `dispatch.ts` router's `addressStructSchema`). */
interface AddressStructValue {
  street1?: string
  street2?: string
  city?: string
  state?: string
  zipCode?: string
  country?: string
}

/** `display-address.tsx`'s `DisplayAddressStruct` formatting, inlined for this card. */
function formatAddress(address: AddressStructValue | null | undefined): string | null {
  if (!address) return null
  const streetPart = [address.street1, address.street2].filter(Boolean).join(', ')
  const cityStatePart = [address.city, [address.state, address.zipCode].filter(Boolean).join(' ')]
    .filter(Boolean)
    .join(', ')
  const parts = [streetPart, cityStatePart, address.country].filter(Boolean)
  return parts.length > 0 ? parts.join(', ') : null
}

/**
 * WorkOrderCustomerSiteCard — the job view's "Customer & site" sidebar card
 * (dispatch M2 build spec §F.2, 04-ui.md §6: "Customer & site — contact/company +
 * serviceAddress"). The `quote-customer-card.tsx` recipe, plus the service address.
 */
export function WorkOrderCustomerSiteCard({ recordId }: DrawerTabProps) {
  const { values, isLoading } = useSystemValues(recordId, [...WORK_ORDER_ATTRS], {
    autoFetch: true,
  })

  const contactRecordIds = extractRelationshipRecordIds(values.work_order_contact)
  const contactRecordId = contactRecordIds[0]
  const address = unwrap(values.work_order_address) as AddressStructValue | null | undefined
  const addressLine = formatAddress(address)

  if (isLoading) {
    return (
      <div className='space-y-2'>
        <Skeleton className='h-12 w-full rounded-2xl' />
      </div>
    )
  }

  return (
    <div className='space-y-2'>
      {contactRecordId ? (
        <ContactDetails contactRecordId={contactRecordId} />
      ) : (
        <div className='rounded-2xl border border-dashed py-3 px-3 text-center text-xs text-muted-foreground'>
          No contact linked
        </div>
      )}
      {addressLine && (
        <div className='flex items-start gap-2 rounded-2xl border bg-primary-100/50 py-2 px-3 text-xs text-muted-foreground'>
          <MapPin className='size-3.5 mt-0.5 shrink-0' />
          <span>{addressLine}</span>
        </div>
      )}
    </div>
  )
}

/** Inner component — only rendered when contactRecordId is resolved. */
function ContactDetails({ contactRecordId }: { contactRecordId: RecordId }) {
  const router = useRouter()
  const openRecord = useOpenRecord()
  const { values, isLoading } = useSystemValues(contactRecordId, [...CONTACT_ATTRS], {
    autoFetch: true,
  })

  const contactInstanceId = getInstanceId(contactRecordId)
  const firstNameStr = unwrap(values.first_name) as string | undefined
  const lastNameStr = unwrap(values.last_name) as string | undefined
  const emailStr = unwrap(values.primary_email) as string | undefined
  const phoneStr = unwrap(values.phone) as string | undefined

  const contactName = {
    firstName: firstNameStr ?? undefined,
    lastName: lastNameStr ?? undefined,
    email: emailStr ?? undefined,
  }

  return (
    <div className='group flex items-center justify-between bg-primary-100/50 rounded-2xl border py-2 px-3 hover:bg-muted transition-colors duration-200'>
      <div className='flex flex-row items-start gap-4'>
        <div className='size-8 border bg-muted rounded-lg flex items-center justify-center group-hover:bg-secondary transition-colors shrink-0'>
          <Avatar className='h-7 w-7 rounded-none shadow-none'>
            <AvatarFallback className='rounded-none bg-transparent'>
              {isLoading ? '...' : getInitials(contactName)}
            </AvatarFallback>
          </Avatar>
        </div>
        <div className='flex flex-col'>
          <div className='text-sm font-medium flex flex-row items-center gap-1'>
            {isLoading ? (
              <Skeleton className='h-4 w-24' />
            ) : (
              <span>{getFullName(contactName) || 'Unnamed Customer'}</span>
            )}
          </div>
          <div className='text-muted-foreground text-xs'>
            {isLoading ? (
              <Skeleton className='h-3 w-40 mt-0.5' />
            ) : (
              <div className='flex flex-col gap-0.5'>
                {emailStr && (
                  <div className='flex items-center gap-1.5'>
                    <Mail className='size-3' />
                    <span>{emailStr}</span>
                  </div>
                )}
                {phoneStr && (
                  <div className='flex items-center gap-1.5'>
                    <Phone className='size-3' />
                    <span>{phoneStr}</span>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      <Button
        variant='ghost'
        size='icon-sm'
        onClick={() =>
          openRecord
            ? openRecord(contactRecordId)
            : router.push(`/app/contacts/${contactInstanceId}`)
        }>
        <ExternalLink />
      </Button>
    </div>
  )
}

/** Extract first element if value is an array. */
function unwrap(value: unknown): unknown {
  return Array.isArray(value) ? value[0] : value
}
