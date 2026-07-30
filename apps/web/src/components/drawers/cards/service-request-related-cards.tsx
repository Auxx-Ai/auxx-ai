// apps/web/src/components/drawers/cards/service-request-related-cards.tsx
'use client'

// Service-request drawer overview blocks for the request's related Work Orders and
// Quotes (dispatch STATUS "uniform drawer blocks"). Each related record is a TreeRow
// (see related-record-row.tsx). The Quotes block's create affordance is the SAME
// TreeRow shape — clicking it runs `money.createQuoteFromRequest` + navigates, gated
// on the one-active-quote-per-request rule (mirrors create-quote-action.tsx).

import { extractRelationshipRecordIds } from '@auxx/lib/field-values/client'
import { getInstanceId } from '@auxx/types/resource'
import { toastError } from '@auxx/ui/components/toast'
import { TreeRow } from '@auxx/ui/components/tree-row'
import { Plus } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useOpenRecord } from '~/components/records/record-drill-panels'
import { useSystemValues } from '~/components/resources/hooks/use-system-values'
import { api } from '~/trpc/react'
import type { DrawerTabProps } from '../drawer-tab-registry'
import {
  EmptyRow,
  RelatedRecordRow,
  RowSkeleton,
  TREE_SECONDARY_NOTRUNCATE,
} from './related-record-row'

/** One-active-quote guard mirror (§F.3 createQuoteFromRequest) — matches create-quote-action.tsx. */
const INACTIVE_QUOTE_STATUSES = ['declined', 'canceled']

// ─────────────────────────────────────────────────────────────────────────────
// Work Orders block
// ─────────────────────────────────────────────────────────────────────────────

export function ServiceRequestWorkOrdersCard({ recordId }: DrawerTabProps) {
  const { values, isLoading } = useSystemValues(recordId, ['service_request_work_orders'], {
    autoFetch: true,
  })

  const workOrderRecordIds = extractRelationshipRecordIds(values.service_request_work_orders)

  if (isLoading) return <RowSkeleton />
  if (workOrderRecordIds.length === 0) return <EmptyRow label='No work orders yet' />

  return (
    <div className={`space-y-0.5 ${TREE_SECONDARY_NOTRUNCATE}`}>
      {workOrderRecordIds.map((id) => (
        <RelatedRecordRow key={id} recordId={id} statusAttr='work_order_status' />
      ))}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Quotes block (+ header-parity "Create quote")
// ─────────────────────────────────────────────────────────────────────────────

export function ServiceRequestQuotesCard({ recordId }: DrawerTabProps) {
  const router = useRouter()
  const openRecord = useOpenRecord()

  const { values, isLoading } = useSystemValues(recordId, ['service_request_quotes'], {
    autoFetch: true,
  })
  const quoteRecordIds = extractRelationshipRecordIds(values.service_request_quotes)

  // Active-quote lookup mirrors the header action so the Create row appears under the
  // exact same condition (one active quote per request).
  const { data: activeData, refetch } = api.record.listFiltered.useQuery(
    {
      entityDefinitionId: 'quote',
      filters: [
        {
          id: 'request-quote-lookup',
          logicalOperator: 'AND',
          conditions: [
            {
              id: 'request-quote-lookup-request',
              fieldId: 'quote:request',
              operator: 'is',
              value: recordId,
            },
            {
              id: 'request-quote-lookup-status',
              fieldId: 'quote:status',
              operator: 'not in',
              value: INACTIVE_QUOTE_STATUSES,
            },
          ],
        },
      ],
      limit: 1,
    },
    { enabled: !!recordId }
  )

  const createQuote = api.money.createQuoteFromRequest.useMutation({
    onSuccess: (result) => {
      // In a stack host (drawer) → push the new quote in place; outside one →
      // fall back to the full-page navigation (decisions #7/#8). Refetch the
      // active-quote guard since the SR frame stays mounted beneath the push
      // (before, navigating away made the stale row invisible).
      if (openRecord) {
        void refetch()
        openRecord(result.recordId)
      } else {
        router.push(`/app/quotes/${getInstanceId(result.recordId)}`)
      }
    },
    onError: (error) => {
      toastError({ title: 'Error creating quote', description: error.message })
      void refetch()
    },
  })

  if (isLoading) return <RowSkeleton />

  const hasActiveQuote = !!activeData?.ids[0]

  return (
    <div className={`space-y-0.5 ${TREE_SECONDARY_NOTRUNCATE}`}>
      {quoteRecordIds.map((id) => (
        <RelatedRecordRow key={id} recordId={id} statusAttr='quote_status' />
      ))}

      {!hasActiveQuote && (
        <TreeRow
          icon={<Plus className='size-4' />}
          title={
            <span className='text-sm text-muted-foreground'>
              {createQuote.isPending
                ? 'Creating quote…'
                : quoteRecordIds.length > 0
                  ? 'Create another quote'
                  : 'Create quote'}
            </span>
          }
          onToggleOpen={() => {
            if (!createQuote.isPending) createQuote.mutate({ requestRecordId: recordId })
          }}
        />
      )}
    </div>
  )
}
