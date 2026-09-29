// apps/web/src/components/accounting/ui/ledger/stock-movement-badge.tsx

'use client'

import { StockMovementType } from '@auxx/lib/resources/client'
import { cn } from '@auxx/ui/lib/utils'
import type { VariantProps } from 'class-variance-authority'
import { History } from 'lucide-react'
import Link from 'next/link'
import { useMemo } from 'react'
import { toRecordId, useRecordLink, useResourceProperty } from '~/components/resources'
import { recordBadgeVariants } from '~/components/resources/ui/record-badge'
import type { GetRecordLinkOptions } from '~/components/resources/utils/get-record-link'

const TYPE_LABEL: Record<string, string> = Object.fromEntries(
  StockMovementType.values.map((type) => [type.value, type.label])
)

/** The movement a badge names; `type` and `quantity` are optional labels. */
export interface StockMovementRef {
  id: string
  partId: string
  type?: string | null
  quantity?: number | null
}

/** The part's Inventory tab with this movement's row marked (`?movement=`), or null before the part def loads. */
export function useStockMovementHref(movement: Pick<StockMovementRef, 'id' | 'partId'> | null) {
  const partDefId = useResourceProperty('part', 'id')
  const recordId = movement && partDefId ? toRecordId(partDefId, movement.partId) : null
  const id = movement?.id
  const options = useMemo(
    (): GetRecordLinkOptions => ({ tab: 'inventory', query: id ? { movement: id } : undefined }),
    [id]
  )
  return useRecordLink(recordId, options)
}

interface StockMovementBadgeProps extends VariantProps<typeof recordBadgeVariants> {
  movement: StockMovementRef
  /** Render as a link to the part's Inventory tab. Off where the row itself opens it. */
  link?: boolean
  className?: string
}

/** A `StockMovement` row as an inline chip: not a `RecordBadge`, since the table has no definition. */
export function StockMovementBadge({
  movement,
  link = true,
  size,
  className,
}: StockMovementBadgeProps) {
  const href = useStockMovementHref(link ? movement : null)
  const type = movement.type ? (TYPE_LABEL[movement.type] ?? movement.type) : 'Stock movement'
  const quantity =
    movement.quantity == null ? '' : ` · ${movement.quantity > 0 ? '+' : ''}${movement.quantity}`
  const iconClass = size === 'sm' ? 'size-3 shrink-0' : 'size-4 shrink-0'
  const content = (
    <>
      <History className={iconClass} />
      <span className='truncate'>{`${type}${quantity}`}</span>
    </>
  )

  if (href) {
    return (
      <Link
        href={href}
        onClick={(event) => event.stopPropagation()}
        className={cn(recordBadgeVariants({ variant: 'link', size }), className)}>
        {content}
      </Link>
    )
  }
  return <span className={cn(recordBadgeVariants({ size }), className)}>{content}</span>
}
