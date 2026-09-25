// apps/web/src/components/mrp/ui/suppliers/supplier-order-card.tsx

'use client'

import type { RecordId } from '@auxx/types/resource'
import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import { Input } from '@auxx/ui/components/input'
import { TreeRow, TreeRowButton, TreeRowSkeleton } from '@auxx/ui/components/tree-row'
import { cn } from '@auxx/ui/lib/utils'
import { CalendarClock, FilePlus2, Package, PanelRight, ShoppingCart } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { type ReactNode, useCallback, useMemo, useState } from 'react'
import { EMPTY_CELL } from '~/components/global/module-toolbar'
import { ListSelectionProvider } from '~/components/list-selection'
import { useOpenRecord } from '~/components/records/record-drill-panels'
import { toRecordId, useResourceProperty } from '~/components/resources'
import { api } from '~/trpc/react'
import { useMrpDrawer } from '../../hooks/use-mrp-drawer'
import { type NextOrderBridge, useNextOrder } from '../../hooks/use-next-order'
import { formatOrderBy, formatQty } from '../rows/format'
import type { MrpListRow } from '../rows/mrp-row'
import {
  ADJUST_MAX,
  ADJUST_MIN,
  adjustQuantity,
  draftItems,
  movesOrderEarlier,
  movesOrderTo,
  seasonFactor,
} from './next-order-lines'
import { type SupplierCard, SupplierGroup } from './supplier-group'
import { useSupplierDraft } from './use-supplier-draft'

export type SupplierOrderCardProps = (
  | { supplierId: string; card?: never }
  | { card: SupplierCard; supplierId?: never }
) & {
  runId?: string | null
  /** `page` on the Suppliers page (rows open the MRP drawer); `block` on the company's Purchasing tab. */
  variant?: 'page' | 'block'
  /** The run's rows by part id (season factor, when-needed rows); fetched for this supplier when absent. */
  rows?: ReadonlyMap<string, MrpListRow>
  /** Overrides how a row opens its part. */
  onOpenPart?: (partId: string) => void
  activePartId?: string | null
}

/** One supplier's next order (07 §4.2): the scheduled card, or the when-needed group. Self-fetches given a `supplierId`. */
export function SupplierOrderCard(props: SupplierOrderCardProps) {
  const { variant = 'page', runId } = props
  const fetched = api.mrp.supplierNextOrder.useQuery(
    { runId: runId ?? null, supplierId: props.supplierId ?? '' },
    { enabled: !props.card && !!props.supplierId }
  )
  const card = props.card ?? fetched.data?.suppliers[0]
  const ownRows = api.mrp.list.useQuery(
    { runId: runId ?? null, tab: 'all', supplierIds: card ? [card.supplierId] : [], limit: 2000 },
    { enabled: !props.rows && !!card }
  )
  const rows = useMemo(
    () => props.rows ?? new Map((ownRows.data?.items ?? []).map((row) => [row.partId, row])),
    [props.rows, ownRows.data]
  )
  const onOpenPart = usePartOpener(variant, props.onOpenPart)

  if (!card) {
    if (!props.card && fetched.isPending) return <TreeRowSkeleton />
    return null
  }

  const body =
    card.orderMode === 'scheduled' ? (
      <ScheduledCard
        card={card}
        rows={rows}
        runId={runId}
        onOpenPart={onOpenPart}
        activePartId={props.activePartId}
      />
    ) : (
      <SupplierGroup
        card={card}
        rows={rows}
        runId={runId}
        onOpenPart={onOpenPart}
        activePartId={props.activePartId}
      />
    )
  // A block sits outside any list page, and the rows' checkboxes need a selection store.
  return variant === 'block' ? <ListSelectionProvider>{body}</ListSelectionProvider> : body
}

/** Page: the MRP drawer. Block: the surrounding record stack when there is one, else the part page. */
function usePartOpener(
  variant: 'page' | 'block',
  override: ((partId: string) => void) | undefined
): (partId: string) => void {
  const { openPart } = useMrpDrawer()
  const openRecord = useOpenRecord()
  const partDefId = useResourceProperty('part', 'id')
  const router = useRouter()
  return useCallback(
    (partId: string) => {
      if (override) return override(partId)
      if (variant === 'page') return openPart(partId)
      if (openRecord && partDefId) return openRecord(toRecordId(partDefId, partId) as RecordId)
      router.push(`/app/parts/${partId}`)
    },
    [override, variant, openPart, openRecord, partDefId, router]
  )
}

interface CardLine {
  partId: string
  name: string
  sku: string | null
  orderByDate: string | null
  stockoutDate: string | null
  excluded: boolean
  movesEarlier: boolean
  wontMake: boolean
  nextArrivalDate: string | null
  followingArrivalDate: string | null
  quantity: number | null
  purchaseUnits: number | null
}

interface ScheduledCardProps {
  card: SupplierCard
  rows: ReadonlyMap<string, MrpListRow>
  runId: string | null | undefined
  onOpenPart: (partId: string) => void
  activePartId?: string | null
}

/** The scheduled supplier's next-order card (02 §6.4): ticks, bridges, order lines, "+x %". */
function ScheduledCard({ card, rows, runId, onOpenPart, activePartId }: ScheduledCardProps) {
  const [open, setOpen] = useState(true)
  const next = useNextOrder({ supplierId: card.supplierId, runId })
  const { live, excluded, toggle, percent } = next

  const byId = useMemo(() => new Map(card.parts.map((part) => [part.partId, part])), [card.parts])
  const nameOf = (partId: string) => byId.get(partId)?.name ?? 'Unnamed part'

  // The stored card until the live plan answers; the stored order-by is the order date, so only the live plan tells movers apart.
  const lines: CardLine[] = useMemo(() => {
    if (live)
      return live.plan.parts.map((part) => ({
        partId: part.partId,
        name: byId.get(part.partId)?.name ?? 'Unnamed part',
        sku: byId.get(part.partId)?.sku ?? null,
        orderByDate: part.orderByDate,
        stockoutDate: byId.get(part.partId)?.stockoutDate ?? null,
        excluded: part.excluded,
        movesEarlier: movesOrderEarlier(part.orderByDate, live.plan.rhythmDate),
        wontMake: part.wontMakeNextArrival,
        nextArrivalDate: part.nextArrivalDate,
        followingArrivalDate: part.followingArrivalDate,
        quantity: part.quantity,
        purchaseUnits: part.purchaseUnits,
      }))
    return card.parts.map((part) => ({
      partId: part.partId,
      name: part.name ?? 'Unnamed part',
      sku: part.sku,
      orderByDate: part.orderByDate,
      stockoutDate: part.stockoutDate,
      excluded: false,
      movesEarlier: part.pullsOrderForward,
      wontMake: part.wontMakeNextArrival,
      nextArrivalDate: part.nextArrivalDate,
      followingArrivalDate: part.followingArrivalDate,
      quantity: part.suggestedQty,
      purchaseUnits: part.suggestedPurchaseUnits,
    }))
  }, [live, card.parts, byId])

  const nextOrderDate = live ? live.plan.nextOrderDate : card.nextOrderDate
  const rhythmDate = live ? live.plan.rhythmDate : card.rhythmDate
  const arrives = live
    ? (lines
        .filter((line) => !line.excluded && line.nextArrivalDate)
        .map((line) => line.nextArrivalDate as string)
        .sort()[0] ?? null)
    : card.nextArrivalDate
  const asOfDay = live?.run.asOfDay ?? null
  const draftRunId = live?.run.id ?? runId

  const pinned = lines.filter((line) => line.wontMake && !line.excluded)
  const movers = lines.filter((line) => line.movesEarlier)
  const separate = lines.filter((line) => line.excluded)
  const orderLines = lines.filter((line) => !line.excluded && !line.wontMake)
  const items = draftItems(lines, percent)

  const { draft, canManage, isPending } = useSupplierDraft(draftRunId, nameOf)
  const openPurchaseOrder = usePurchaseOrderOpener()
  // The bridge goes out as its own draft on the other supplier; the action writes the run memo.
  const draftBridge = async (option: NextOrderBridge) => {
    const [created] = await draft([
      { partId: option.partId, quantity: option.quantity, vendorPartId: option.vendorPartId },
    ])
    if (created) openPurchaseOrder(created.purchaseOrderId)
  }
  const name = card.name ?? 'Unnamed supplier'
  const pulled = !!nextOrderDate && !!rhythmDate && nextOrderDate < rhythmDate

  const quantityCell = (line: CardLine) => (
    <QuantityCell line={line} percent={percent} stale={next.isFetching} />
  )
  const openButton = (partId: string) => (
    <TreeRowButton persistent tooltipText='Open details' onClick={() => onOpenPart(partId)}>
      <PanelRight />
    </TreeRowButton>
  )
  const seasonOf = (line: CardLine) => {
    const factor = seasonFactor(
      rows.get(line.partId)?.seasonalIndex,
      line.nextArrivalDate,
      line.followingArrivalDate
    )
    return factor === null ? null : (
      <span className='text-muted-foreground text-xs tabular-nums'>
        season ×{factor.toFixed(2)}
      </span>
    )
  }
  const rowClass = (partId: string) =>
    cn('hover:bg-primary-100', partId === activePartId && 'bg-primary-100 ring-1 ring-primary-200')

  return (
    <TreeRow
      icon={<CalendarClock className='size-4 text-muted-foreground' />}
      expandable
      isOpen={open}
      onToggleOpen={() => setOpen((prev) => !prev)}
      title={<span className='truncate font-medium text-sm'>{name}</span>}
      secondary={
        <span className='flex flex-wrap items-center gap-x-2 gap-y-0.5 text-muted-foreground text-xs tabular-nums'>
          {card.orderCycleDays !== null && (
            <span>scheduled every ~{Math.round(card.orderCycleDays)} d</span>
          )}
          <span className={cn(pulled && 'text-foreground')}>
            next order {nextOrderDate ? formatOrderBy(nextOrderDate) : EMPTY_CELL}
          </span>
          <span>· rhythm {rhythmDate ? formatOrderBy(rhythmDate) : EMPTY_CELL}</span>
          <span>· arrives {arrives ? formatOrderBy(arrives) : EMPTY_CELL}</span>
        </span>
      }
      actions={
        <Button
          variant='outline'
          size='xs'
          disabled={!canManage || items.length === 0 || next.isFetching}
          title={canManage ? undefined : 'Needs MRP manage'}
          loading={isPending}
          loadingText='Drafting...'
          onClick={(event) => {
            event.stopPropagation()
            void draft(items)
          }}>
          <ShoppingCart />
          Create draft PO
        </Button>
      }
      rowClassName='bg-primary-100/50 hover:bg-primary-100'>
      {next.error && (
        <TreeRow depth={1} title={<span className='text-destructive text-xs'>{next.error}</span>} />
      )}

      {pinned.length > 0 && (
        <Heading label="Won't make the next arrival">
          {pinned.map((line) => (
            <TreeRow
              key={line.partId}
              depth={2}
              icon={<Package className='size-4 text-muted-foreground' />}
              onToggleOpen={() => onOpenPart(line.partId)}
              description={line.sku ?? undefined}
              title={<span className='truncate text-sm'>{line.name}</span>}
              secondary={
                <span className='text-destructive text-xs tabular-nums'>
                  order-by {line.orderByDate ? formatOrderBy(line.orderByDate) : EMPTY_CELL} passed
                  {line.stockoutDate ? ` · stockout ${formatOrderBy(line.stockoutDate)}` : ''}
                </span>
              }
              actions={
                <div className='flex shrink-0 items-center gap-2'>
                  {quantityCell(line)}
                  {openButton(line.partId)}
                </div>
              }
              rowClassName={rowClass(line.partId)}
            />
          ))}
        </Heading>
      )}

      {movers.length > 0 && (
        <Heading label='Moving the order earlier'>
          {movers.map((line) => {
            const to = asOfDay ? movesOrderTo(line.orderByDate, asOfDay) : line.orderByDate
            return (
              <TreeRow
                key={line.partId}
                depth={2}
                icon={<Package className='size-4 text-muted-foreground' />}
                selectable
                selecting
                selected={!excluded.has(line.partId)}
                onSelectChange={() => toggle(line.partId)}
                selectLabel={`Let ${line.name} move the order`}
                onToggleOpen={() => toggle(line.partId)}
                description={line.sku ?? undefined}
                title={<span className='truncate text-sm'>{line.name}</span>}
                secondary={
                  <span
                    className={cn(
                      'text-xs tabular-nums',
                      line.wontMake ? 'text-destructive' : 'text-muted-foreground'
                    )}>
                    order-by {line.orderByDate ? formatOrderBy(line.orderByDate) : EMPTY_CELL}
                    {line.wontMake ? ' (past)' : ''}
                  </span>
                }
                actions={
                  <div className='flex shrink-0 items-center gap-2'>
                    <span className='text-muted-foreground text-xs tabular-nums'>
                      → moves the order to {to ? formatOrderBy(to) : EMPTY_CELL}
                    </span>
                    {openButton(line.partId)}
                  </div>
                }
                rowClassName={rowClass(line.partId)}
              />
            )
          })}
        </Heading>
      )}

      {separate.length > 0 && (
        <Heading label='Handle separately'>
          {separate.flatMap((line) => {
            const options = live?.bridges.filter((b) => b.partId === line.partId) ?? []
            if (options.length === 0)
              return [
                <TreeRow
                  key={line.partId}
                  depth={2}
                  icon={<Package className='size-4 text-muted-foreground' />}
                  onToggleOpen={() => onOpenPart(line.partId)}
                  title={<span className='truncate text-sm'>{line.name}</span>}
                  secondary={
                    <span className='text-muted-foreground text-xs'>
                      no other vendor part with a lead time
                    </span>
                  }
                  actions={openButton(line.partId)}
                  rowClassName={rowClass(line.partId)}
                />,
              ]
            return options.map((option) => (
              <TreeRow
                key={`${line.partId}:${option.vendorPartId}`}
                depth={2}
                icon={<Package className='size-4 text-muted-foreground' />}
                onToggleOpen={() => onOpenPart(line.partId)}
                title={<span className='truncate text-sm'>{line.name}</span>}
                secondary={
                  <span className='flex flex-wrap items-center gap-1.5 text-muted-foreground text-xs tabular-nums'>
                    needs {formatQty(option.quantity)} to reach the container
                    <Badge variant='outline' size='xs'>
                      {option.supplierName ?? 'Unnamed supplier'} · {option.leadTimeDays} d
                    </Badge>
                  </span>
                }
                actions={
                  <div className='flex shrink-0 items-center gap-1'>
                    <TreeRowButton
                      persistent
                      disabled={!canManage || isPending}
                      tooltipText={
                        canManage
                          ? `Draft ${formatQty(option.quantity)} from ${option.supplierName ?? 'another supplier'}`
                          : 'Needs MRP manage'
                      }
                      onClick={() => void draftBridge(option)}>
                      <FilePlus2 />
                    </TreeRowButton>
                    {openButton(line.partId)}
                  </div>
                }
                rowClassName={rowClass(line.partId)}
              />
            ))
          })}
        </Heading>
      )}

      <Heading
        label='Order lines'
        actions={
          <PercentControl
            value={percent}
            onChange={next.setPercent}
            disabled={!orderLines.length}
          />
        }>
        {orderLines.length === 0 ? (
          <TreeRow
            depth={2}
            title={<span className='text-muted-foreground text-xs'>Nothing to order</span>}
          />
        ) : (
          orderLines.map((line) => (
            <TreeRow
              key={line.partId}
              depth={2}
              icon={<Package className='size-4 text-muted-foreground' />}
              onToggleOpen={() => onOpenPart(line.partId)}
              description={line.sku ?? undefined}
              title={<span className='truncate text-sm'>{line.name}</span>}
              secondary={seasonOf(line) ?? undefined}
              actions={
                <div className='flex shrink-0 items-center gap-2'>
                  {quantityCell(line)}
                  {openButton(line.partId)}
                </div>
              }
              rowClassName={rowClass(line.partId)}
            />
          ))
        )}
      </Heading>
    </TreeRow>
  )
}

/** A depth-1 label row over its depth-2 lines. */
function Heading({
  label,
  actions,
  children,
}: {
  label: string
  actions?: ReactNode
  children: ReactNode
}) {
  return (
    <TreeRow
      depth={1}
      title={<span className='font-medium text-muted-foreground text-xs'>{label}</span>}
      actions={actions}>
      {children}
    </TreeRow>
  )
}

/** The line's quantity after "+x %", packs beside it when they differ from eaches. */
function QuantityCell({
  line,
  percent,
  stale,
}: {
  line: CardLine
  percent: number
  stale: boolean
}) {
  const adjusted = adjustQuantity(line.quantity, line.purchaseUnits, percent)
  return (
    <span className={cn('font-mono text-xs tabular-nums', stale && 'opacity-60')}>
      {adjusted ? formatQty(adjusted.quantity) : EMPTY_CELL}
      {adjusted?.purchaseUnits != null && adjusted.purchaseUnits !== adjusted.quantity && (
        <span className='text-muted-foreground'> ({formatQty(adjusted.purchaseUnits)} packs)</span>
      )}
    </span>
  )
}

/** "+x %" on every order line; component state, reset on reload (02 §6.4). */
function PercentControl({
  value,
  onChange,
  disabled,
}: {
  value: number
  onChange: (value: number) => void
  disabled?: boolean
}) {
  return (
    <label
      className='flex items-center gap-1 text-muted-foreground text-xs'
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}>
      <Input
        type='number'
        inputMode='numeric'
        min={ADJUST_MIN}
        max={ADJUST_MAX}
        step={5}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(Number(event.target.value))}
        aria-label='Adjust every order line by a percentage'
        className='h-6 w-16 px-1.5 text-right font-mono text-xs tabular-nums'
      />
      %
    </label>
  )
}

/** Opens a created PO: onto the surrounding record stack when there is one, else its page. */
function usePurchaseOrderOpener(): (purchaseOrderId: string) => void {
  const openRecord = useOpenRecord()
  const poDefId = useResourceProperty('purchase_order', 'id')
  const router = useRouter()
  return useCallback(
    (purchaseOrderId: string) => {
      if (openRecord && poDefId) return openRecord(toRecordId(poDefId, purchaseOrderId) as RecordId)
      router.push(`/app/purchase-orders/${purchaseOrderId}`)
    },
    [openRecord, poDefId, router]
  )
}
