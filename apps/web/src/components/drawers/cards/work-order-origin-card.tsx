// apps/web/src/components/drawers/cards/work-order-origin-card.tsx
'use client'

import { extractRelationshipRecordIds } from '@auxx/lib/field-values/client'
import type { RecordId } from '@auxx/types/resource'
import { getInstanceId } from '@auxx/types/resource'
import { Button } from '@auxx/ui/components/button'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { format } from 'date-fns'
import { ExternalLink, Ticket } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useSystemField } from '~/components/resources/hooks/use-field'
import { useSystemValues } from '~/components/resources/hooks/use-system-values'
import { TagsView } from '~/components/ui/tags-view'
import type { DrawerTabProps } from '../drawer-tab-registry'

const REQUEST_ATTRS = [
  'service_request_number',
  'service_request_title',
  'service_request_status',
  'service_request_preferred_date',
  'service_request_alternate_date',
  'service_request_arrival_window',
  'service_request_ticket',
] as const

/**
 * WorkOrderOriginCard — the job view's "Origin" sidebar card (dispatch M2 build
 * spec §F.2, 04-ui.md §6: "source request incl. preferred/alternate dates +
 * arrival window — the dispatcher's scheduling hint, always visible next to the
 * sections; plus source ticket link"). Mirrors `quote-origin-card.tsx`, resolved
 * via `work_order_request`.
 */
export function WorkOrderOriginCard({ recordId }: DrawerTabProps) {
  const { values: workOrderValues, isLoading: workOrderLoading } = useSystemValues(
    recordId,
    ['work_order_request'],
    { autoFetch: true }
  )

  const requestRecordIds = extractRelationshipRecordIds(workOrderValues.work_order_request)
  const requestRecordId = requestRecordIds[0]

  if (workOrderLoading) {
    return (
      <div className='bg-primary-100/50 rounded-2xl border py-2 px-3'>
        <Skeleton className='h-4 w-40' />
      </div>
    )
  }

  if (!requestRecordId) {
    return (
      <div className='rounded-2xl border border-dashed py-3 px-3 text-center text-xs text-muted-foreground'>
        Not converted from a service request.
      </div>
    )
  }

  return <RequestDetails requestRecordId={requestRecordId} />
}

/** Inner component — only rendered when requestRecordId is resolved. */
function RequestDetails({ requestRecordId }: { requestRecordId: RecordId }) {
  const router = useRouter()
  const { values, isLoading } = useSystemValues(requestRecordId, [...REQUEST_ATTRS], {
    autoFetch: true,
  })
  const statusField = useSystemField('service_request_status')
  const arrivalWindowField = useSystemField('service_request_arrival_window')

  const requestInstanceId = getInstanceId(requestRecordId)
  const number = unwrap(values.service_request_number) as string | undefined
  const title = unwrap(values.service_request_title) as string | undefined
  const status = unwrap(values.service_request_status) as string | undefined
  const preferredDate = unwrap(values.service_request_preferred_date) as string | undefined
  const alternateDate = unwrap(values.service_request_alternate_date) as string | undefined
  const arrivalWindow = unwrap(values.service_request_arrival_window) as string | undefined
  const statusOptions = statusField?.options?.options ?? []
  const arrivalWindowOptions = arrivalWindowField?.options?.options ?? []

  const ticketRecordIds = extractRelationshipRecordIds(values.service_request_ticket)
  const ticketRecordId = ticketRecordIds[0]

  return (
    <div className='space-y-2'>
      <div className='group flex items-center justify-between bg-primary-100/50 rounded-2xl border py-2 px-3 hover:bg-muted transition-colors duration-200'>
        <div className='flex min-w-0 flex-col gap-1'>
          {isLoading ? (
            <Skeleton className='h-4 w-32' />
          ) : (
            <span className='truncate text-sm font-medium'>
              {number ? `${number} — ${title ?? 'Untitled request'}` : (title ?? 'Service request')}
            </span>
          )}
          {!isLoading && status && (
            <TagsView value={status} options={statusOptions} variant='pill' />
          )}
        </div>

        <Button
          variant='ghost'
          size='icon-sm'
          onClick={() => router.push(`/app/service-requests?id=${requestInstanceId}`)}>
          <ExternalLink />
        </Button>
      </div>

      {!isLoading && (preferredDate || alternateDate || arrivalWindow) && (
        <div className='space-y-1 rounded-2xl border bg-primary-100/50 py-2 px-3 text-xs'>
          {preferredDate && (
            <div className='flex items-center justify-between'>
              <span className='text-muted-foreground'>Preferred date</span>
              <span>{format(new Date(preferredDate), 'PP')}</span>
            </div>
          )}
          {alternateDate && (
            <div className='flex items-center justify-between'>
              <span className='text-muted-foreground'>Alternate date</span>
              <span>{format(new Date(alternateDate), 'PP')}</span>
            </div>
          )}
          {arrivalWindow && (
            <div className='flex items-center justify-between'>
              <span className='text-muted-foreground'>Arrival window</span>
              <TagsView value={arrivalWindow} options={arrivalWindowOptions} variant='pill' />
            </div>
          )}
        </div>
      )}

      {!isLoading && ticketRecordId && (
        <Button
          variant='outline'
          size='sm'
          className='w-full justify-start'
          onClick={() => router.push(`/app/tickets/${getInstanceId(ticketRecordId)}`)}>
          <Ticket /> Source ticket
        </Button>
      )}
    </div>
  )
}

/** Extract first element if value is an array. */
function unwrap(value: unknown): unknown {
  return Array.isArray(value) ? value[0] : value
}
