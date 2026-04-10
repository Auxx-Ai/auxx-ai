// apps/web/src/components/drawers/cards/part-inventory-card.tsx
'use client'

import type { ConditionGroup } from '@auxx/lib/conditions/client'
import { StockMovementType } from '@auxx/lib/resources/client'
import type { ResourceFieldId } from '@auxx/types/field'
import type { RecordId } from '@auxx/types/resource'
import type { Variant } from '@auxx/ui/components/badge'
import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import { EntityIcon } from '@auxx/ui/components/icons'
import { ScrollArea } from '@auxx/ui/components/scroll-area'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { cn } from '@auxx/ui/lib/utils'
import { formatRelativeTime } from '@auxx/utils'
import { ChevronRight } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useMemo, useState } from 'react'
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
    <div className='flex items-center gap-2 py-1.5 text-sm ps-0.5'>
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
// Movements List (inline collapsible content)
// ─────────────────────────────────────────────────────────────────

function MovementsList({
  partId,
  currentQoH,
  onAdjustSuccess,
}: {
  partId: string
  currentQoH: number
  onAdjustSuccess: () => void
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

  const sorting = useMemo(() => [{ id: 'createdAt', desc: true }], [])

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
    <div className='border-t border-border/50 pt-2 mt-1'>
      <div className='flex items-center justify-between mb-2'>
        <h4 className='text-xs font-semibold text-muted-foreground'>Stock Movements</h4>
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
        <p className='text-xs text-muted-foreground text-center py-3'>No movements yet</p>
      ) : (
        <ScrollArea className='max-h-[250px]'>
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
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────
// Inventory Card
// ─────────────────────────────────────────────────────────────────

/** Inventory card for the part overview tab */
export function PartInventoryCard({ recordId, entityInstanceId }: DrawerTabProps) {
  const partId = entityInstanceId
  const { values, isLoading } = useSystemValues(recordId, [...PART_ATTRIBUTES], { autoFetch: true })
  const [isOpen, setIsOpen] = useState(false)

  const qoh = (values.part_quantity_on_hand as number) ?? 0
  const stockStatus =
    (values.part_stock_status as string | undefined) ?? (qoh <= 0 ? 'out_of_stock' : 'in_stock')

  const statusVariant = STATUS_VARIANT_MAP[stockStatus]
  const statusLabel = STATUS_LABEL_MAP[stockStatus]

  return (
    <div className='group/entity-card bg-primary-100/50 dark:bg-[#23272e]/50 dark:border rounded-2xl relative outline-none focus:outline-none ring-border-illustration shadow-black/6.5 shadow-md ring-1 w-full'>
      <div className='flex flex-col gap-0 p-3 pe-2'>
        {/* Quantity on Hand */}
        <div className='flex w-full h-fit min-h-[30px] items-center'>
          <div className='items-center self-start flex gap-[4px] h-[24px] shrink-0'>
            <EntityIcon
              iconId='package'
              variant='default'
              size='default'
              className='text-neutral-400'
            />
            <div className='w-[120px] flex items-center text-sm text-neutral-400 shrink-0'>
              <div className='truncate me-1'>Qty on Hand</div>
            </div>
          </div>
          <div className='flex-1 flex items-center justify-end me-3'>
            {isLoading ? (
              <Skeleton className='h-5 w-12' />
            ) : (
              <span className='text-sm font-semibold tabular-nums'>{qoh}</span>
            )}
          </div>
        </div>

        {/* Stock Status (clickable to toggle movements) */}
        <button
          type='button'
          className='flex w-full h-[30px] items-center cursor-pointer rounded-md -mx-1 px-1 transition-colors hover:bg-black/5 dark:hover:bg-white/5'
          onClick={() => setIsOpen(!isOpen)}>
          <div className='items-center self-start flex gap-[4px] h-[24px] shrink-0 mt-1'>
            <EntityIcon
              iconId='activity'
              variant='default'
              size='default'
              className='text-neutral-400 '
            />
            <div className='w-[120px] flex items-center text-sm text-neutral-400 shrink-0'>
              <div className='truncate me-1'>Status</div>
            </div>
          </div>
          <div className='flex-1 flex items-center justify-end gap-2'>
            {!isLoading && (
              <Badge variant={statusVariant} size='xs'>
                {statusLabel}
              </Badge>
            )}
            <ChevronRight
              className={cn(
                'size-4 text-muted-foreground transition-transform duration-200',
                isOpen && 'rotate-90'
              )}
            />
          </div>
        </button>

        {/* Collapsible movements list */}
        <AnimatePresence initial={false}>
          {isOpen && (
            <motion.div
              initial={{ height: 0, opacity: 0, filter: 'blur(3px)', overflow: 'hidden' }}
              animate={{
                height: 'auto',
                opacity: 1,
                filter: 'blur(0px)',
                overflow: 'hidden',
                transitionEnd: { overflow: 'visible' },
              }}
              exit={{ height: 0, opacity: 0, filter: 'blur(3px)', overflow: 'hidden' }}
              transition={{ type: 'spring', stiffness: 300, damping: 30 }}>
              <MovementsList partId={partId} currentQoH={qoh} onAdjustSuccess={() => {}} />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}
