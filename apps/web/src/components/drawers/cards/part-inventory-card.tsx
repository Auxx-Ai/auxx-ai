// apps/web/src/components/drawers/cards/part-inventory-card.tsx
'use client'

import type { ConditionGroup } from '@auxx/lib/conditions/client'
import { StockMovementType } from '@auxx/lib/resources/client'
import type { ResourceFieldId } from '@auxx/types/field'
import type { RecordId } from '@auxx/types/resource'
import type { Variant } from '@auxx/ui/components/badge'
import { Badge } from '@auxx/ui/components/badge'
import { TreeRow, TreeRowEmpty, TreeRowSkeleton } from '@auxx/ui/components/tree-row'
import { TreeRowList } from '@auxx/ui/components/tree-row-list'
import { cn } from '@auxx/ui/lib/utils'
import { formatRelativeTime } from '@auxx/utils'
import { formatCurrency } from '@auxx/utils/currency'
import { ArrowDownLeft, ArrowUpRight, History, Package } from 'lucide-react'
import { useMemo, useState } from 'react'
import { DrawerCardActions } from '~/components/drawers/drawer-card-actions'
import { PartStockActions } from '~/components/manufacturing/parts/part-stock-actions'
import { toRecordId, useRecordList, useResourceProperty } from '~/components/resources'
import { useSystemValues } from '~/components/resources/hooks/use-system-values'
import { useSettings } from '~/hooks/use-settings'
import type { DrawerTabProps } from '../drawer-tab-registry'
import { TREE_SECONDARY_NOTRUNCATE } from './related-record-row'

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

const MOVEMENT_ATTRIBUTES = [
  'stock_movement_type',
  'stock_movement_quantity',
  'stock_movement_reason',
  'stock_movement_reference',
  // plans/purchasing/01-build-plan.md §3.5 — the frozen cost, and the ACCOUNTING
  // date, which is when the goods arrived rather than when they were keyed.
  'stock_movement_unit_cost',
  'stock_movement_occurred_at',
] as const

/** One stock movement as a nested TreeRow: signed quantity, type badge, reason, cost + date. */
function MovementRow({
  recordId,
  createdAt,
  currencyCode,
}: {
  recordId: RecordId
  createdAt?: string | Date
  currencyCode: string
}) {
  const { values } = useSystemValues(recordId, MOVEMENT_ATTRIBUTES, { autoFetch: true })

  const type = values.stock_movement_type as string | undefined
  const quantity = values.stock_movement_quantity as number | undefined
  const reason = values.stock_movement_reason as string | undefined
  const reference = values.stock_movement_reference as string | undefined
  const unitCost = values.stock_movement_unit_cost as number | null | undefined
  const occurredAt = values.stock_movement_occurred_at as string | undefined
  // COALESCE(occurredAt, createdAt): only a receipt carries an accounting date.
  const shownAt = occurredAt ?? createdAt

  const isPositive = quantity != null && quantity > 0
  const Icon = isPositive ? ArrowDownLeft : ArrowUpRight

  return (
    <TreeRow
      depth={1}
      rowClassName='hover:bg-primary-100'
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
          <span className='truncate text-xs'>{reason || reference || ''}</span>
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

  const stockMovementDefId = useResourceProperty('stock_movement', 'id')
  const { getSetting } = useSettings({})
  const currencyCode = (getSetting('organization.currency') as string | null) ?? 'USD'

  const qoh = (values.part_quantity_on_hand as number) ?? 0
  const partKind = values.part_kind as string | undefined
  const stockStatus =
    (values.part_stock_status as string | undefined) ?? (qoh <= 0 ? 'out_of_stock' : 'in_stock')

  const filters: ConditionGroup[] = useMemo(
    () => [
      {
        id: 'part-filter',
        logicalOperator: 'AND' as const,
        conditions: [
          {
            id: 'part-match',
            fieldId: 'stock_movement:part' as ResourceFieldId,
            operator: 'is' as const,
            value: partId,
          },
        ],
      },
    ],
    [partId]
  )
  const sorting = useMemo(() => [{ id: 'createdAt', desc: true }], [])

  // Lazy: the movements are only fetched once the row is expanded.
  const {
    records,
    isLoading: isLoadingMovements,
    isLoadingRecords,
    refresh,
  } = useRecordList({
    entityDefinitionId: stockMovementDefId ?? '',
    filters,
    sorting,
    limit: 50,
    enabled: isOpen && !!partId && !!stockMovementDefId,
  })

  // Only the list: QoH repaints from the realtime frame every QoH recalculation
  // publishes, and `invalidateResource` would wipe the part's cached values.
  const handleSuccess = () => {
    refresh()
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
        {!isLoadingMovements && !isLoadingRecords && records.length === 0 ? (
          <TreeRowEmpty depth={1} title='No movements yet' />
        ) : (
          <TreeRowList
            items={records}
            loading={isLoadingMovements || (isLoadingRecords && !records.length)}
            getKey={(record) => record.id}
            visibleLimit={MOVEMENT_PREVIEW_LIMIT}
            renderRow={(record) => (
              <MovementRow
                recordId={toRecordId(stockMovementDefId!, record.id)}
                createdAt={record.createdAt}
                currencyCode={currencyCode}
              />
            )}
          />
        )}
      </TreeRow>
    </div>
  )
}
