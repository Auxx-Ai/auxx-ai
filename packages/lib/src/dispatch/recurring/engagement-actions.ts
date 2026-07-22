// packages/lib/src/dispatch/recurring/engagement-actions.ts
//
// Pause / Resume / End actions on a recurring engagement (plans/dispatch/06-recurring-engine.md
// §4.1). Each loads the engagement's `RecurrenceRule` by (subjectType, subjectId) and throws
// `NotFoundError` when missing. v1 has no un-end (create a new job instead, §8 Out of scope).

import { database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { toRecordId } from '@auxx/types/resource'
import { and, eq, gt, gte, or } from 'drizzle-orm'
import { getEntityDefIdResolver, getOrgCache } from '../../cache'
import { BadRequestError, NotFoundError } from '../../errors'
import { FieldValueService } from '../../field-values/field-value-service'
import type { RecurrencePattern } from '../../recurrence'
import { exitRunsForDeadVisitSubjects } from '../../sequences/hooks'
import { publishVisitChanged } from '../broadcast'
import { mirrorVisitOntoWorkOrder } from '../mirror'
import { setVisitStatus } from '../visit-mutations'
import { materializeVisits, maybeEndExhaustedEngagement, todayLocalDate } from './materialize'

const logger = createScopedLogger('dispatch:recurring:engagement-actions')

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
async function deleteFutureScheduledRows(rule: RecurrenceRuleRow): Promise<string[]> {
  const todayIso = todayLocalDate(rule.timezone)
  const deleted = await database
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
    .returning({ id: schema.WorkOrderVisit.id })
  return deleted.map((row) => row.id)
}

/** Client-notification churn exit (plan 19 §4.10) — a paused/ended engagement's deleted future
 * visits have nothing left to do; a later resume/rule-edit re-inserts fresh ids that enroll
 * fresh on the next sweep pass. Failures are logged, never thrown (never block pause/end). */
async function exitRunsForDeletedRows(
  organizationId: string,
  ruleId: string,
  deletedVisitIds: string[]
): Promise<void> {
  if (deletedVisitIds.length === 0) return
  try {
    await exitRunsForDeadVisitSubjects(organizationId, deletedVisitIds, 'canceled')
  } catch (error) {
    logger.error('Failed to exit sequence runs for engagement-deleted visits', { error, ruleId })
  }
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
 * `materializeVisits` (resume does, and that already mirrors + broadcasts). `kind: 'bulk'` —
 * an engagement-level (pause/end) write, no single visit row describes it; `visitId` is the
 * RULE id (plan 39 §2.3). */
async function mirrorAndBroadcast(
  rule: RecurrenceRuleRow,
  userId: string,
  excludeSocketId?: string
): Promise<void> {
  await mirrorVisitOntoWorkOrder(rule.organizationId, userId, rule.subjectId)
  await publishVisitChanged(
    rule.organizationId,
    { visitId: rule.id, workOrderId: rule.subjectId, kind: 'bulk' },
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
  const deletedVisitIds = await deleteFutureScheduledRows(rule)
  await writeEngagementStatus(rule, input.userId, 'paused')
  await mirrorAndBroadcast(rule, input.userId, input.excludeSocketId)
  await exitRunsForDeletedRows(rule.organizationId, rule.id, deletedVisitIds)
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
  const deletedVisitIds = await deleteFutureScheduledRows(rule)
  await writeEngagementStatus(rule, input.userId, 'ended')
  await mirrorAndBroadcast(rule, input.userId, input.excludeSocketId)
  await exitRunsForDeletedRows(rule.organizationId, rule.id, deletedVisitIds)
}

/** Input for {@link cancelVisitFollowing}. */
export interface CancelVisitFollowingInput {
  organizationId: string
  userId: string
  /** A series occurrence — must carry `recurrenceRuleId` + `occurrenceDate`. */
  visitId: string
  /** Realtime echo-suppression — the acting client's own socket id (07 §B.4). */
  excludeSocketId?: string
}

/**
 * Cancel a series occurrence AND everything after it — the "Skip this and future visits"
 * choice on the cancel confirm. Three writes:
 *
 * 1. Tombstones the target via {@link setVisitStatus} (transition guard, `dispatchedAt`
 *    clear, worker cancel notice, sequence exits, status roll-up — the full cancel path).
 * 2. Stamps the rule's pattern with `until = occurrenceDate` so the sweep never generates
 *    past it. `until` is inclusive, and the fresh tombstone blocks its own date (the
 *    materializer's ANY-row skip) — so a later Restore revives the target as the series'
 *    final occurrence. `count` is stripped (`until`/`count` are mutually exclusive).
 * 3. Deletes the rule's LATER `scheduled` rows, slot-based (`occurrenceDate` strictly
 *    after the target's) — detached overrides included, their slot is gone with the
 *    series; `done`/in-flight rows stay as history, existing tombstones stay.
 *
 * Unlike {@link endEngagement} this never touches `work_order_status` — occurrences
 * before the target may still be upcoming, and ending the whole engagement remains an
 * explicit job-level action. Rule-less "extra" visits on the job are untouched.
 */
export async function cancelVisitFollowing(input: CancelVisitFollowingInput): Promise<void> {
  const { organizationId, userId, visitId, excludeSocketId } = input

  const visit = await database.query.WorkOrderVisit.findFirst({
    where: and(
      eq(schema.WorkOrderVisit.id, visitId),
      eq(schema.WorkOrderVisit.organizationId, organizationId)
    ),
  })
  if (!visit) throw new NotFoundError('Visit not found')
  if (!visit.recurrenceRuleId || !visit.occurrenceDate) {
    throw new BadRequestError('Visit is not part of a recurring series')
  }
  const rule = await database.query.RecurrenceRule.findFirst({
    where: and(
      eq(schema.RecurrenceRule.id, visit.recurrenceRuleId),
      eq(schema.RecurrenceRule.organizationId, organizationId)
    ),
  })
  if (!rule) throw new NotFoundError('Recurrence rule not found')

  await setVisitStatus({ organizationId, userId, visitId, status: 'canceled', excludeSocketId })

  const { count: _count, ...pattern } = rule.pattern as unknown as RecurrencePattern
  const [updatedRule] = await database
    .update(schema.RecurrenceRule)
    .set({
      pattern: { ...pattern, until: visit.occurrenceDate } as unknown as Record<string, unknown>,
      updatedAt: new Date(),
    })
    .where(eq(schema.RecurrenceRule.id, rule.id))
    .returning()

  const deleted = await database
    .delete(schema.WorkOrderVisit)
    .where(
      and(
        eq(schema.WorkOrderVisit.recurrenceRuleId, rule.id),
        eq(schema.WorkOrderVisit.status, 'scheduled'),
        gt(schema.WorkOrderVisit.occurrenceDate, visit.occurrenceDate)
      )
    )
    .returning({ id: schema.WorkOrderVisit.id })
  await exitRunsForDeletedRows(
    organizationId,
    rule.id,
    deleted.map((row) => row.id)
  )

  // The deletions can change the job's next-visit mirror — mirror + broadcast once more on
  // top of `setVisitStatus`'s own (which ran before the future rows disappeared).
  await mirrorAndBroadcast(rule, userId, excludeSocketId)

  // Plan 36 §A.3: this skip may have killed the whole remaining series (target was the only
  // upcoming occurrence, or the rule window is now empty) — check synchronously instead of
  // leaving the engagement claiming Active until the daily sweep catches it.
  if (updatedRule) await maybeEndExhaustedEngagement(updatedRule)
}
