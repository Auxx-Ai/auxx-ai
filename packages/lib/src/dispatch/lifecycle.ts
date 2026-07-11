// packages/lib/src/dispatch/lifecycle.ts
//
// Baked-in `work_order_status` roll-up (01 §5, 07 §B.2) — one_off jobType only; the
// recurring jobType's engagement-level status fork (`active`/`paused`/`ended`) lands with
// the M2c engine (06 §4.1). Core semantics, not org-editable — split of automation
// responsibility (01 §5): this is "baked into the dispatch service", distinct from the
// seeded/editable customer-comms record rules.

import { extractValue } from '@auxx/types'
import { toRecordId } from '@auxx/types/resource'
import { getOrgCache } from '../cache'
import { FieldValueService } from '../field-values/field-value-service'
import type { VisitStatus } from './types'

/** Triggers that drive the roll-up — a visit status transition, the separate dispatch
 * (notify) action, or the schedule/unschedule mutations. */
export type LifecycleTrigger = VisitStatus | 'dispatched' | 'unscheduled'

/** `work_order_status` rank for the forward-only guard (01 §5) — one_off jobType only. */
const STATUS_RANK: Record<string, number> = {
  new: 0,
  scheduled: 1,
  dispatched: 2,
  en_route: 3,
  on_site: 4,
  completed: 5,
}

/** Target `work_order_status` per trigger (01 §5). */
const TRIGGER_TARGET_STATUS: Record<LifecycleTrigger, string> = {
  scheduled: 'scheduled',
  dispatched: 'dispatched',
  en_route: 'en_route',
  on_site: 'on_site',
  done: 'completed',
  canceled: 'new',
  unscheduled: 'new',
}

/**
 * Resets bypass the forward-only guard: canceling a visit or unscheduling always drops the
 * work order back to `new` — not forward to `canceled` (01 §5: "canceling the JOB is a
 * human decision", so a visit cancel is a reset, never an auto-cancel of the work order).
 */
const RESET_TRIGGERS: ReadonlySet<LifecycleTrigger> = new Set(['canceled', 'unscheduled'])

/**
 * Apply the baked-in one_off status roll-up (07 §B.2). Writes `work_order_status` via
 * plain `FieldValueService` — the `convertRequestToWorkOrder` pre-hook-bypass precedent —
 * so manual dispatcher status edits stay allowed and no guard fights this write.
 * Transitions only move FORWARD from the current status, except the cancel/unschedule reset.
 */
export async function rollUpWorkOrderStatus(
  organizationId: string,
  userId: string,
  workOrderId: string,
  trigger: LifecycleTrigger
): Promise<void> {
  const targetStatus = TRIGGER_TARGET_STATUS[trigger]
  const cf = await getOrgCache()
    .from(organizationId, 'customFields')
    .bySystemAttributes(['work_order_status', 'work_order_job_type'] as const)
  const statusField = cf.work_order_status
  if (!statusField) return

  const recordId = toRecordId('work_order', workOrderId)
  const fieldValueService = new FieldValueService(organizationId, userId)

  // Recurring engagement status (active/paused/ended) is engagement-level, never
  // visit-mirrored (06-recurring-engine.md §4.2) — a visit transition on a recurring job must
  // not clobber it back toward the one_off ladder.
  if (cf.work_order_job_type) {
    const jobTypeTyped = await fieldValueService.getValue({
      recordId,
      fieldId: cf.work_order_job_type.id,
    })
    const jobTypeFirst = Array.isArray(jobTypeTyped) ? jobTypeTyped[0] : jobTypeTyped
    const jobType = jobTypeFirst ? (extractValue(jobTypeFirst) as string) : undefined
    if (jobType === 'recurring') return
  }

  if (!RESET_TRIGGERS.has(trigger)) {
    const currentTyped = await fieldValueService.getValue({ recordId, fieldId: statusField.id })
    // SINGLE_SELECT values come back as arrays — unwrap like convert-to-work-order's firstTyped.
    const currentFirst = Array.isArray(currentTyped) ? currentTyped[0] : currentTyped
    const current = currentFirst ? (extractValue(currentFirst) as string) : undefined
    const currentRank = current !== undefined ? (STATUS_RANK[current] ?? -1) : -1
    const targetRank = STATUS_RANK[targetStatus] ?? -1
    if (targetRank <= currentRank) return // forward-only guard
  }

  await fieldValueService.setValuesForEntity({
    recordId,
    values: [{ fieldId: statusField.id, value: targetStatus }],
  })
}
