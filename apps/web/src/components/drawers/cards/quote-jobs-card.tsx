// apps/web/src/components/drawers/cards/quote-jobs-card.tsx
'use client'

import { extractRelationshipRecordIds } from '@auxx/lib/field-values/client'
import { useSystemValues } from '~/components/resources/hooks/use-system-values'
import type { DrawerTabProps } from '../drawer-tab-registry'
import {
  EmptyRow,
  RelatedRecordRow,
  RowSkeleton,
  TREE_SECONDARY_NOTRUNCATE,
} from './related-record-row'

/**
 * QuoteJobsCard — the work order(s) this quote was converted into (dispatch v5
 * build spec 01: the public accept page auto-converts, so the resulting job must
 * be visible from the quote). Resolves via the `quote_work_orders` inverse of
 * `work_order_quote` — the WorkOrderInvoicesCard read pattern.
 */
export function QuoteJobsCard({ recordId }: DrawerTabProps) {
  const { values, isLoading } = useSystemValues(recordId, ['quote_work_orders'], {
    autoFetch: true,
  })
  const workOrderRecordIds = extractRelationshipRecordIds(values.quote_work_orders)

  if (isLoading) return <RowSkeleton />
  if (workOrderRecordIds.length === 0) return <EmptyRow label='Not converted to a job yet' />

  return (
    <div className={`space-y-0.5 ${TREE_SECONDARY_NOTRUNCATE}`}>
      {workOrderRecordIds.map((id) => (
        <RelatedRecordRow key={id} recordId={id} statusAttr='work_order_status' />
      ))}
    </div>
  )
}
