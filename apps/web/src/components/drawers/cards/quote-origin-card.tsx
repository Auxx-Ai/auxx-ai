// apps/web/src/components/drawers/cards/quote-origin-card.tsx
'use client'

import { extractRelationshipRecordIds } from '@auxx/lib/field-values/client'
import type { RecordId } from '@auxx/types/resource'
import { getInstanceId } from '@auxx/types/resource'
import { Button } from '@auxx/ui/components/button'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { ExternalLink } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useSystemField } from '~/components/resources/hooks/use-field'
import { useSystemValues } from '~/components/resources/hooks/use-system-values'
import { TagsView } from '~/components/ui/tags-view'
import type { DrawerTabProps } from '../drawer-tab-registry'

const REQUEST_ATTRS = [
  'service_request_number',
  'service_request_title',
  'service_request_status',
] as const

/**
 * QuoteOriginCard — the linked service request this quote was created from
 * (money MQ1 build spec §H.3, mirrors the dispatch job view's Origin card).
 * Resolves via `quote_request`; renders an empty state for standalone quotes.
 * `service_request` has no detail page yet — the link opens its records-view
 * drawer via the `?id=` convention (records-view.tsx).
 */
export function QuoteOriginCard({ recordId }: DrawerTabProps) {
  const { values: quoteValues, isLoading: quoteLoading } = useSystemValues(
    recordId,
    ['quote_request'],
    { autoFetch: true }
  )

  const requestRecordIds = extractRelationshipRecordIds(quoteValues.quote_request)
  const requestRecordId = requestRecordIds[0]

  if (quoteLoading) {
    return (
      <div className='bg-primary-100/50 rounded-2xl border py-2 px-3'>
        <Skeleton className='h-4 w-40' />
      </div>
    )
  }

  if (!requestRecordId) {
    return (
      <div className='rounded-2xl border border-dashed py-3 px-3 text-center text-xs text-muted-foreground'>
        Standalone quote — not linked to a service request.
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

  const requestInstanceId = getInstanceId(requestRecordId)
  const number = values.service_request_number as string | undefined
  const title = values.service_request_title as string | undefined
  const status = values.service_request_status as string | undefined
  const statusOptions = statusField?.options?.options ?? []

  return (
    <div className='group flex items-center justify-between bg-primary-100/50 rounded-2xl border py-2 px-3 hover:bg-muted transition-colors duration-200'>
      <div className='flex min-w-0 flex-col gap-1'>
        {isLoading ? (
          <Skeleton className='h-4 w-32' />
        ) : (
          <span className='truncate text-sm font-medium'>
            {number ? `${number} — ${title ?? 'Untitled request'}` : (title ?? 'Service request')}
          </span>
        )}
        {!isLoading && status && <TagsView value={status} options={statusOptions} variant='pill' />}
      </div>

      <Button
        variant='ghost'
        size='icon-sm'
        onClick={() => router.push(`/app/service-requests?id=${requestInstanceId}`)}>
        <ExternalLink />
      </Button>
    </div>
  )
}
