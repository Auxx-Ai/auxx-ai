// apps/web/src/components/drawers/cards/related-record-row.tsx
'use client'

// Shared TreeRow primitives for drawer overview "related record" blocks (service
// request work-orders/quotes, work-order invoices, …). One record per TreeRow:
// record icon, display name, a status Badge in the `secondary` slot, and a
// TreeRowButton that opens the record.

import { getDefinitionId, type RecordId } from '@auxx/types/resource'
import { Badge, type Variant } from '@auxx/ui/components/badge'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { TREE_SECONDARY_NOTRUNCATE, TreeRow, TreeRowButton } from '@auxx/ui/components/tree-row'
import { ExternalLink } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useOpenRecord } from '~/components/records/record-drill-panels'
import { useRecord, useResource } from '~/components/resources'
import { useSystemField } from '~/components/resources/hooks/use-field'
import { useSystemValues } from '~/components/resources/hooks/use-system-values'
import { RecordIcon } from '~/components/resources/ui/record-icon'
import { useRecordLink } from '~/components/resources/utils/get-record-link'

// Re-exported for the existing drawer-card consumers; source of truth lives in tree-row.tsx.
export { TREE_SECONDARY_NOTRUNCATE }

/** One related record — record icon + display name + status Badge + open button. */
export function RelatedRecordRow({
  recordId,
  statusAttr,
  href: hrefOverride,
  rowClassName,
}: {
  recordId: RecordId
  statusAttr: string
  /**
   * Open-link override for records without a detail page (useRecordLink returns
   * null for those) — e.g. service_request uses the `/app/service-requests?id=…`
   * records-view drawer convention.
   */
  href?: string
  /** Extra classes for the row (passed through to `TreeRow`), e.g. a hover tint. */
  rowClassName?: string
}) {
  const router = useRouter()
  const { record } = useRecord({ recordId, enabled: true })
  const { resource } = useResource(getDefinitionId(recordId))
  const { values } = useSystemValues(recordId, [statusAttr], { autoFetch: true })
  const statusField = useSystemField(statusAttr)
  const recordHref = useRecordLink(recordId)
  const href = hrefOverride ?? recordHref
  const openRecord = useOpenRecord()

  const status = unwrap(values[statusAttr]) as string | undefined
  const statusOption = statusField?.options?.options?.find((o) => o.value === status)
  const displayName = record?.displayName ?? 'Untitled'

  // In a stack host (drawer) → push the related record in place (decisions #7/#8).
  // Outside one → fall back to the existing href navigation; no href → row stays inert.
  const handleOpen = openRecord
    ? () => openRecord(recordId)
    : href
      ? () => router.push(href)
      : undefined

  return (
    <TreeRow
      rowClassName={rowClassName}
      onDrill={handleOpen}
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
export function EmptyRow({ label }: { label: string }) {
  return <div className='px-1 py-1.5 text-sm text-muted-foreground'>{label}</div>
}

export function RowSkeleton() {
  return (
    <div className='flex items-center gap-2 px-1 py-1.5'>
      <Skeleton className='size-4 rounded' />
      <Skeleton className='h-4 w-40' />
    </div>
  )
}

/** Extract first element if value is an array (SINGLE_SELECT lens returns arrays). */
export function unwrap(value: unknown): unknown {
  return Array.isArray(value) ? value[0] : value
}
