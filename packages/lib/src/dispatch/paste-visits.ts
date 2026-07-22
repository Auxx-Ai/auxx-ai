// packages/lib/src/dispatch/paste-visits.ts
//
// Copy/paste's server write (plans/dispatch/37c-calendar-create-copy-paste.md §4.4). The ONE
// deliberate batch endpoint in dispatch (§5.2's client-loop convention covers everything
// else) — the paste-options dialog is the confirm, so a single round trip has to return the
// created+failed summary the dialog reports.

import type { schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { addVisit } from './visit-mutations'

type WorkOrderVisitRow = typeof schema.WorkOrderVisit.$inferSelect

const logger = createScopedLogger('dispatch:paste-visits')

/** One pasted visit — a target work order + the slot it lands on (§4.2 offset math already
 * applied client-side) + assignee intent (§4.3: omit to leave the fresh row unassigned,
 * `null` to explicitly clear, a userId to retarget). */
export interface PasteVisitItem {
  /** EntityInstance id of the work order (not the RecordId). */
  workOrderInstanceId: string
  startTime: Date
  endTime: Date
  assigneeUserId?: string | null
}

/** Input for {@link pasteVisits}. */
export interface PasteVisitsInput {
  organizationId: string
  userId: string
  items: PasteVisitItem[]
  /** Realtime echo-suppression — the acting client's own socket id (07 §B.4). */
  excludeSocketId?: string
}

/** One item's failure, keyed by its position in {@link PasteVisitsInput.items} so the client
 * can map it back to the row it pasted. */
export interface PasteVisitsFailure {
  index: number
  message: string
}

/** Result of {@link pasteVisits} — partial success is expected, not an error. */
export interface PasteVisitsResult {
  created: WorkOrderVisitRow[]
  failures: PasteVisitsFailure[]
}

/**
 * Paste N visits (§4.4) — a sequential loop over {@link addVisit}, the existing paste
 * primitive: it always inserts a new rule-less row (`recurrenceRuleId: null`,
 * `occurrenceDate: null` — a paste is a manual clone, even of a series visit) and, since every
 * item here carries `startTime`/`endTime`, commits through `scheduleVisit` in the same call so
 * each row gets full scheduling semantics (mirror, status roll-up, sequence enrollment,
 * realtime broadcast) — landing at `status: 'scheduled'` without this function forcing it.
 *
 * Deliberately NOT wrapped in a DB transaction (plan 31 §D): the pool-scoped field-change hooks
 * `addVisit`/`scheduleVisit` trigger would go blind inside one. Items are independent rows, so
 * partial success is acceptable — a bad item (e.g. a stale `workOrderInstanceId`) is collected
 * as a failure and the rest still land; there's nothing to compensate/roll back.
 */
export async function pasteVisits(input: PasteVisitsInput): Promise<PasteVisitsResult> {
  const { organizationId, userId, items, excludeSocketId } = input

  const created: WorkOrderVisitRow[] = []
  const failures: PasteVisitsFailure[] = []

  for (let index = 0; index < items.length; index++) {
    const item = items[index]
    if (!item) continue
    try {
      const visit = await addVisit({
        organizationId,
        userId,
        workOrderInstanceId: item.workOrderInstanceId,
        startTime: item.startTime,
        endTime: item.endTime,
        assigneeUserId: item.assigneeUserId,
        excludeSocketId,
      })
      created.push(visit)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      logger.warn('Failed to paste visit', {
        error,
        index,
        workOrderInstanceId: item.workOrderInstanceId,
      })
      failures.push({ index, message })
    }
  }

  return { created, failures }
}
