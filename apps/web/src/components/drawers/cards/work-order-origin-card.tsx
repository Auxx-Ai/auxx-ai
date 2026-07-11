// apps/web/src/components/drawers/cards/work-order-origin-card.tsx
'use client'

import { extractRelationshipRecordIds } from '@auxx/lib/field-values/client'
import type { RecordId } from '@auxx/types/resource'
import { getInstanceId } from '@auxx/types/resource'
import { Badge, type Variant } from '@auxx/ui/components/badge'
import { TreeRow } from '@auxx/ui/components/tree-row'
import { format } from 'date-fns'
import { Calendar, Clock } from 'lucide-react'
import { useSystemField } from '~/components/resources/hooks/use-field'
import { useSystemValues } from '~/components/resources/hooks/use-system-values'
import type { DrawerTabProps } from '../drawer-tab-registry'
import {
  EmptyRow,
  RelatedRecordRow,
  RowSkeleton,
  TREE_SECONDARY_NOTRUNCATE,
  unwrap,
} from './related-record-row'

const REQUEST_ATTRS = [
  'service_request_preferred_date',
  'service_request_alternate_date',
  'service_request_arrival_window',
  'service_request_ticket',
] as const

/**
 * WorkOrderOriginCard — the job view's "Origin" sidebar card (dispatch M2 build
 * spec §F.2, 04-ui.md §6: "source request incl. preferred/alternate dates +
 * arrival window — the dispatcher's scheduling hint, always visible next to the
 * sections; plus source ticket link"). Uniform TreeRow blocks (see
 * related-record-row.tsx); resolved via `work_order_request`.
 */
export function WorkOrderOriginCard({ recordId }: DrawerTabProps) {
  const { values: workOrderValues, isLoading: workOrderLoading } = useSystemValues(
    recordId,
    ['work_order_request'],
    { autoFetch: true }
  )

  const requestRecordIds = extractRelationshipRecordIds(workOrderValues.work_order_request)
  const requestRecordId = requestRecordIds[0]

  if (workOrderLoading) return <RowSkeleton />
  if (!requestRecordId) return <EmptyRow label='Not converted from a service request' />

  return <RequestDetails requestRecordId={requestRecordId} />
}

/** Inner component — only rendered when requestRecordId is resolved. */
function RequestDetails({ requestRecordId }: { requestRecordId: RecordId }) {
  const { values, isLoading } = useSystemValues(requestRecordId, [...REQUEST_ATTRS], {
    autoFetch: true,
  })
  const arrivalWindowField = useSystemField('service_request_arrival_window')

  const preferredDate = unwrap(values.service_request_preferred_date) as string | undefined
  const alternateDate = unwrap(values.service_request_alternate_date) as string | undefined
  const arrivalWindow = unwrap(values.service_request_arrival_window) as string | undefined
  const arrivalWindowOption = arrivalWindowField?.options?.options?.find(
    (o) => o.value === arrivalWindow
  )

  const ticketRecordIds = extractRelationshipRecordIds(values.service_request_ticket)
  const ticketRecordId = ticketRecordIds[0]

  return (
    <div className={`space-y-0.5 ${TREE_SECONDARY_NOTRUNCATE}`}>
      <RelatedRecordRow
        recordId={requestRecordId}
        statusAttr='service_request_status'
        href={`/app/service-requests?id=${getInstanceId(requestRecordId)}`}
      />

      {!isLoading && preferredDate && (
        <HintRow
          icon={<Calendar className='size-4' />}
          label='Preferred date'
          value={format(new Date(preferredDate), 'PP')}
        />
      )}
      {!isLoading && alternateDate && (
        <HintRow
          icon={<Calendar className='size-4' />}
          label='Alternate date'
          value={format(new Date(alternateDate), 'PP')}
        />
      )}
      {!isLoading && arrivalWindow && (
        <HintRow
          icon={<Clock className='size-4' />}
          label='Arrival window'
          value={
            <Badge variant={(arrivalWindowOption?.color as Variant) ?? 'secondary'} size='xs'>
              {arrivalWindowOption?.label ?? arrivalWindow}
            </Badge>
          }
        />
      )}

      {!isLoading && ticketRecordId && (
        <RelatedRecordRow recordId={ticketRecordId} statusAttr='ticket_status' />
      )}
    </div>
  )
}

/** Scheduling-hint TreeRow — muted label, right-aligned value. */
function HintRow({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode
  label: string
  value: React.ReactNode
}) {
  return (
    <TreeRow
      icon={icon}
      title={<span className='text-sm text-muted-foreground'>{label}</span>}
      actions={<span className='text-xs text-foreground'>{value}</span>}
    />
  )
}
