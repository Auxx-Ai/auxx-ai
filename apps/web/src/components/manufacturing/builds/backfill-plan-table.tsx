// apps/web/src/components/manufacturing/builds/backfill-plan-table.tsx
'use client'

// The preview table (§7.2 of plans/money/tasks/44-auto-build-cutoff-and-backfill.md).
//
// 🛑 **Rows are PART-first, never period-first.** The argument is the On hand
// column and it is mechanical rather than aesthetic: on hand is a PER-PART
// quantity consumed earliest-first across periods (§7.1a), so in a period-first
// table it has nowhere honest to sit — repeated on every period row it reads as
// "3 available in January and 3 in February", shown only on the first it looks
// like a rendering fault. Part-first states it once, where it is true, and the
// periods below show what is left after it is consumed.
//
// ⚠️ **"Builds per part" is builds per part PER PERIOD.** One part with demand
// in eight months is eight builds at monthly grouping: the part row is a rollup
// and the period rows underneath it are the actual builds. That is why the
// Period cell on a part row reads "8 periods" rather than a date.
//
// The judgement this screen asks for is per part — *is this actually something
// we make, is 412 units over eight months plausible* — which is also why parts
// are the expandable axis and periods are the axis you scan.

import type { BackfillPartPlan, BackfillPlan } from '@auxx/lib/builds/client'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@auxx/ui/components/table'
import { cn } from '@auxx/ui/lib/utils'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { useState } from 'react'

interface BackfillPlanTableProps {
  plan: BackfillPlan
  /** `partId` -> `EntityInstance.displayName`. */
  partNames: Record<string, string | null>
  /** The period the strip is filtering to, or `null` for the whole range. */
  periodFilter: string | null
}

export function BackfillPlanTable({ plan, partNames, periodFilter }: BackfillPlanTableProps) {
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set<string>())

  const parts = periodFilter
    ? plan.parts.filter((part) => part.buckets.some((b) => b.periodKey === periodFilter))
    : plan.parts

  if (parts.length === 0) {
    return (
      <p className='rounded-md border border-dashed px-3 py-6 text-center text-muted-foreground text-sm'>
        {periodFilter
          ? `Nothing to build in ${periodFilter}.`
          : 'Nothing to build in this range. Every ordered part is either already covered or not made here.'}
      </p>
    )
  }

  const toggle = (partId: string) =>
    setExpanded((current) => {
      const next = new Set(current)
      if (!next.delete(partId)) next.add(partId)
      return next
    })

  return (
    <div className='overflow-x-auto rounded-md border'>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className='min-w-[180px]'>Part</TableHead>
            <TableHead className='min-w-[110px]'>Period</TableHead>
            <TableHead className='text-right'>Ordered</TableHead>
            <TableHead className='text-right'>Built</TableHead>
            <TableHead className='text-right'>On hand</TableHead>
            <TableHead className='text-right'>To build</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {parts.map((part) => {
            // A period filter only ever narrows what is shown, never what is
            // planned — the plan is netted at RANGE level (§7.1a), so a filtered
            // part row still states the range totals it was computed from.
            const buckets = periodFilter
              ? part.buckets.filter((bucket) => bucket.periodKey === periodFilter)
              : part.buckets
            const open = expanded.has(part.partId) || !!periodFilter

            return (
              <PartRows
                key={part.partId}
                part={part}
                buckets={buckets}
                open={open}
                // With a period filter on there is exactly one bucket to show
                // and hiding it behind a chevron would be a click that hides the
                // answer the filter was clicked for.
                toggleable={!periodFilter}
                name={partNames[part.partId] ?? null}
                onToggle={() => toggle(part.partId)}
              />
            )
          })}
        </TableBody>
      </Table>
    </div>
  )
}

/** The rollup row, and the build rows underneath it. */
function PartRows({
  part,
  buckets,
  open,
  toggleable,
  name,
  onToggle,
}: {
  part: BackfillPartPlan
  buckets: BackfillPartPlan['buckets']
  open: boolean
  toggleable: boolean
  name: string | null
  onToggle: () => void
}) {
  const Chevron = open ? ChevronDown : ChevronRight

  return (
    <>
      <TableRow
        className={cn(toggleable && 'cursor-pointer')}
        onClick={toggleable ? onToggle : undefined}>
        <TableCell className='font-medium'>
          <span className='flex items-center gap-1'>
            {toggleable ? (
              <Chevron className='size-3.5 shrink-0 text-muted-foreground' />
            ) : (
              <span className='w-3.5 shrink-0' />
            )}
            <span className='truncate'>{name ?? part.partId}</span>
          </span>
        </TableCell>
        <TableCell className='text-muted-foreground text-xs'>
          {part.buckets.length} {part.buckets.length === 1 ? 'period' : 'periods'}
        </TableCell>
        <TableCell className='text-right font-medium tabular-nums'>
          {formatQuantity(part.quantityOrdered)}
        </TableCell>
        {/* ⚠️ The SUM over buckets, not `part.quantityCovered`. The plan-level
            figure is coverage AVAILABLE, which can exceed what was ordered; in a
            column headed "Built" that reads as a contradiction. The buckets
            carry what was actually consumed. */}
        <TableCell className='text-right font-medium tabular-nums'>
          {formatQuantity(sumCovered(part.buckets))}
        </TableCell>
        <TableCell className='text-right font-medium tabular-nums'>
          {formatQuantity(part.quantityOnHand)}
        </TableCell>
        <TableCell className='text-right font-medium tabular-nums'>
          {formatQuantity(part.quantityToBuild)}
        </TableCell>
      </TableRow>

      {open &&
        buckets.map((bucket) => (
          // 🛑 `bucketId`, never `(partId, periodKey)`. Under `grouping: 'order'`
          // two orders placed on the same local day share a period key, and a
          // React list keyed off that pair silently drops one of them.
          <TableRow key={bucket.bucketId} className='bg-muted/30 hover:bg-muted/40'>
            <TableCell />
            <TableCell className='text-xs'>
              <span className='block'>{bucket.periodKey}</span>
              {/* Nothing stores the batch build's orders (§6.2), so this is the
                  only place the link is ever visible. Somebody who does not
                  believe a number has to be able to see how many orders are
                  behind it — the build itself will never be able to tell them. */}
              <span className='block text-[11px] text-muted-foreground'>
                {bucket.orderIds.length} {bucket.orderIds.length === 1 ? 'order' : 'orders'}
              </span>
            </TableCell>
            <TableCell className='text-right tabular-nums'>
              {formatQuantity(bucket.quantityOrdered)}
            </TableCell>
            <TableCell className='text-right tabular-nums'>
              {formatQuantity(bucket.quantityCovered)}
            </TableCell>
            <TableCell className='text-right tabular-nums'>
              {formatQuantity(bucket.quantityFromStock)}
            </TableCell>
            <TableCell className='text-right tabular-nums'>
              {formatQuantity(bucket.quantityToBuild)}
            </TableCell>
          </TableRow>
        ))}
    </>
  )
}

/** What the buckets actually consumed, which is the honest "Built" figure. */
function sumCovered(buckets: BackfillPartPlan['buckets']): number {
  return buckets.reduce((total, bucket) => total + bucket.quantityCovered, 0)
}

/** Quantities are `doublePrecision`, so a fraction is legal and must not round to nothing. */
export function formatQuantity(value: number): string {
  const rounded = Number.isInteger(value) ? value : Number(value.toFixed(4))
  return rounded.toLocaleString()
}
