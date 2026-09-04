// apps/web/src/components/manufacturing/builds/backfill-period-strip.tsx
'use client'

// The chronological read the part-first table gives up (§7.2a of
// plans/money/tasks/44-auto-build-cutoff-and-backfill.md).
//
// Rows are PART-first for a mechanical reason — on hand is a per-part quantity
// consumed earliest-first, so it has nowhere honest to sit in a period-first
// table. That costs the person backfilling history the one view they actually
// want: *how much lands in January, how much in February*. This strip gives it
// back above the table without making period the row axis, and clicking a
// period filters the table to it, which is the "backfill January, then
// February" workflow — available without splitting the RUN, which §7.1a rules
// out anyway because coverage has to be netted at range level.

import type { BackfillPlan } from '@auxx/lib/builds/client'
import { cn } from '@auxx/ui/lib/utils'
import { useMemo } from 'react'

/** One column of the strip: a period, and everything the plan puts in it. */
interface PeriodSummary {
  periodKey: string
  /** Earliest `periodStart` seen for the key, which is what orders the strip. */
  startedAt: number
  buildCount: number
  unitCount: number
}

interface BackfillPeriodStripProps {
  plan: BackfillPlan
  /** The period the table is filtered to, or `null` for all of them. */
  selected: string | null
  onSelect: (periodKey: string | null) => void
}

export function BackfillPeriodStrip({ plan, selected, onSelect }: BackfillPeriodStripProps) {
  const periods = useMemo(() => summarizePeriods(plan), [plan])

  if (periods.length < 2) return null

  return (
    <div className='flex flex-col gap-1.5'>
      <div className='flex items-center justify-between'>
        <p className='font-medium text-muted-foreground text-xs'>Periods</p>
        {selected && (
          <button
            type='button'
            className='text-muted-foreground text-xs underline-offset-2 hover:underline'
            onClick={() => onSelect(null)}>
            Show all
          </button>
        )}
      </div>

      <div className='-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1'>
        {periods.map((period) => {
          const active = period.periodKey === selected
          return (
            <button
              key={period.periodKey}
              type='button'
              aria-pressed={active}
              onClick={() => onSelect(active ? null : period.periodKey)}
              className={cn(
                'shrink-0 rounded-md border px-2.5 py-1.5 text-left transition-colors',
                active
                  ? 'border-primary-300 bg-primary-100 dark:border-primary-700'
                  : 'border-border bg-muted/40 hover:bg-muted'
              )}>
              <span className='block font-medium text-xs'>{period.periodKey}</span>
              <span className='block text-[11px] text-muted-foreground'>
                {period.buildCount} {period.buildCount === 1 ? 'build' : 'builds'} ·{' '}
                {formatCount(period.unitCount)}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

/**
 * Roll the plan's buckets up by period key.
 *
 * Ordered by the earliest `periodStart` behind each key rather than by the key
 * itself: `'2026-01'` sorts correctly as a string and a per-order key does not,
 * and the strip is the chronological view — sorting it lexically would be the
 * one place on this screen where time runs in the wrong order.
 */
function summarizePeriods(plan: BackfillPlan): PeriodSummary[] {
  const byKey = new Map<string, PeriodSummary>()

  for (const part of plan.parts) {
    for (const bucket of part.buckets) {
      const startedAt = new Date(bucket.periodStart).getTime()
      const existing = byKey.get(bucket.periodKey)
      if (existing) {
        existing.buildCount += 1
        existing.unitCount += bucket.quantityToBuild
        existing.startedAt = Math.min(existing.startedAt, startedAt)
        continue
      }
      byKey.set(bucket.periodKey, {
        periodKey: bucket.periodKey,
        startedAt,
        buildCount: 1,
        unitCount: bucket.quantityToBuild,
      })
    }
  }

  return [...byKey.values()].sort((a, b) => a.startedAt - b.startedAt)
}

function formatCount(value: number): string {
  const rounded = Number.isInteger(value) ? value : Number(value.toFixed(4))
  return `${rounded.toLocaleString()} ${rounded === 1 ? 'unit' : 'units'}`
}
