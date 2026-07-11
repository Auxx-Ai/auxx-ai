// apps/web/src/components/drawers/cards/quote-origin-card.tsx
'use client'

import { extractRelationshipRecordIds } from '@auxx/lib/field-values/client'
import { getInstanceId } from '@auxx/types/resource'
import { useSystemValues } from '~/components/resources/hooks/use-system-values'
import type { DrawerTabProps } from '../drawer-tab-registry'
import {
  EmptyRow,
  RelatedRecordRow,
  RowSkeleton,
  TREE_SECONDARY_NOTRUNCATE,
} from './related-record-row'

/**
 * QuoteOriginCard — the linked service request this quote was created from
 * (money MQ1 build spec §H.3, mirrors the dispatch job view's Origin card).
 * Uniform TreeRow block (see related-record-row.tsx); resolves via
 * `quote_request` and renders an empty state for standalone quotes.
 * `service_request` has no detail page — the link opens its records-view
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

  if (quoteLoading) return <RowSkeleton />
  if (!requestRecordId)
    return <EmptyRow label='Standalone quote — not linked to a service request' />

  return (
    <div className={`space-y-0.5 ${TREE_SECONDARY_NOTRUNCATE}`}>
      <RelatedRecordRow
        recordId={requestRecordId}
        statusAttr='service_request_status'
        href={`/app/service-requests?id=${getInstanceId(requestRecordId)}`}
      />
    </div>
  )
}
