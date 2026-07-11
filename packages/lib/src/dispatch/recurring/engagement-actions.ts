// packages/lib/src/dispatch/recurring/engagement-actions.ts
//
// Pause / Resume / End actions on a recurring engagement (plans/dispatch/06-recurring-engine.md
// §4.1). Each loads the engagement's `RecurrenceRule` by (subjectType, subjectId) and throws
// `NotFoundError` when missing. v1 has no un-end (create a new job instead, §8 Out of scope).

import { database, schema } from '@auxx/database'
import { toRecordId } from '@auxx/types/resource'
import { and, eq, gte, or } from 'drizzle-orm'
import { getEntityDefIdResolver, getOrgCache } from '../../cache'
import { NotFoundError } from '../../errors'
import { FieldValueService } from '../../field-values/field-value-service'
import { publishVisitChanged } from '../broadcast'
import { mirrorVisitOntoWorkOrder } from '../mirror'
import { materializeVisits, todayLocalDate } from './materialize'

type RecurrenceRuleRow = typeof schema.RecurrenceRule.$inferSelect

/** Input shared by the three engagement actions. */
export interface EngagementActionInput {
  organizationId: string
  userId: string
  /** EntityInstance id of the work order (not the RecordId). */
  workOrderInstanceId: string
  /** Realtime echo-suppression — the acting client's own socket id (07 §B.4). */
  excludeSocketId?: string
}

async function loadRule(
  organizationId: string,
  workOrderInstanceId: string
): Promise<RecurrenceRuleRow> {
  const rule = await database.query.RecurrenceRule.findFirst({
    where: and(
      eq(schema.RecurrenceRule.organizationId, organizationId),
      eq(schema.RecurrenceRule.subjectType, 'work_order_visits'),
      eq(schema.RecurrenceRule.subjectId, workOrderInstanceId)
    ),
  })
  if (!rule) throw new NotFoundError('No recurrence rule for this work order')
  return rule
}

/**
 * Delete this rule's future `scheduled` rows (including detached ones) — the pause/end row
 * cleanup (§4.1). `en_route`/`on_site`/`done` rows stay (in-flight/history); `canceled` rows
 * (skips) stay so a later resume doesn't resurrect skipped dates.
 *
 * "Future" is matched on EITHER the slot (`occurrenceDate >= today`) OR the actual
 * `startTime` — a detached row whose past slot was manually rescheduled into the future must
 * not survive a pause as a stray scheduled visit on the board (the pause confirm already
 * warns that manual reschedules on future visits are lost).
 */
async function deleteFutureScheduledRows(rule: RecurrenceRuleRow): Promise<void> {
  const todayIso = todayLocalDate(rule.timezone)
  await database
    .delete(schema.WorkOrderVisit)
    .where(
      and(
        eq(schema.WorkOrderVisit.recurrenceRuleId, rule.id),
        eq(schema.WorkOrderVisit.status, 'scheduled'),
        or(
          gte(schema.WorkOrderVisit.occurrenceDate, todayIso),
          gte(schema.WorkOrderVisit.startTime, new Date())
        )
      )
    )
}

/** Write `work_order_status` via plain `FieldValueService` — this IS the sanctioned writer
 * the `rejectManualEngagementStatus` pre-hook allows through (it never sees this write). */
async function writeEngagementStatus(
  rule: RecurrenceRuleRow,
  userId: string,
  status: 'active' | 'paused' | 'ended'
): Promise<void> {
  const cf = await getOrgCache()
    .from(rule.organizationId, 'customFields')
    .bySystemAttributes(['work_order_status'] as const)
  if (!cf.work_order_status) return

  // Resolve the type-slug to the real `entityDefinitionId` UUID before writing — an
  // unresolved `work_order:<id>` RecordId makes the field-change hook dispatch inside
  // `setValuesForEntity` resolve to no cached resource (`getCachedResource` is an exact
  // `id` match, no type-slug fallback), so `entitySlug` comes back `''` and every
  // field-change hook (MI2's `generateDraftOnCompletion` included) silently no-ops even
  // though the write itself succeeds. Mirrors `UnifiedCrudHandler.update`'s own
  // recordId-resolution step (unified-handler-mutations.ts:452).
  const resolveDefId = await getEntityDefIdResolver(rule.organizationId)
  const fieldValueService = new FieldValueService(rule.organizationId, userId)
  await fieldValueService.setValuesForEntity({
    recordId: toRecordId(resolveDefId('work_order'), rule.subjectId),
    values: [{ fieldId: cf.work_order_status.id, value: status }],
  })
}

/** Mirror + broadcast once (07 §B.3/§B.4) — used by pause/end, which don't otherwise run
 * `materializeVisits` (resume does, and that already mirrors + broadcasts). */
async function mirrorAndBroadcast(
  rule: RecurrenceRuleRow,
  userId: string,
  excludeSocketId?: string
): Promise<void> {
  await mirrorVisitOntoWorkOrder(rule.organizationId, userId, rule.subjectId)
  await publishVisitChanged(
    rule.organizationId,
    { visitId: rule.id, workOrderId: rule.subjectId },
    { excludeSocketId }
  )
}

/**
 * Pause a recurring engagement (§4.1): deletes future `scheduled` rows (including detached —
 * the client's `useConfirm` warns manual reschedules on future visits are lost), sets
 * `work_order_status` → `paused`, mirrors (nulls the schedule mirror — no upcoming visit
 * exists on a paused recurring job, §4.2) and broadcasts.
 */
export async function pauseEngagement(input: EngagementActionInput): Promise<void> {
  const rule = await loadRule(input.organizationId, input.workOrderInstanceId)
  await deleteFutureScheduledRows(rule)
  await writeEngagementStatus(rule, input.userId, 'paused')
  await mirrorAndBroadcast(rule, input.userId, input.excludeSocketId)
}

/**
 * Resume a paused engagement (§4.1): sets `work_order_status` → `active`, then materializes
 * from today — existing `canceled` rows (skips) block their occurrence dates via the
 * ANY-row skip in `materializeVisits`, so skipped dates stay skipped across the resume.
 */
export async function resumeEngagement(input: EngagementActionInput): Promise<void> {
  const rule = await loadRule(input.organizationId, input.workOrderInstanceId)
  await writeEngagementStatus(rule, input.userId, 'active')
  await materializeVisits(rule, { userId: input.userId, excludeSocketId: input.excludeSocketId })
}

/**
 * End a recurring engagement (§4.1) — terminal, no un-end in v1 (§8 Out of scope; create a
 * new job instead). Same row cleanup as pause, `work_order_status` → `ended`.
 */
export async function endEngagement(input: EngagementActionInput): Promise<void> {
  const rule = await loadRule(input.organizationId, input.workOrderInstanceId)
  await deleteFutureScheduledRows(rule)
  await writeEngagementStatus(rule, input.userId, 'ended')
  await mirrorAndBroadcast(rule, input.userId, input.excludeSocketId)
}
