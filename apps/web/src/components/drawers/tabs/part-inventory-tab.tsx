// apps/web/src/components/drawers/tabs/part-inventory-tab.tsx
'use client'

import { parseRecordId, StockMovementType } from '@auxx/lib/resources/client'
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
import { cn } from '@auxx/ui/lib/utils'
import { formatRelativeTime } from '@auxx/utils'
import { formatCurrency } from '@auxx/utils/currency'
import { Factory, Package, PackagePlus, Undo2 } from 'lucide-react'
import Link from 'next/link'
import { useQueryState } from 'nuqs'
import { BuildBadge } from '~/components/manufacturing/builds/build-badge'
import { ReceiveStockPopover } from '~/components/manufacturing/parts/receive-stock-popover'
import { StockAdjustmentPopover } from '~/components/manufacturing/parts/stock-adjustment-popover'
import { stockSetupHref } from '~/components/manufacturing/stock-setup/stock-setup-href'
import { useResourceProperty } from '~/components/resources'
import { useSystemValues } from '~/components/resources/hooks/use-system-values'
import { useFieldValueStore } from '~/components/resources/store/field-value-store'
import { useConfirm } from '~/hooks/use-confirm'
import { useSettings } from '~/hooks/use-settings'
import { useAccess } from '~/providers/capabilities-provider'
import { api, type RouterOutputs } from '~/trpc/react'
import type { DrawerTabProps } from '../drawer-tab-registry'

type MovementItem = RouterOutputs['purchasing']['listMovements']['items'][number]

/** Map movement type values to badge color variants */
const TYPE_COLOR_MAP: Record<string, Variant> = Object.fromEntries(
  StockMovementType.values.map((t) => [t.value, t.color as Variant])
)

/** Map movement type values to labels */
const TYPE_LABEL_MAP: Record<string, string> = Object.fromEntries(
  StockMovementType.values.map((t) => [t.value, t.label])
)

/**
 * Movements per page.
 *
 * Unlike a BOM this list is UNBOUNDED — a busy part accumulates thousands — so
 * it pages behind a control rather than draining. What changed is that the
 * truncation is now visible: the header counts `total`, not the loaded rows.
 */
const MOVEMENT_PAGE_SIZE = 50

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

const PART_ATTRIBUTES = ['part_title', 'part_quantity_on_hand', 'part_stock_status'] as const

/** Inventory tab for the part detail view */
export function PartInventoryTab({ recordId }: DrawerTabProps) {
  const { entityInstanceId: partId } = parseRecordId(recordId)
  const { values, isLoading: isLoadingPart } = useSystemValues(recordId, [...PART_ATTRIBUTES], {
    autoFetch: true,
  })
  // `useSystemValues` has no refetch — drop the cached values for this record and
  // its `autoFetch` re-pulls the recalculated on-hand quantity.
  const invalidateResource = useFieldValueStore((s) => s.invalidateResource)
  const partDefId = useResourceProperty('part', 'id')
  const { canEditEntity } = useAccess()
  const canAdjustStock = !!partDefId && canEditEntity(partDefId)
  const { getSetting } = useSettings({})
  const currencyCode = (getSetting('organization.currency') as string | null) ?? 'USD'
  // Set by a ledger `StockMovementBadge`: the row to mark once it is loaded.
  const [focusedMovementId] = useQueryState('movement')

  const qoh = (values.part_quantity_on_hand as number) ?? 0
  const stockStatus =
    (values.part_stock_status as string | undefined) ?? (qoh <= 0 ? 'out_of_stock' : 'in_stock')

  // A made part links to *Record past builds* (plans/mrp/17 §7); the preflight says whether it has a BOM.
  const preflight = api.purchasing.setCountPreflight.useQuery(
    { partIds: [partId] },
    { enabled: !!partId && canAdjustStock }
  )
  const flight = preflight.data?.[0]

  const movements = api.purchasing.listMovements.useInfiniteQuery(
    { partId, limit: MOVEMENT_PAGE_SIZE },
    { enabled: !!partId, getNextPageParam: (page) => page.nextCursor }
  )
  const records = movements.data?.pages.flatMap((page) => page.items) ?? []
  const total = movements.data?.pages[0]?.total ?? 0

  const isLoading = isLoadingPart || movements.isLoading

  const handleAdjustSuccess = () => {
    void movements.refetch()
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
        title={`Stock Movements (${total})`}
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
              {flight?.hasBom && (
                <Button variant='ghost' size='xs' asChild>
                  <Link href={stockSetupHref('builds')}>
                    <Factory />
                    Record past builds
                  </Link>
                </Button>
              )}
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
                {records.map((movement) => (
                  <MovementRow
                    key={movement.id}
                    movement={movement}
                    focused={movement.id === focusedMovementId}
                    currencyCode={currencyCode}
                    canReverse={canAdjustStock}
                    onReversed={handleAdjustSuccess}
                  />
                ))}
              </TableBody>
            </Table>
            {movements.hasNextPage && (
              <div className='flex justify-center border-t p-1'>
                <Button
                  variant='ghost'
                  size='xs'
                  loading={movements.isFetchingNextPage}
                  loadingText='Loading...'
                  onClick={() => movements.fetchNextPage()}>
                  Load more
                </Button>
              </div>
            )}
          </div>
        )}
      </Section>
    </ScrollArea>
  )
}

// ─── Row Component ──────────────────────────────────────────────────────

function MovementRow({
  movement,
  focused,
  currencyCode,
  canReverse,
  onReversed,
}: {
  movement: MovementItem
  focused: boolean
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

  const { type, quantity, reason, reference, unitCostMinor: unitCost } = movement
  // COALESCE(occurredAt, createdAt) — an adjustment carries no accounting date, so
  // it falls back to when it was written. A receipt has one and it is the truth.
  const shownAt = movement.effectiveAt

  // A movement with no frozen cost cannot be reversed: the negation would be the
  // zero-cost row `receiveStock` refuses to write in the first place. A row that
  // already has a reversal, or that IS one, is equally out — the server enforces
  // all three, this only keeps the menu honest.
  const canReverseThis =
    canReverse &&
    unitCost != null &&
    movement.reversedById == null &&
    movement.reversesMovementId == null

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
    await reverseMovement.mutateAsync({ movementId: movement.id })
    onReversed()
  }

  const isPositive = quantity != null && quantity > 0
  const label = type ? (TYPE_LABEL_MAP[type] ?? type) : '—'
  const color = type ? TYPE_COLOR_MAP[type] : undefined

  return (
    <TableRow
      ref={focused ? (row) => row?.scrollIntoView({ block: 'center' }) : undefined}
      className={cn(focused && 'bg-primary-100')}>
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
        {movement.buildId ? (
          <BuildBadge build={{ buildId: movement.buildId }} size='sm' />
        ) : canReverseThis ? (
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
