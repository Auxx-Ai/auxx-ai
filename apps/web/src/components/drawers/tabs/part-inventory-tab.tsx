// apps/web/src/components/drawers/tabs/part-inventory-tab.tsx
'use client'

import type { ConditionGroup } from '@auxx/lib/conditions/client'
import { parseRecordId, StockMovementType } from '@auxx/lib/resources/client'
import type { ResourceFieldId } from '@auxx/types/field'
import type { RecordId } from '@auxx/types/resource'
import type { Variant } from '@auxx/ui/components/badge'
import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import { ScrollArea } from '@auxx/ui/components/scroll-area'
import { Section } from '@auxx/ui/components/section'
import { Skeleton } from '@auxx/ui/components/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@auxx/ui/components/table'
import { toastError } from '@auxx/ui/components/toast'
import { formatRelativeTime } from '@auxx/utils'
import { formatCurrency } from '@auxx/utils/currency'
import { Package, PackagePlus, Undo2 } from 'lucide-react'
import { useMemo } from 'react'
import { ReceiveStockPopover } from '~/components/manufacturing/parts/receive-stock-popover'
import { StockAdjustmentPopover } from '~/components/manufacturing/parts/stock-adjustment-popover'
import { toRecordId, useRecordList, useResourceProperty } from '~/components/resources'
import { useSystemValues } from '~/components/resources/hooks/use-system-values'
import { useFieldValueStore } from '~/components/resources/store/field-value-store'
import { useConfirm } from '~/hooks/use-confirm'
import { useSettings } from '~/hooks/use-settings'
import { useAccess } from '~/providers/capabilities-provider'
import { api } from '~/trpc/react'
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
  // plans/purchasing/01-build-plan.md §3.5. A receipt's whole point is the cost
  // it froze, and `occurredAt` is the ACCOUNTING date — when the goods actually
  // arrived, which is not when somebody got round to keying them.
  'stock_movement_unit_cost',
  'stock_movement_occurred_at',
  // The two halves of the reversal link (entity migration 108). A row that already
  // has a reversal must not get a second one, and a row that IS a reversal is not
  // itself reversible — the correction for a bad correction is a fresh movement.
  'stock_movement_reverses_movement',
  'stock_movement_reversed_by_movements',
] as const

/** Inventory tab for the part detail view */
export function PartInventoryTab({ recordId }: DrawerTabProps) {
  const { entityInstanceId: partId } = parseRecordId(recordId)
  const { values, isLoading: isLoadingPart } = useSystemValues(recordId, [...PART_ATTRIBUTES], {
    autoFetch: true,
  })
  // `useSystemValues` has no refetch — drop the cached values for this record and
  // its `autoFetch` re-pulls the recalculated on-hand quantity.
  const invalidateResource = useFieldValueStore((s) => s.invalidateResource)
  const stockMovementDefId = useResourceProperty('stock_movement', 'id')
  // The tab itself is NOT `recordResource`-gated — it leads with the part's own
  // on-hand quantity — so the stock_movement gate sits on the write action.
  const { canEditEntity } = useAccess()
  const canAdjustStock = !!stockMovementDefId && canEditEntity(stockMovementDefId)
  const { getSetting } = useSettings({})
  const currencyCode = (getSetting('organization.currency') as string | null) ?? 'USD'

  const qoh = (values.part_quantity_on_hand as number) ?? 0
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

  const {
    records,
    isLoading: isLoadingMovements,
    refresh,
  } = useRecordList({
    entityDefinitionId: stockMovementDefId ?? '',
    filters,
    sorting,
    limit: 50,
    enabled: !!partId && !!stockMovementDefId,
  })

  const isLoading = isLoadingPart || isLoadingMovements

  const handleAdjustSuccess = () => {
    refresh()
    invalidateResource(recordId)
  }

  if (isLoading) {
    return (
      <div className='p-4 space-y-4'>
        <Skeleton className='h-6 w-32' />
        <Skeleton className='h-40 w-full' />
      </div>
    )
  }

  return (
    <ScrollArea className='flex-1'>
      {/* Summary */}
      <Section title='Stock Summary' initialOpen>
        <div className='flex items-center gap-4 rounded-lg border p-4'>
          <div className='flex flex-col'>
            <span className='text-xs text-muted-foreground'>Quantity on Hand</span>
            <span className='text-2xl font-semibold tabular-nums'>{qoh}</span>
          </div>
          <Badge variant={STATUS_VARIANT_MAP[stockStatus]} size='sm'>
            {STATUS_LABEL_MAP[stockStatus]}
          </Badge>
        </div>
      </Section>

      {/* Stock Movements */}
      <Section
        title={`Stock Movements (${records.length})`}
        initialOpen
        actions={
          canAdjustStock ? (
            <div className='flex items-center gap-1'>
              {/* Receive leads: it is the movement that VALUES stock, and the one
                  a purchase produces. Adjust is the correction beside it. */}
              <ReceiveStockPopover partId={partId} onSuccess={handleAdjustSuccess}>
                <Button variant='ghost' size='xs'>
                  <PackagePlus />
                  Receive
                </Button>
              </ReceiveStockPopover>
              <StockAdjustmentPopover
                partId={partId}
                currentQoH={qoh}
                onSuccess={handleAdjustSuccess}>
                <Button variant='ghost' size='xs'>
                  <Package />
                  Adjust Stock
                </Button>
              </StockAdjustmentPopover>
            </div>
          ) : undefined
        }>
        {records.length === 0 ? (
          <div className='flex h-24 flex-col items-center justify-center text-center border rounded-lg bg-muted/30'>
            <Package className='mb-2 h-6 w-6 text-muted-foreground' />
            <p className='text-sm text-muted-foreground'>No stock movements yet</p>
            <p className='text-xs text-muted-foreground'>
              Adjust stock to create the first movement
            </p>
          </div>
        ) : (
          <div className='rounded-md border'>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Type</TableHead>
                  <TableHead className='text-right'>Qty</TableHead>
                  <TableHead className='text-right'>Unit cost</TableHead>
                  <TableHead>Reason</TableHead>
                  <TableHead className='text-right'>Date</TableHead>
                  <TableHead className='w-10' />
                </TableRow>
              </TableHeader>
              <TableBody>
                {records.map((record) => (
                  <MovementRow
                    key={record.id}
                    recordId={toRecordId(stockMovementDefId!, record.id)}
                    createdAt={record.createdAt}
                    currencyCode={currencyCode}
                    canReverse={canAdjustStock}
                    onReversed={handleAdjustSuccess}
                  />
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Section>
    </ScrollArea>
  )
}

// ─── Row Component ──────────────────────────────────────────────────────

function MovementRow({
  recordId,
  createdAt,
  currencyCode,
  canReverse,
  onReversed,
}: {
  recordId: RecordId
  createdAt?: string | Date
  currencyCode: string
  canReverse: boolean
  onReversed: () => void
}) {
  const [confirm, ConfirmDialog] = useConfirm()
  const reverseMovement = api.purchasing.reverseMovement.useMutation({
    onError: (error) => {
      toastError({ title: 'Could not reverse movement', description: error.message })
    },
  })
  const { values } = useSystemValues(recordId, MOVEMENT_ATTRIBUTES, { autoFetch: true })

  const type = values.stock_movement_type as string | undefined
  const quantity = values.stock_movement_quantity as number | undefined
  const reason = values.stock_movement_reason as string | undefined
  const reference = values.stock_movement_reference as string | undefined
  const unitCost = values.stock_movement_unit_cost as number | null | undefined
  const occurredAt = values.stock_movement_occurred_at as string | undefined
  // COALESCE(occurredAt, createdAt) — an adjustment carries no accounting date, so
  // it falls back to when it was written. A receipt has one and it is the truth.
  const shownAt = occurredAt ?? createdAt

  // A movement with no frozen cost cannot be reversed: the negation would be the
  // zero-cost row `receiveStock` refuses to write in the first place. A row that
  // already has a reversal, or that IS one, is equally out — the server enforces
  // all three, this only keeps the menu honest.
  const alreadyReversed =
    ((values.stock_movement_reversed_by_movements as unknown[]) ?? []).length > 0
  const isReversal = values.stock_movement_reverses_movement != null
  const canReverseThis = canReverse && unitCost != null && !alreadyReversed && !isReversal

  const handleReverse = async () => {
    const confirmed = await confirm({
      title: 'Reverse this movement?',
      description:
        'A cancelling movement is written at the original frozen cost. The original stays in the ledger.',
      confirmText: 'Reverse',
      cancelText: 'Cancel',
      destructive: true,
    })
    if (!confirmed) return
    const { entityInstanceId } = parseRecordId(recordId)
    await reverseMovement.mutateAsync({ movementId: entityInstanceId })
    onReversed()
  }

  const isPositive = quantity != null && quantity > 0
  const label = type ? (TYPE_LABEL_MAP[type] ?? type) : '—'
  const color = type ? TYPE_COLOR_MAP[type] : undefined

  return (
    <TableRow>
      <TableCell>
        <Badge variant={color} size='xs'>
          {label}
        </Badge>
      </TableCell>
      <TableCell className='text-right'>
        <span
          className={`font-mono text-xs font-medium tabular-nums ${isPositive ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
          {quantity != null ? `${isPositive ? '+' : ''}${quantity}` : '—'}
        </span>
      </TableCell>
      <TableCell className='text-right'>
        <span className='font-mono text-muted-foreground text-xs tabular-nums'>
          {unitCost != null ? formatCurrency(unitCost, { currencyCode }) : '—'}
        </span>
      </TableCell>
      <TableCell>
        <span className='truncate text-sm text-muted-foreground'>{reason || reference || '—'}</span>
      </TableCell>
      <TableCell className='text-right'>
        <span className='text-xs text-muted-foreground'>
          {shownAt ? formatRelativeTime(shownAt, true) : '—'}
        </span>
      </TableCell>
      <TableCell className='text-right'>
        <ConfirmDialog />
        {canReverseThis ? (
          <Button
            variant='ghost'
            size='xs'
            loading={reverseMovement.isPending}
            onClick={handleReverse}
            aria-label='Reverse this movement'>
            <Undo2 />
          </Button>
        ) : null}
      </TableCell>
    </TableRow>
  )
}
