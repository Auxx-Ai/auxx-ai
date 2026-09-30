// apps/web/src/components/drawers/cards/part-inventory-card.tsx
'use client'

import { StockMovementType } from '@auxx/lib/resources/client'
import type { Variant } from '@auxx/ui/components/badge'
import { Badge } from '@auxx/ui/components/badge'
import { TreeRow, TreeRowEmpty, TreeRowSkeleton } from '@auxx/ui/components/tree-row'
import { TreeRowList } from '@auxx/ui/components/tree-row-list'
import { cn } from '@auxx/ui/lib/utils'
import { formatRelativeTime } from '@auxx/utils'
import { formatCurrency } from '@auxx/utils/currency'
import { ArrowDownLeft, ArrowUpRight, History, Package } from 'lucide-react'
import { useState } from 'react'
import { DrawerCardActions } from '~/components/drawers/drawer-card-actions'
import { useCanOpenBuilds } from '~/components/manufacturing/builds/build-badge'
import { openBuildSheet } from '~/components/manufacturing/builds/build-sheet-store'
import { PartStockActions } from '~/components/manufacturing/parts/part-stock-actions'
import { useSystemValues } from '~/components/resources/hooks/use-system-values'
import { useSettings } from '~/hooks/use-settings'
import { api, type RouterOutputs } from '~/trpc/react'
import type { DrawerTabProps } from '../drawer-tab-registry'
import { TREE_SECONDARY_NOTRUNCATE } from './related-record-row'

type MovementItem = RouterOutputs['purchasing']['listMovements']['items'][number]

/** Map movement type values to badge color variants */
const TYPE_COLOR_MAP: Record<string, Variant> = Object.fromEntries(
  StockMovementType.values.map((t) => [t.value, t.color as Variant])
)

/** Map movement type values to labels */
const TYPE_LABEL_MAP: Record<string, string> = Object.fromEntries(
  StockMovementType.values.map((t) => [t.value, t.label])
)

/** Stock status → badge variant */
const STATUS_VARIANT_MAP: Record<string, Variant> = {
  in_stock: 'green',
  low_stock: 'yellow',
  out_of_stock: 'red',
}

/** Stock status → display label */
const STATUS_LABEL_MAP: Record<string, string> = {
  in_stock: 'In Stock',
  low_stock: 'Low Stock',
  out_of_stock: 'Out of Stock',
}

/** How many movements render before the inline "Show more" row collapses the rest. */
const MOVEMENT_PREVIEW_LIMIT = 10

// `part_kind` rides along for the Build gate in `PartStockActions` — one read, already made.
const PART_ATTRIBUTES = ['part_quantity_on_hand', 'part_stock_status', 'part_kind'] as const

/** One stock movement as a TreeRow: signed quantity, type badge, note, cost + date. */
export function StockMovementTreeRow({
  movement,
  currencyCode,
  depth = 1,
  note,
  onOpen,
}: {
  movement: Pick<
    MovementItem,
    'type' | 'quantity' | 'reason' | 'reference' | 'unitCostMinor' | 'effectiveAt'
  >
  currencyCode: string
  depth?: number
  /** Replaces the reason/reference text, e.g. with the part a build leg moved. */
  note?: string | null
  onOpen?: () => void
}) {
  const { type, quantity, reason, reference, unitCostMinor: unitCost } = movement
  // COALESCE(occurredAt, createdAt): only a receipt carries an accounting date.
  const shownAt = movement.effectiveAt

  const isPositive = quantity != null && quantity > 0
  const Icon = isPositive ? ArrowDownLeft : ArrowUpRight

  return (
    <TreeRow
      depth={depth}
      rowClassName='hover:bg-primary-100'
      onToggleOpen={onOpen}
      icon={
        <Icon
          className={cn(
            'size-4',
            isPositive ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'
          )}
        />
      }
      title={
        <span className='font-mono text-xs font-medium tabular-nums text-foreground'>
          {quantity != null ? `${isPositive ? '+' : ''}${quantity}` : '—'}
        </span>
      }
      secondaryFill
      secondary={
        <span className='flex min-w-0 items-center gap-1.5'>
          {type && (
            <Badge variant={TYPE_COLOR_MAP[type]} size='xs' className='shrink-0'>
              {TYPE_LABEL_MAP[type] ?? type}
            </Badge>
          )}
          <span className='truncate text-xs'>{note ?? (reason || reference || '')}</span>
        </span>
      }
      actions={
        <span className='flex shrink-0 items-center gap-2 pe-1 text-xs text-muted-foreground tabular-nums'>
          {unitCost != null && (
            <span className='font-mono'>{formatCurrency(unitCost, { currencyCode })}</span>
          )}
          {shownAt && <span>{formatRelativeTime(shownAt, true)}</span>}
        </span>
      }
    />
  )
}

/** Inventory card for the part overview tab: on-hand + status, and the movements behind it. */
export function PartInventoryCard({ recordId, entityInstanceId }: DrawerTabProps) {
  const partId = entityInstanceId
  const { values, isLoading } = useSystemValues(recordId, [...PART_ATTRIBUTES], { autoFetch: true })
  const [isOpen, setIsOpen] = useState(false)
  const canOpenBuilds = useCanOpenBuilds()

  const { getSetting } = useSettings({})
  const currencyCode = (getSetting('organization.currency') as string | null) ?? 'USD'

  const qoh = (values.part_quantity_on_hand as number) ?? 0
  const partKind = values.part_kind as string | undefined
  const stockStatus =
    (values.part_stock_status as string | undefined) ?? (qoh <= 0 ? 'out_of_stock' : 'in_stock')

  // Lazy: the movements are only fetched once the row is expanded.
  const movements = api.purchasing.listMovements.useQuery(
    { partId, limit: 50 },
    { enabled: isOpen && !!partId }
  )
  const records = movements.data?.items ?? []

  // Only the list: QoH repaints from the realtime frame every QoH recalculation
  // publishes, and `invalidateResource` would wipe the part's cached values.
  const handleSuccess = () => {
    void movements.refetch()
  }

  if (isLoading) return <TreeRowSkeleton />

  return (
    <div className={`space-y-0.5 ${TREE_SECONDARY_NOTRUNCATE}`}>
      <DrawerCardActions>
        <PartStockActions
          partId={partId}
          currentQoH={qoh}
          partKind={partKind}
          onSuccess={handleSuccess}
        />
      </DrawerCardActions>
      <TreeRow
        rowClassName='hover:bg-primary-100'
        icon={<Package className='size-4' />}
        title='Qty on hand'
        secondary={
          <Badge variant={STATUS_VARIANT_MAP[stockStatus]} size='xs'>
            {STATUS_LABEL_MAP[stockStatus]}
          </Badge>
        }
        actions={
          <span className='pe-1 text-sm font-semibold tabular-nums text-foreground'>{qoh}</span>
        }
      />
      <TreeRow
        rowClassName='hover:bg-primary-100'
        icon={<History className='size-4' />}
        title='Stock movements'
        expandable
        isOpen={isOpen}
        onToggleOpen={() => setIsOpen((open) => !open)}>
        {!movements.isLoading && records.length === 0 ? (
          <TreeRowEmpty depth={1} title='No movements yet' />
        ) : (
          <TreeRowList
            items={records}
            loading={movements.isLoading}
            getKey={(movement) => movement.id}
            visibleLimit={MOVEMENT_PREVIEW_LIMIT}
            renderRow={(movement) => {
              const { buildId } = movement
              return (
                <StockMovementTreeRow
                  movement={movement}
                  currencyCode={currencyCode}
                  onOpen={buildId && canOpenBuilds ? () => openBuildSheet(buildId) : undefined}
                />
              )
            }}
          />
        )}
      </TreeRow>
    </div>
  )
}
