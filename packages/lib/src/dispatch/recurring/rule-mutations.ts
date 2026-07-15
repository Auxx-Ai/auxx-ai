// packages/lib/src/dispatch/recurring/rule-mutations.ts
//
// Rule create/edit + regeneration (plans/dispatch/06-recurring-engine.md §4.3/§5.2) — the
// engine's single write door for a recurring engagement's schedule. Three-way edits (the #7
// popover / job view) all funnel through `setRecurrenceRule` with a different
// `effectiveFrom`: "this and following" anchors at the target visit's `occurrenceDate`, "all
// visits" anchors at the rule's immutable `anchor` — past-freezing then clamps the
// regeneration boundary to today (§4.3).

import { database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { extractValue } from '@auxx/types'
import { toRecordId } from '@auxx/types/resource'
import { and, eq, gte, inArray, isNull } from 'drizzle-orm'
import { getOrgCache } from '../../cache'
import { FieldValueService } from '../../field-values/field-value-service'
import type { RecurrencePattern } from '../../recurrence'
import { exitRunsForDeadVisitSubjects } from '../../sequences/hooks'
import { getWorkOrderStatus, materializeVisits, todayLocalDate } from './materialize'

const logger = createScopedLogger('dispatch:recurring:rule-mutations')

type RecurrenceRuleRow = typeof schema.RecurrenceRule.$inferSelect

/** Visit template carried by the rule (§3.1) — the schedule shape each materialized
 * occurrence gets. */
export interface RecurrenceTemplate {
  startMinute: number
  durationMinutes: number
  /** Omit or `null` for the unassigned rail. */
  defaultAssigneeUserId?: string | null
}

/** Input for {@link setRecurrenceRule}. */
export interface SetRecurrenceRuleInput {
  organizationId: string
  userId: string
  /** EntityInstance id of the work order (not the RecordId). */
  workOrderInstanceId: string
  pattern: RecurrencePattern
  template: RecurrenceTemplate
  timezone: string
  /**
   * Local ISO date (`YYYY-MM-DD`). On create this becomes the rule's immutable `anchor`. On
   * edit this is the three-way edit anchor (§4.3): the target visit's `occurrenceDate` ("this
   * and following") or the rule's `anchor` ("all visits" — past-freezing clamps the actual
   * regeneration boundary to today via `max(today, effectiveFrom)`).
   */
  effectiveFrom: string
  /** Realtime echo-suppression — the acting client's own socket id (07 §B.4). */
  excludeSocketId?: string
}

/**
 * Deep-equal for jsonb `RecurrencePattern` values — sorted-key stringify. jsonb reorders keys
 * on a DB round-trip, so a naive `JSON.stringify` comparison of the stored pattern against a
 * freshly-submitted one is unsafe.
 */
function patternsEqual(a: unknown, b: unknown): boolean {
  const sortKeys = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(sortKeys)
    if (value && typeof value === 'object') {
      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>)
          .sort(([x], [y]) => x.localeCompare(y))
          .map(([key, val]) => [key, sortKeys(val)])
      )
    }
    return value
  }
  return JSON.stringify(sortKeys(a)) === JSON.stringify(sortKeys(b))
}

/**
 * Create or edit a recurring engagement's rule (§4.3/§5.2): upserts the `RecurrenceRule` row
 * (unique on `subjectType`+`subjectId`), regenerates affected visit rows per the three-way
 * edit rules, flips `work_order_job_type`/`work_order_status` to `recurring`/`active` when
 * needed (the #7 convergence rule), then materializes (§4.4 — mirrors + broadcasts once).
 */
export async function setRecurrenceRule(input: SetRecurrenceRuleInput): Promise<RecurrenceRuleRow> {
  const {
    organizationId,
    userId,
    workOrderInstanceId,
    pattern,
    template,
    timezone,
    effectiveFrom,
    excludeSocketId,
  } = input

  const existing = await database.query.RecurrenceRule.findFirst({
    where: and(
      eq(schema.RecurrenceRule.organizationId, organizationId),
      eq(schema.RecurrenceRule.subjectType, 'work_order_visits'),
      eq(schema.RecurrenceRule.subjectId, workOrderInstanceId)
    ),
  })

  const patternChanged = !existing || !patternsEqual(existing.pattern, pattern)

  const [rule] = existing
    ? await database
        .update(schema.RecurrenceRule)
        .set({
          pattern: pattern as unknown as Record<string, unknown>,
          timezone,
          effectiveFrom,
          startMinute: template.startMinute,
          durationMinutes: template.durationMinutes,
          defaultAssigneeUserId: template.defaultAssigneeUserId ?? null,
        })
        .where(eq(schema.RecurrenceRule.id, existing.id))
        .returning()
    : await database
        .insert(schema.RecurrenceRule)
        .values({
          organizationId,
          subjectType: 'work_order_visits',
          subjectId: workOrderInstanceId,
          pattern: pattern as unknown as Record<string, unknown>,
          timezone,
          anchor: effectiveFrom,
          effectiveFrom,
          startMinute: template.startMinute,
          durationMinutes: template.durationMinutes,
          defaultAssigneeUserId: template.defaultAssigneeUserId ?? null,
        })
        .returning()
  if (!rule) throw new Error('Failed to upsert recurrence rule')

  // Regeneration (§4.3): boundary B = max(today, effectiveFrom). Rows before B, and any row
  // in en_route/on_site/done, are never touched (excluded by construction below — we only
  // ever filter to status scheduled/canceled).
  const todayIso = todayLocalDate(timezone)
  const boundaryIso = todayIso > effectiveFrom ? todayIso : effectiveFrom

  let deletedVisitIds: string[]
  if (patternChanged) {
    // Cadence change invalidates old slots outright — including detached rows (their date no
    // longer means what it used to under the new pattern) and canceled rows (skips referred
    // to the old pattern).
    const deleted = await database
      .delete(schema.WorkOrderVisit)
      .where(
        and(
          eq(schema.WorkOrderVisit.recurrenceRuleId, rule.id),
          gte(schema.WorkOrderVisit.occurrenceDate, boundaryIso),
          inArray(schema.WorkOrderVisit.status, ['scheduled', 'canceled'])
        )
      )
      .returning({ id: schema.WorkOrderVisit.id })
    deletedVisitIds = deleted.map((row) => row.id)
  } else {
    // Template-only edit (time/duration/assignee): preserve detached rows as explicit
    // per-visit overrides and leave canceled rows (skips) alone.
    const deleted = await database
      .delete(schema.WorkOrderVisit)
      .where(
        and(
          eq(schema.WorkOrderVisit.recurrenceRuleId, rule.id),
          gte(schema.WorkOrderVisit.occurrenceDate, boundaryIso),
          eq(schema.WorkOrderVisit.status, 'scheduled'),
          eq(schema.WorkOrderVisit.isDetached, false)
        )
      )
      .returning({ id: schema.WorkOrderVisit.id })
    deletedVisitIds = deleted.map((row) => row.id)
  }

  // Client-notification churn exit (plan 19 §4.10): a rule-edit-deleted visit's sequence runs
  // have nothing left to do — the re-inserted replacement (below, via `materializeVisits`) is a
  // fresh id that enrolls fresh on the next sweep pass.
  if (deletedVisitIds.length > 0) {
    try {
      await exitRunsForDeadVisitSubjects(organizationId, deletedVisitIds, 'canceled')
    } catch (error) {
      logger.error('Failed to exit sequence runs for deleted recurring visits', {
        error,
        ruleId: rule.id,
      })
    }
  }

  // A work order created as one_off carries M1 `ensureVisit`'s single UNSCHEDULED placeholder
  // row (startTime null, no rule link). Once the engine owns scheduling it would linger in the
  // board's unscheduled rail forever — remove it. Scheduled standalone rows are real
  // appointments the user made and stay untouched.
  await database
    .delete(schema.WorkOrderVisit)
    .where(
      and(
        eq(schema.WorkOrderVisit.workOrderId, workOrderInstanceId),
        isNull(schema.WorkOrderVisit.recurrenceRuleId),
        isNull(schema.WorkOrderVisit.startTime),
        eq(schema.WorkOrderVisit.status, 'scheduled')
      )
    )

  // Convergence rule (04-ui §7): flip jobType → 'recurring' + status → 'active' via plain
  // FieldValueService — bypasses the `rejectManualEngagementStatus` pre-hook (the
  // `convertRequestToWorkOrder` precedent). Single batched call.
  const cf = await getOrgCache()
    .from(organizationId, 'customFields')
    .bySystemAttributes(['work_order_job_type', 'work_order_status'] as const)
  const recordId = toRecordId('work_order', workOrderInstanceId)
  const fieldValueService = new FieldValueService(organizationId, userId)
  const values: Array<{ fieldId: string; value: unknown }> = []

  if (cf.work_order_job_type) {
    const jobTypeTyped = await fieldValueService.getValue({
      recordId,
      fieldId: cf.work_order_job_type.id,
    })
    const jobTypeFirst = Array.isArray(jobTypeTyped) ? jobTypeTyped[0] : jobTypeTyped
    const jobType = jobTypeFirst ? extractValue(jobTypeFirst) : undefined
    if (jobType !== 'recurring') {
      values.push({ fieldId: cf.work_order_job_type.id, value: 'recurring' })
    }
  }
  if (cf.work_order_status) {
    const status = await getWorkOrderStatus(organizationId, userId, workOrderInstanceId)
    if (status !== 'active' && status !== 'paused' && status !== 'ended') {
      values.push({ fieldId: cf.work_order_status.id, value: 'active' })
    }
  }
  if (values.length > 0) {
    await fieldValueService.setValuesForEntity({ recordId, values })
  }

  await materializeVisits(rule, { userId, excludeSocketId })
  return rule
}
