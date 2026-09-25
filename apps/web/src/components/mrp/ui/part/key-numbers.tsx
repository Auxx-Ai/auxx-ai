// apps/web/src/components/mrp/ui/part/key-numbers.tsx
'use client'

import {
  MRP_LEAD_TIME_CLASS_DAYS,
  MRP_LEAD_TIME_FACTORS,
  MRP_SHARED_BY_REASON_PREFIX,
  MRP_SUGGESTION_KIND_LABELS,
  type MrpProposalReason,
} from '@auxx/lib/mrp/client'
import type { RecordId } from '@auxx/lib/resources/client'
import { StockStatus } from '@auxx/lib/resources/client'
import { Badge } from '@auxx/ui/components/badge'
import { MetricCell, MetricGrid } from '@auxx/ui/components/metric-grid'
import { EmptySection } from '@auxx/ui/components/section'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { cn } from '@auxx/ui/lib/utils'
import { localDateOfDayKey, todayInZone } from '@auxx/utils/calendar-day'
import { format } from 'date-fns'
import { AlertTriangle } from 'lucide-react'
import { EMPTY_CELL } from '~/components/global/module-toolbar'
import { RecordLink } from '~/components/resources/ui/record-link'
import { api, type RouterOutputs } from '~/trpc/react'

export type MrpPartItemData = RouterOutputs['mrp']['partItem']
export type MrpPlanItemData = NonNullable<MrpPartItemData['item']>
export type SupplyHistoryData = RouterOutputs['mrp']['supplyHistory']
export type SupplyHistoryLineData = SupplyHistoryData['vendorParts'][number]['lines'][number] & {
  supplierId: string | null
  supplierName: string | null
}

/** "Oct 2" for a stored day key. */
export function formatDay(day: string | null | undefined): string {
  if (!day) return EMPTY_CELL
  return format(localDateOfDayKey(day), 'MMM d')
}

/** A quantity per each, without trailing zeros. */
export function formatQty(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined) return EMPTY_CELL
  return value.toLocaleString(undefined, { maximumFractionDigits: digits })
}

/** "41 d" for a day count. */
export function formatDays(value: number | null | undefined): string {
  if (value === null || value === undefined) return EMPTY_CELL
  return `${Math.round(value)} d`
}

/** Today in the book zone the read answered in, for lateness. */
export function todayIn(zone: string | undefined): string {
  return todayInZone(zone ?? Intl.DateTimeFormat().resolvedOptions().timeZone)
}

const STOCK_DOT: Record<string, string> = {
  in_stock: 'bg-green-500',
  low_stock: 'bg-amber-500',
  out_of_stock: 'bg-red-500',
}
const STOCK_LABEL: Record<string, string> = Object.fromEntries(
  StockStatus.values.map((v) => [v.value, v.label])
)

/** The `part_stock_status` dot and word (02 D13). */
export function StockStatusDot({ status }: { status: string | null | undefined }) {
  if (!status) return null
  return (
    <span className='inline-flex items-center gap-1'>
      <span className={cn('size-1.5 rounded-full', STOCK_DOT[status] ?? 'bg-muted-foreground')} />
      {STOCK_LABEL[status] ?? status}
    </span>
  )
}

const PROPOSAL_REASON_LABELS: Record<MrpProposalReason, string> = {
  no_usage: 'no usage',
  bought_consumed: 'bought, consumed',
  long_lead: 'long lead',
  sold_from_shelf: 'sold from shelf',
  assemble_to_order: 'assemble to order',
  batch_built: 'built in batches',
  unclassified: 'unclassified',
}

/** A stored proposal reason as a short badge label; `shared_by_4` reads "shared ×4". */
export function proposalReasonLabel(reason: string): string {
  if (reason.startsWith(MRP_SHARED_BY_REASON_PREFIX)) {
    return `shared ×${reason.slice(MRP_SHARED_BY_REASON_PREFIX.length)}`
  }
  return PROPOSAL_REASON_LABELS[reason as MrpProposalReason] ?? reason.replaceAll('_', ' ')
}

/** The default LTF for a decoupled lead time (primer §4.3), for the settings placeholder. */
export function defaultLeadTimeFactor(decoupledDays: number | null | undefined): number | null {
  if (decoupledDays === null || decoupledDays === undefined) return null
  if (decoupledDays >= MRP_LEAD_TIME_CLASS_DAYS.long) return MRP_LEAD_TIME_FACTORS.long
  if (decoupledDays >= MRP_LEAD_TIME_CLASS_DAYS.medium) return MRP_LEAD_TIME_FACTORS.medium
  return MRP_LEAD_TIME_FACTORS.short
}

/** Open issued PO lines in the supply history, which marks them apart from received ones. */
export function openPurchaseLines(history: SupplyHistoryData | undefined): SupplyHistoryLineData[] {
  if (!history) return []
  return history.vendorParts.flatMap((vp) =>
    vp.lines
      .filter((l) => l.status === 'issued' && l.quantityReceived < l.quantityOrdered)
      .map((l) => ({ ...l, supplierId: vp.supplierId, supplierName: vp.supplierName }))
  )
}

/** "2 PO lines · 1 build" under On order; undefined with nothing open. */
export function onOrderDescription(poLines: number, builds: number): string | undefined {
  const parts = [
    poLines > 0 ? `${poLines} PO line${poLines === 1 ? '' : 's'}` : null,
    builds > 0 ? `${builds} build${builds === 1 ? '' : 's'}` : null,
  ].filter(Boolean)
  return parts.length > 0 ? parts.join(' · ') : undefined
}

/** The vendor part whose stats sit beside the stated lead time: the planned one, else the preferred. */
function plannedVendorSupply(
  history: SupplyHistoryData | undefined,
  vendorPartId: string | null | undefined
) {
  if (!history) return null
  return (
    history.vendorParts.find((vp) => vendorPartId && vp.vendorPartId === vendorPartId) ??
    history.vendorParts.find((vp) => vp.stated.isPreferred) ??
    null
  )
}

interface KeyNumbersProps {
  partId: string
  recordId: RecordId
  runId: string | null
}

/** The 3 × 4 metrics strip of 07 §4.5: position, then usage, dates and lead time by column. */
export function KeyNumbers({ partId, recordId, runId }: KeyNumbersProps) {
  const partItem = api.mrp.partItem.useQuery({ partId, runId })
  const history = api.mrp.supplyHistory.useQuery({ partId })

  const loading = partItem.isLoading
  const data = partItem.data
  const item = data?.item ?? null

  if (!loading && !data?.run) {
    return (
      <EmptySection title='No plan run yet' description='Run MRP from Manage to plan this part.' />
    )
  }
  if (!loading && !item) {
    return (
      <EmptySection
        title='Not in this plan run'
        description='The part was added after the run, or the run skipped it.'
      />
    )
  }

  const vendorSupply = plannedVendorSupply(
    history.data,
    item?.suggestedVendorPartId ?? data?.vendorPart?.id
  )
  const drift = item?.flags.includes('lead_time_drift') ?? false
  const supplierName = data?.supplier?.name ?? null

  const suggestion =
    item?.suggestionKind && item.suggestedQty
      ? `${MRP_SUGGESTION_KIND_LABELS[item.suggestionKind]} ${formatQty(item.suggestedQty)}`
      : 'None'

  return (
    <MetricGrid columns={3} className='overflow-hidden rounded-md border'>
      <MetricCell label='On hand' loading={loading} value={formatQty(item?.onHand)} />
      <MetricCell
        label='On order'
        loading={loading}
        value={formatQty(item?.onOrder)}
        description={onOrderDescription(
          data?.openPoLines.length ?? 0,
          data?.openBuilds.length ?? 0
        )}
      />
      <MetricCell
        label='Net flow'
        loading={loading}
        value={formatQty(item?.netFlow)}
        description={item?.openDemand ? `open demand ${formatQty(item.openDemand)}` : undefined}
      />

      <MetricCell label='Avg daily use' loading={loading} value={formatQty(item?.adu, 1)} />
      <MetricCell label='Stockout' loading={loading} value={formatDay(item?.stockoutDate)} />
      <MetricCell
        label='Stated lead time'
        loading={loading}
        value={formatDays(item?.leadTimeDays)}
        description={
          <span className='inline-flex items-center gap-1'>
            {item?.leadTimeSource === 'vendor'
              ? `${supplierName ?? 'vendor'}, vendor`
              : item?.leadTimeSource === 'build'
                ? 'build'
                : 'not set'}
            <span>·</span>
            {item?.leadTimeSource === 'build' || item?.supplyType === 'made' ? (
              <span>edit below</span>
            ) : (
              <RecordLink recordId={recordId} link={{ tab: 'vendors' }} className='underline'>
                edit on Vendors
              </RecordLink>
            )}
          </span>
        }
      />

      <MetricCell label='Days of cover' loading={loading} value={formatDays(item?.daysOfCover)} />
      <MetricCell
        label='Order by'
        loading={loading}
        value={formatDay(item?.orderByDate)}
        description={item?.isOverdue ? 'overdue' : undefined}
      />
      <MetricCell
        label='Observed median'
        loading={loading}
        value={formatDays(item?.observedLeadTimeDays)}
        description={
          drift ? (
            <span className='inline-flex items-center gap-1 text-amber-600'>
              <AlertTriangle className='size-3' />
              drift from stated
            </span>
          ) : item?.observedReceipts ? (
            `${item.observedReceipts} receipts`
          ) : undefined
        }
      />

      <MetricCell label='Suggestion' loading={loading} value={suggestion} />
      <MetricCell label='Buffered'>
        {loading ? (
          <Skeleton className='h-5 w-20' />
        ) : (
          <div className='flex min-w-0 flex-col gap-1'>
            <div className='truncate text-sm font-semibold'>
              {item?.buffered ? 'Buffered' : 'Not buffered'}
              {item && item.buffered !== item.proposedBuffered ? (
                <span className='ml-1 text-xs font-normal text-muted-foreground'>override</span>
              ) : null}
            </div>
            {item && item.proposalReasons.length > 0 ? (
              <div className='flex flex-wrap gap-1'>
                {item.proposalReasons.map((reason) => (
                  <Badge key={reason} variant='outline' size='xs'>
                    {proposalReasonLabel(reason)}
                  </Badge>
                ))}
              </div>
            ) : null}
          </div>
        )}
      </MetricCell>
      <MetricCell
        label='p90'
        loading={history.isLoading}
        value={formatDays(vendorSupply?.stats.p90LeadTimeDays)}
        description={
          vendorSupply
            ? `${vendorSupply.stats.count} receipt${vendorSupply.stats.count === 1 ? '' : 's'}`
            : undefined
        }
      />
    </MetricGrid>
  )
}
