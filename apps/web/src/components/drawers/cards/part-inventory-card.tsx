// apps/web/src/components/drawers/cards/part-inventory-card.tsx
'use client'

import type { ConditionGroup } from '@auxx/lib/conditions/client'
import { StockMovementType } from '@auxx/lib/resources/client'
import type { ResourceFieldId } from '@auxx/types/field'
import type { RecordId } from '@auxx/types/resource'
import type { Variant } from '@auxx/ui/components/badge'
import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import { Popover, PopoverContent, PopoverTrigger } from '@auxx/ui/components/popover'
import { ScrollArea } from '@auxx/ui/components/scroll-area'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { formatRelativeTime } from '@auxx/utils'
import { ChevronRight } from 'lucide-react'
import { useMemo } from 'react'
import { StockAdjustmentPopover } from '~/components/manufacturing/parts/stock-adjustment-popover'
import { toRecordId, useRecordList, useResourceProperty } from '~/components/resources'
import { useSystemValues } from '~/components/resources/hooks/use-system-values'
import type { DrawerTabProps } from '../drawer-tab-registry'

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

const PART_ATTRIBUTES = ['part_quantity_on_hand', 'part_stock_status'] as const

const MOVEMENT_ATTRIBUTES = [
  'stock_movement_type',
  'stock_movement_quantity',
  'stock_movement_reason',
  'stock_movement_reference',
] as const

// ─────────────────────────────────────────────────────────────────
// Movement Row
// ─────────────────────────────────────────────────────────────────

function MovementRow({ recordId, createdAt }: { recordId: RecordId; createdAt?: string }) {
  const { values } = useSystemValues(recordId, MOVEMENT_ATTRIBUTES, { autoFetch: true })

  const type = values.stock_movement_type as string | undefined
  const quantity = values.stock_movement_quantity as number | undefined
  const reason = values.stock_movement_reason as string | undefined
  const reference = values.stock_movement_reference as string | undefined

  const isPositive = quantity != null && quantity > 0
  const label = type ? (TYPE_LABEL_MAP[type] ?? type) : '—'
  const color = type ? TYPE_COLOR_MAP[type] : undefined

  return (
    <div className='flex items-center gap-2 py-1.5 text-sm'>
      <Badge variant={color} size='xs' className='shrink-0 w-[90px] justify-center'>
        {label}
      </Badge>
      <span
        className={`font-mono text-xs font-medium tabular-nums ${isPositive ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
        {quantity != null ? `${isPositive ? '+' : ''}${quantity}` : '—'}
      </span>
      <span className='flex-1 truncate text-xs text-muted-foreground'>
        {reason || reference || ''}
      </span>
      {createdAt && (
        <span className='shrink-0 text-xs text-muted-foreground'>
          {formatRelativeTime(createdAt, true)}
        </span>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────
// Movements Popover
// ─────────────────────────────────────────────────────────────────

function MovementsPopover({
  partId,
  currentQoH,
  onAdjustSuccess,
  children,
}: {
  partId: string
  currentQoH: number
  onAdjustSuccess: () => void
  children: React.ReactNode
}) {
  const stockMovementDefId = useResourceProperty('stock_movement', 'id')

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

  const sorting = useMemo(
    () => [{ id: 'stock_movement:createdAt' as ResourceFieldId, desc: true }],
    []
  )

  const { records, isLoading, refresh } = useRecordList({
    entityDefinitionId: stockMovementDefId ?? '',
    filters,
    sorting,
    limit: 50,
    enabled: !!partId && !!stockMovementDefId,
  })

  const handleAdjustSuccess = () => {
    refresh()
    onAdjustSuccess()
  }

  return (
    <Popover>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent className='w-96' align='start'>
        <div className='flex items-center justify-between mb-3'>
          <h4 className='text-sm font-semibold'>Stock Movements</h4>
          <StockAdjustmentPopover
            partId={partId}
            currentQoH={currentQoH}
            onSuccess={handleAdjustSuccess}>
            <Button variant='outline' size='xs'>
              Adjust
            </Button>
          </StockAdjustmentPopover>
        </div>

        {isLoading ? (
          <div className='space-y-2'>
            <Skeleton className='h-6 w-full' />
            <Skeleton className='h-6 w-full' />
            <Skeleton className='h-6 w-full' />
          </div>
        ) : records.length === 0 ? (
          <p className='text-sm text-muted-foreground text-center py-4'>No movements yet</p>
        ) : (
          <ScrollArea className='max-h-[300px]'>
            <div className='divide-y divide-border/50'>
              {records.map((record) => (
                <MovementRow
                  key={record.id}
                  recordId={toRecordId(stockMovementDefId!, record.id)}
                  createdAt={record.createdAt}
                />
              ))}
            </div>
          </ScrollArea>
        )}
      </PopoverContent>
    </Popover>
  )
}

// ─────────────────────────────────────────────────────────────────
// Inventory Card
// ─────────────────────────────────────────────────────────────────

/** Inventory card for the part overview tab */
export function PartInventoryCard({ recordId, entityInstanceId }: DrawerTabProps) {
  const partId = entityInstanceId
  const { values, isLoading } = useSystemValues(recordId, [...PART_ATTRIBUTES], { autoFetch: true })

  const qoh = (values.part_quantity_on_hand as number) ?? 0
  const stockStatus = values.part_stock_status as string | undefined

  const statusVariant = stockStatus ? STATUS_VARIANT_MAP[stockStatus] : undefined
  const statusLabel = stockStatus ? STATUS_LABEL_MAP[stockStatus] : undefined

  return (
    <MovementsPopover partId={partId} currentQoH={qoh} onAdjustSuccess={() => {}}>
      <button
        type='button'
        className='flex w-full items-center justify-between rounded-lg border bg-muted/30 px-4 py-3 text-left transition-colors hover:bg-muted/50'>
        {isLoading ? (
          <Skeleton className='h-7 w-16' />
        ) : (
          <span className='text-xl font-bold tabular-nums'>{qoh}</span>
        )}
        <div className='flex items-center gap-2'>
          {!isLoading && statusVariant && statusLabel && (
            <Badge variant={statusVariant} size='sm'>
              {statusLabel}
            </Badge>
          )}
          <ChevronRight className='size-4 text-muted-foreground' />
        </div>
      </button>
    </MovementsPopover>
  )
}
