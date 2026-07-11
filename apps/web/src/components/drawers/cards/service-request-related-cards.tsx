// apps/web/src/components/drawers/cards/service-request-related-cards.tsx
'use client'

// Service-request drawer overview blocks for the request's related Work Orders and
// Quotes (dispatch STATUS "uniform drawer blocks"). Each related record is a TreeRow:
// the record's icon, its display name, a status Badge in the `secondary` slot, and a
// TreeRowButton that opens the record. The Quotes block's create affordance is the
// SAME TreeRow shape — clicking it runs `money.createQuoteFromRequest` + navigates,
// gated on the one-active-quote-per-request rule (mirrors create-quote-action.tsx).

import { extractRelationshipRecordIds } from '@auxx/lib/field-values/client'
import { getDefinitionId, getInstanceId, type RecordId } from '@auxx/types/resource'
import { Badge, type Variant } from '@auxx/ui/components/badge'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { toastError } from '@auxx/ui/components/toast'
import { TreeRow, TreeRowButton } from '@auxx/ui/components/tree-row'
import { ExternalLink, Plus } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useRecord, useResource } from '~/components/resources'
import { useSystemField } from '~/components/resources/hooks/use-field'
import { useSystemValues } from '~/components/resources/hooks/use-system-values'
import { RecordIcon } from '~/components/resources/ui/record-icon'
import { useRecordLink } from '~/components/resources/utils/get-record-link'
import { api } from '~/trpc/react'
import type { DrawerTabProps } from '../drawer-tab-registry'

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
    <div className='space-y-0.5 [&_[data-slot=tree-row-secondary]]:shrink-0 [&_[data-slot=tree-row-secondary]]:overflow-visible [&_[data-slot=tree-row-secondary]]:whitespace-nowrap'>
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
      mode: 'oneshot',
    },
    { enabled: !!recordId }
  )

  const createQuote = api.money.createQuoteFromRequest.useMutation({
    onSuccess: (result) => {
      router.push(`/app/quotes/${getInstanceId(result.recordId)}`)
    },
    onError: (error) => {
      toastError({ title: 'Error creating quote', description: error.message })
      void refetch()
    },
  })

  if (isLoading) return <RowSkeleton />

  const hasActiveQuote = !!activeData?.ids[0]

  return (
    <div className='space-y-0.5 [&_[data-slot=tree-row-secondary]]:shrink-0 [&_[data-slot=tree-row-secondary]]:overflow-visible [&_[data-slot=tree-row-secondary]]:whitespace-nowrap'>
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

// ─────────────────────────────────────────────────────────────────────────────
// Shared row primitives (uniform across both blocks)
// ─────────────────────────────────────────────────────────────────────────────

/** One related record — record icon + display name + status Badge + open button. */
function RelatedRecordRow({ recordId, statusAttr }: { recordId: RecordId; statusAttr: string }) {
  const router = useRouter()
  const { record } = useRecord({ recordId, enabled: true })
  const { resource } = useResource(getDefinitionId(recordId))
  const { values } = useSystemValues(recordId, [statusAttr], { autoFetch: true })
  const statusField = useSystemField(statusAttr)
  const href = useRecordLink(recordId)

  const status = unwrap(values[statusAttr]) as string | undefined
  const statusOption = statusField?.options?.options?.find((o) => o.value === status)
  const displayName = record?.displayName ?? 'Untitled'

  return (
    <TreeRow
      icon={
        <RecordIcon
          avatarUrl={record?.avatarUrl}
          iconId={resource?.icon || 'circle'}
          color={resource?.color || 'gray'}
          size='xs'
        />
      }
      title={<span className='truncate text-sm'>{displayName}</span>}
      secondary={
        status ? (
          <Badge variant={(statusOption?.color as Variant) ?? 'secondary'} size='xs'>
            {statusOption?.label ?? status}
          </Badge>
        ) : undefined
      }
      actions={
        href ? (
          <TreeRowButton persistent tooltipText='Open' onClick={() => router.push(href)}>
            <ExternalLink />
          </TreeRowButton>
        ) : undefined
      }
    />
  )
}

/** Empty-state row — muted single line, no actions. */
function EmptyRow({ label }: { label: string }) {
  return <div className='px-1 py-1.5 text-sm text-muted-foreground'>{label}</div>
}

function RowSkeleton() {
  return (
    <div className='flex items-center gap-2 px-1 py-1.5'>
      <Skeleton className='size-4 rounded' />
      <Skeleton className='h-4 w-40' />
    </div>
  )
}

/** Extract first element if value is an array (SINGLE_SELECT lens returns arrays). */
function unwrap(value: unknown): unknown {
  return Array.isArray(value) ? value[0] : value
}
