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
import type { BackflushPlan } from './backflush-types'
import { guard } from './guard'

export async function previewBackflush(
  db: Database,
  organizationId: string,
  input: { from: Date; to: Date; now?: Date }
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
