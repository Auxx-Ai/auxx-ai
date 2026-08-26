// apps/web/src/components/drawers/cards/order-customer-card.tsx
'use client'

import { extractRelationshipRecordIds, primaryValue } from '@auxx/lib/field-values/client'
import type { RecordId } from '@auxx/types/resource'
import { getInstanceId } from '@auxx/types/resource'
import { Avatar, AvatarFallback } from '@auxx/ui/components/avatar'
import { Button } from '@auxx/ui/components/button'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { getFullName, getInitials } from '@auxx/utils'
import { ExternalLink, Mail, Phone } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useOpenRecord } from '~/components/records/record-drill-panels'
import { useSystemValues } from '~/components/resources/hooks/use-system-values'
import type { DrawerTabProps } from '../drawer-tab-registry'

const CONTACT_ATTRS = ['first_name', 'last_name', 'primary_email', 'phone'] as const

/**
 * OrderCustomerCard — displays the order's linked contact (the
 * `ticket-customer-card.tsx` recipe, plans/products/08-order-build.md §5.8). Resolves the
 * contact via `order_contact`, then fetches individual contact fields via
 * system attributes.
 */
export function OrderCustomerCard({ recordId }: DrawerTabProps) {
  const { values: orderValues, isLoading: contactLoading } = useSystemValues(
    recordId,
    ['order_contact'],
    { autoFetch: true }
  )

  const contactRecordIds = extractRelationshipRecordIds(orderValues.order_contact)
  const contactRecordId = contactRecordIds[0]

  if (contactLoading) {
    return (
      <div className='bg-primary-100/50 rounded-2xl border py-2 px-3'>
        <div className='flex items-center gap-4'>
          <Skeleton className='size-8 rounded-lg' />
          <div className='flex flex-col gap-1'>
            <Skeleton className='h-4 w-32' />
            <Skeleton className='h-3 w-48' />
          </div>
        </div>
      </div>
    )
  }

  if (!contactRecordId) return null

  return <ContactDetails contactRecordId={contactRecordId} />
}

/** Inner component — only rendered when contactRecordId is resolved. */
function ContactDetails({ contactRecordId }: { contactRecordId: RecordId }) {
  const router = useRouter()
  const openRecord = useOpenRecord()
  const { values, isLoading } = useSystemValues(contactRecordId, [...CONTACT_ATTRS], {
    autoFetch: true,
  })

  const contactInstanceId = getInstanceId(contactRecordId)
  const firstNameStr = (primaryValue(values.first_name) as string | null) ?? undefined
  const lastNameStr = (primaryValue(values.last_name) as string | null) ?? undefined
  const emailStr = (primaryValue(values.primary_email) as string | null) ?? undefined
  const phoneStr = (primaryValue(values.phone) as string | null) ?? undefined

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
