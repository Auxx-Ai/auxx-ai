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
import { addDays, format } from 'date-fns'
import { fromZonedTime, toZonedTime } from 'date-fns-tz'
import { and, asc, eq, gte, inArray, isNotNull, isNull } from 'drizzle-orm'
import { getOrgCache } from '../../cache'
import { FieldValueService } from '../../field-values/field-value-service'
import { expandOccurrences, type RecurrencePattern } from '../../recurrence'
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

/** Splits a local ISO date (`YYYY-MM-DD`) into its numeric parts. `Number()` (not a typed
 * tuple destructure) sidesteps `noUncheckedIndexedAccess` on the split array — callers only
 * ever pass well-formed `occurrenceDate`/ISO-date strings. */
function splitLocalDate(dateIso: string): [number, number, number] {
  const parts = dateIso.split('-')
  return [Number(parts[0]), Number(parts[1]), Number(parts[2])]
}

/** Local calendar date (`YYYY-MM-DD`, local midnight in `timezone`) as a UTC instant — same
 * convention as `materialize.ts`'s private helper of the same name (not exported there). */
function localDateStartUtc(dateIso: string, timezone: string): Date {
  const [year, month, day] = splitLocalDate(dateIso)
  return fromZonedTime(new Date(year, month - 1, day), timezone)
}

/** UTC instant → local calendar date (`YYYY-MM-DD`) in `timezone`. */
function localDateIso(date: Date, timezone: string): string {
  return format(toZonedTime(date, timezone), 'yyyy-MM-dd')
}

/** UTC instant → wall-clock minutes since local midnight in `timezone`. */
function localMinutesOfDay(date: Date, timezone: string): number {
  const zoned = toZonedTime(date, timezone)
  return zoned.getHours() * 60 + zoned.getMinutes()
}

/** The local calendar date one day after `dateIso`. */
function nextLocalDateIso(dateIso: string): string {
  const [year, month, day] = splitLocalDate(dateIso)
  return format(addDays(new Date(year, month - 1, day), 1), 'yyyy-MM-dd')
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
 *
 * On **create** only (plan 30 §E.1, fixes #29 §4.4): adopts any standalone `scheduled` visits
 * already on this work order into the new rule as their first occurrence (stamps
 * `recurrenceRuleId`/`occurrenceDate`, detaching when the row's actual time doesn't match the
 * template slot for that date) so the materializer below doesn't mint a duplicate for the same
 * date. Rule **edits** never adopt — a standalone row added after the rule exists is a
 * deliberate "extra" visit (§1 Adoption boundary).
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
  // appointments the user made and stay untouched. CREATE only (plan 30 §F.1): the M1
  // placeholder can only exist at first-rule-creation time — this predicate (`recurrenceRuleId`
  // null, `startTime` null, `status: 'scheduled'`) is otherwise indistinguishable from a
  // deliberate `addVisit` "extra" row, which must survive every later regeneration, not be
  // re-swept by this cleanup on every edit.
  if (!existing) {
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
  }

  // Adoption (§E.1, #29 §4.4): CREATE only — a standalone `scheduled` visit the user booked
  // before adding a Repeat rule becomes the rule's first occurrence for its date instead of
  // being duplicated by `materializeVisits` below (which only sees rows already linked to
  // `rule.id`). Rule edits skip this: a standalone row on an existing recurring WO is a
  // deliberate "extra" visit (§1 Adoption boundary), never adopted.
  if (!existing) {
    const standaloneVisits = await database
      .select({
        id: schema.WorkOrderVisit.id,
        startTime: schema.WorkOrderVisit.startTime,
        createdAt: schema.WorkOrderVisit.createdAt,
      })
      .from(schema.WorkOrderVisit)
      .where(
        and(
          eq(schema.WorkOrderVisit.organizationId, organizationId),
          eq(schema.WorkOrderVisit.workOrderId, workOrderInstanceId),
          isNull(schema.WorkOrderVisit.recurrenceRuleId),
          eq(schema.WorkOrderVisit.status, 'scheduled'),
          isNotNull(schema.WorkOrderVisit.startTime)
        )
      )
      .orderBy(asc(schema.WorkOrderVisit.createdAt))

    // Tie-break (§1 rec): two standalone rows on the same local date — the earlier `createdAt`
    // (rows are already ordered ascending, so the first one seen per date wins) gets adopted;
    // the loser stays rule-less as a deliberate "extra" visit, never deleted.
    const adoptionByLocalDate = new Map<string, { id: string; startTime: Date }>()
    for (const visit of standaloneVisits) {
      if (!visit.startTime) continue
      const dateIso = localDateIso(visit.startTime, timezone)
      if (!adoptionByLocalDate.has(dateIso)) {
        adoptionByLocalDate.set(dateIso, { id: visit.id, startTime: visit.startTime })
      }
    }

    const pattern = rule.pattern as unknown as RecurrencePattern
    for (const [occurrenceDate, visit] of adoptionByLocalDate) {
      // isDetached iff the adopted row is NOT exactly what the pattern+template would have
      // generated for this date — a non-detached row on a non-pattern date would silently
      // vanish on a later template-only regeneration and never be re-created (§E.1 rationale).
      const dayStart = localDateStartUtc(occurrenceDate, timezone)
      const dayEnd = localDateStartUtc(nextLocalDateIso(occurrenceDate), timezone)
      const dayOccurrences = expandOccurrences(pattern, {
        anchor: rule.anchor,
        timezone,
        from: dayStart,
        to: dayEnd,
        startMinute: rule.startMinute ?? 0,
      })
      const isPatternDate = dayOccurrences.some((o) => o.occurrenceDate === occurrenceDate)
      const isTemplateSlot = localMinutesOfDay(visit.startTime, timezone) === rule.startMinute
      const isDetached = !(isPatternDate && isTemplateSlot)

      // Defensive against the partial unique index (`recurrenceRuleId`, `occurrenceDate`): the
      // per-date dedup above already guarantees at most one candidate per date for THIS batch,
      // and `rule.id` is brand new on create so nothing else can hold that date yet — this
      // check only guards a theoretical race, not an expected collision.
      const [dateTaken] = await database
        .select({ id: schema.WorkOrderVisit.id })
        .from(schema.WorkOrderVisit)
        .where(
          and(
            eq(schema.WorkOrderVisit.recurrenceRuleId, rule.id),
            eq(schema.WorkOrderVisit.occurrenceDate, occurrenceDate)
          )
        )
        .limit(1)
      if (dateTaken) continue

      await database
        .update(schema.WorkOrderVisit)
        .set({ recurrenceRuleId: rule.id, occurrenceDate, isDetached })
        .where(eq(schema.WorkOrderVisit.id, visit.id))
    }
  }

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
