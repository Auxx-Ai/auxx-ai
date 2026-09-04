// apps/web/src/components/manufacturing/builds/backfill-exclusions.tsx
'use client'

// The parts that are ordered and produce no build, with the reason
// (§7.2b of plans/money/tasks/44-auto-build-cutoff-and-backfill.md).
//
// 🛑 **The first question anyone asks this screen is "why isn't the 400 lift in
// here?"** If an excluded part is simply absent, that question has no answer,
// and a preview whose omissions cannot be explained is a preview nobody trusts.
//
// The vocabulary is not invented here. `BackfillExclusionReason` is the three
// members of `ConvergenceSkipReason` that transfer to an AGGREGATE, plus
// `already-covered`, which is native to the aggregate and has no per-order twin.
// The other five `ConvergenceSkipReason` members describe a build's relationship
// to ONE order, which is the question this screen does not ask. The set is
// closed on purpose, so `EXCLUSION_COPY` below is a total `Record` over it — a
// fifth member stops this file compiling rather than rendering as a raw slug.
//
// Ordered, Built and On hand ride along on every row because they are what make
// the reason self-evident. `covered-by-stock` is only believable next to the two
// numbers that produced it, and `already-covered` needs the third — the two
// share a shape and differ entirely in remedy.

import type { BackfillExclusion, BackfillExclusionReason } from '@auxx/lib/builds/client'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@auxx/ui/components/table'
import { formatQuantity } from './backfill-plan-table'

/**
 * What each reason says on the row.
 *
 * A `Record` over the closed union rather than a `switch` with a default: add a
 * fourth member to `BackfillExclusionReason` and this stops compiling, which is
 * the whole point of the set being closed.
 */
const EXCLUSION_COPY: Record<BackfillExclusionReason, { label: string; detail: string }> = {
  'not-a-built-part': {
    label: 'Purchased, not made',
    detail: 'Its part kind is a component, so there is no run to raise.',
  },
  'no-bill-of-materials': {
    label: 'No bill of materials',
    detail: 'It is classified as buildable but has nothing to consume.',
  },
  'covered-by-stock': {
    label: 'Covered by stock',
    detail: 'The shelf already covers everything ordered in this range.',
  },
  // 🛑 Deliberately NOT folded into `covered-by-stock`. The two have different
  // remedies, and conflating them is actively misleading on the SECOND run of
  // this dialog, where every part just built is fully covered and would
  // otherwise be reported as sitting on the shelf.
  'already-covered': {
    label: 'Already planned',
    detail: 'Builds already exist for the whole of this demand.',
  },
}

interface BackfillExclusionsProps {
  exclusions: readonly BackfillExclusion[]
  /** `partId` -> `EntityInstance.displayName`. */
  partNames: Record<string, string | null>
}

export function BackfillExclusions({ exclusions, partNames }: BackfillExclusionsProps) {
  if (exclusions.length === 0) return null

  return (
    <div className='flex flex-col gap-1.5'>
      <p className='font-medium text-muted-foreground text-xs'>
        Not being built ({exclusions.length})
      </p>

      <div className='overflow-x-auto rounded-md border border-dashed bg-muted/40'>
        <Table>
          <TableHeader>
            <TableRow className='hover:bg-transparent'>
              <TableHead className='min-w-[180px] text-muted-foreground'>Part</TableHead>
              <TableHead className='min-w-[160px] text-muted-foreground'>Reason</TableHead>
              <TableHead className='text-right text-muted-foreground'>Ordered</TableHead>
              <TableHead className='text-right text-muted-foreground'>Built</TableHead>
              <TableHead className='text-right text-muted-foreground'>On hand</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {exclusions.map((exclusion) => {
              const copy = EXCLUSION_COPY[exclusion.reason]
              return (
                <TableRow key={exclusion.partId} className='text-muted-foreground'>
                  <TableCell className='truncate'>
                    {partNames[exclusion.partId] ?? exclusion.partId}
                  </TableCell>
                  <TableCell>
                    <span className='block text-xs'>{copy.label}</span>
                    <span className='block text-[11px]'>{copy.detail}</span>
                  </TableCell>
                  <TableCell className='text-right tabular-nums'>
                    {formatQuantity(exclusion.quantityOrdered)}
                  </TableCell>
                  <TableCell className='text-right tabular-nums'>
                    {formatQuantity(exclusion.quantityCovered)}
                  </TableCell>
                  <TableCell className='text-right tabular-nums'>
                    {formatQuantity(exclusion.quantityOnHand)}
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
