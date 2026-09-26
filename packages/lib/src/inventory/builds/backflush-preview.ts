// packages/lib/src/inventory/builds/backflush-preview.ts

/**
 * What `backflushBuilds` would write over a range (111 D24's confirm). The same walk, nothing
 * written: a planned build's consumption is simulated through the walk's delta and carried
 * across days, so the preview lists exactly the builds the run will raise on the same ledger.
 */

import type { Database } from '@auxx/database'
import type { Result } from 'neverthrow'
import { readBookTimeZoneOrUtc } from '../../accounting/ledger/setup/book-time-zone'
import { listBackflushDays, readBackflushGraph, walkBackflush } from './backflush-planner'
import type { BackflushPlan, BackflushPlanPart, BackflushPlanSummary } from './backflush-types'
import { guard } from './guard'

/** The preview writes nothing, so it can read a year at a time. */
const PREVIEW_SLICE_DAYS = 366

export async function previewBackflush(
  db: Database,
  organizationId: string,
  input: { from: string; to: string; now?: Date }
): Promise<Result<BackflushPlan, Error>> {
  return guard(
    async () => {
      const now = input.now ?? new Date()
      const timeZone = await readBookTimeZoneOrUtc(organizationId)
      const days = listBackflushDays(input, timeZone, now)
      const plan: BackflushPlan = {
        days: days.map((day) => day.day),
        builds: [],
        buildCount: 0,
        unitCount: 0,
        skipped: 0,
        failedDays: [],
      }
      if (days.length === 0) return plan

      const graph = await readBackflushGraph(db, organizationId)
      if (graph.order.length === 0) return plan

      const { skipped } = await walkBackflush({
        organizationId,
        graph,
        days,
        carry: true,
        sliceDays: PREVIEW_SLICE_DAYS,
        act: async (build) => {
          plan.builds.push(build)
          return true
        },
        onDayError: (day, error) => {
          plan.failedDays.push({
            day: day.day,
            reason: error instanceof Error ? error.message : String(error),
          })
        },
      })
      plan.skipped = skipped
      plan.buildCount = plan.builds.length
      plan.unitCount = plan.builds.reduce((sum, build) => sum + build.quantity, 0)
      return plan
    },
    'Previewing the backflush failed',
    { organizationId, from: input.from, to: input.to }
  )
}

/** Per-part counts for the confirm; the per-build list of a multi-year range is too big to send. */
export function summarizeBackflushPlan(plan: BackflushPlan): BackflushPlanSummary {
  const parts = new Map<string, BackflushPlanPart>()
  for (const build of plan.builds) {
    const part = parts.get(build.partId) ?? {
      partId: build.partId,
      partName: build.partName,
      builds: 0,
      units: 0,
    }
    part.builds += 1
    part.units += build.quantity
    parts.set(build.partId, part)
  }
  return {
    dayCount: plan.days.length,
    buildCount: plan.buildCount,
    unitCount: plan.unitCount,
    skipped: plan.skipped,
    failedDays: plan.failedDays,
    parts: [...parts.values()].sort((a, b) => b.builds - a.builds),
  }
}
