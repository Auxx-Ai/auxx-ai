// packages/lib/src/dispatch/recurring/materialize.ts
//
// Rolling-window visit materializer (plans/dispatch/06-recurring-engine.md §4.4) — the
// dispatch-owned consumer of the pure `expandOccurrences` recurrence core. Turns a
// `RecurrenceRule` into concrete `WorkOrderVisit` rows out to the fixed horizon, then mirrors
// the work order + broadcasts ONCE (never per-row `afterVisitWrite`, and never a status
// roll-up — recurring engagement status is engagement-level, never visit-driven, §4.2/§4.1).
// Also owns the daily sweep (`sweepRecurringVisits`) that extends horizons and auto-ends
// exhausted engagements (§5.2/§5.3).

import { database, schema } from '@auxx/database'
import { extractValue } from '@auxx/types'
import { toRecordId } from '@auxx/types/resource'
import { format } from 'date-fns'
import { fromZonedTime, toZonedTime } from 'date-fns-tz'
import { and, count, eq, gte } from 'drizzle-orm'
import { getEntityDefIdResolver, getOrgCache } from '../../cache'
import { FieldValueService } from '../../field-values/field-value-service'
import {
  expandOccurrences,
  RECURRENCE_HORIZON_DAYS,
  type RecurrencePattern,
} from '../../recurrence'
import { publishVisitChanged } from '../broadcast'
import { mirrorVisitOntoWorkOrder } from '../mirror'

type RecurrenceRuleRow = typeof schema.RecurrenceRule.$inferSelect

/**
 * Local ISO date (`YYYY-MM-DD`) for "today" in `timezone` — the boundary/window anchor used
 * throughout the recurring engine (§4). Exported for reuse by the sibling rule-mutations /
 * engagement-actions modules so every boundary computation shares the same convention.
 */
export function todayLocalDate(timezone: string): string {
  return format(toZonedTime(new Date(), timezone), 'yyyy-MM-dd')
}

/** Local calendar date (`YYYY-MM-DD`, local midnight in `timezone`) as a UTC instant — the
 * same local-date/UTC-instant convention `recurrence/expand.ts` uses internally. */
function localDateStartUtc(dateIso: string, timezone: string): Date {
  const [year, month, day] = dateIso.split('-').map(Number)
  return fromZonedTime(new Date(year, month - 1, day), timezone)
}

/**
 * Resolve the acting `userId` for engine-triggered writes when no interactive user is
 * available (the daily sweep) — the org's cached system user (the `stripe-rail.ts`/
 * `public-token.ts` precedent).
 */
export async function systemActorUserId(organizationId: string): Promise<string> {
  return getOrgCache().get(organizationId, 'systemUser')
}

/**
 * Read `work_order_status` for a work order — unwraps the SINGLE_SELECT array-return
 * convention. Shared by the sweep's active-check and the exhaustion check.
 */
export async function getWorkOrderStatus(
  organizationId: string,
  userId: string,
  workOrderInstanceId: string
): Promise<string | undefined> {
  const cf = await getOrgCache()
    .from(organizationId, 'customFields')
    .bySystemAttributes(['work_order_status'] as const)
  if (!cf.work_order_status) return undefined

  const fieldValueService = new FieldValueService(organizationId, userId)
  const typed = await fieldValueService.getValue({
    recordId: toRecordId('work_order', workOrderInstanceId),
    fieldId: cf.work_order_status.id,
  })
  const first = Array.isArray(typed) ? typed[0] : typed
  return first ? (extractValue(first) as string) : undefined
}

/**
 * Materialize a `RecurrenceRule` into concrete `WorkOrderVisit` rows out to the rolling
 * horizon (§4.4). Window: `(max(today, rule.effectiveFrom), now + RECURRENCE_HORIZON_DAYS)`.
 * Idempotent: occurrence dates that already have ANY row for this rule (any status, detached
 * included) are skipped in memory before insert; `.onConflictDoNothing()` backstops the
 * partial unique index (`recurrenceRuleId`, `occurrenceDate`) against races — every row
 * inserted here always carries `recurrenceRuleId`, so a bare (untargeted) conflict clause
 * correctly resolves to that partial index (any unique violation on the row is swallowed).
 *
 * Mirrors the work order + broadcasts ONCE after the bulk insert — never per-row
 * `afterVisitWrite`, and never a status roll-up (§4.2: recurring engagement status is
 * engagement-level, never visit-mirrored).
 *
 * @param rule - The `RecurrenceRule` row to materialize.
 * @param opts - `userId` for the mirror write's attribution (defaults to the org system
 *   user — the sweep job has no interactive actor); `excludeSocketId` for realtime echo
 *   suppression when called from an interactive mutation.
 */
export async function materializeVisits(
  rule: RecurrenceRuleRow,
  opts: { userId?: string; excludeSocketId?: string } = {}
): Promise<void> {
  const todayIso = todayLocalDate(rule.timezone)
  const boundaryIso = todayIso > rule.effectiveFrom ? todayIso : rule.effectiveFrom
  const from = localDateStartUtc(boundaryIso, rule.timezone)
  const to = new Date(Date.now() + RECURRENCE_HORIZON_DAYS * 24 * 60 * 60 * 1000)

  const existingRows = await database
    .select({
      occurrenceDate: schema.WorkOrderVisit.occurrenceDate,
      latitude: schema.WorkOrderVisit.latitude,
      longitude: schema.WorkOrderVisit.longitude,
      geocodedAt: schema.WorkOrderVisit.geocodedAt,
    })
    .from(schema.WorkOrderVisit)
    .where(eq(schema.WorkOrderVisit.recurrenceRuleId, rule.id))
  const existingDates = new Set(
    existingRows.map((r) => r.occurrenceDate).filter((d): d is string => Boolean(d))
  )
  // Coord inheritance (route planner build contract item 9, plans/dispatch/09-route-planner.md
  // §B): a newly materialized visit copies latitude/longitude/geocodedAt from any already-
  // geocoded sibling visit of this same recurring series — never re-geocoded here, the
  // address-set-time hook (`geocodeOnAddressChange`) is the only geocoder writer.
  const geocodedSibling = existingRows.find((r) => r.latitude !== null && r.longitude !== null)
  // §4.4: consumed = existing rows (any status, detached included — a skip consumes its
  // occurrence), derived from rows, not a counter column. Only rows STRICTLY BEFORE the
  // expansion boundary count here — that's `expandOccurrences`' documented `countConsumed`
  // contract. Rows at/after the boundary are re-produced by the expansion itself (then
  // dropped by the `existingDates` filter), so they consume their slot inside the window's
  // count cap; counting them here too would double-charge the budget and starve the tail of
  // a count-ended series until its last pre-existing row passed.
  const countConsumed = existingRows.filter(
    (r) => r.occurrenceDate && r.occurrenceDate < boundaryIso
  ).length

  const pattern = rule.pattern as unknown as RecurrencePattern
  const occurrences = expandOccurrences(pattern, {
    anchor: rule.anchor,
    timezone: rule.timezone,
    from,
    to,
    startMinute: rule.startMinute ?? 0,
    countConsumed,
  })
  const toInsert = occurrences.filter((o) => !existingDates.has(o.occurrenceDate))

  if (toInsert.length > 0) {
    const durationMinutes = rule.durationMinutes ?? 60
    await database
      .insert(schema.WorkOrderVisit)
      .values(
        toInsert.map((o) => ({
          organizationId: rule.organizationId,
          workOrderId: rule.subjectId,
          recurrenceRuleId: rule.id,
          occurrenceDate: o.occurrenceDate,
          startTime: o.start,
          endTime: new Date(o.start.getTime() + durationMinutes * 60_000),
          assigneeUserId: rule.defaultAssigneeUserId,
          timezone: rule.timezone,
          status: 'scheduled',
          latitude: geocodedSibling?.latitude ?? null,
          longitude: geocodedSibling?.longitude ?? null,
          geocodedAt: geocodedSibling?.geocodedAt ?? null,
          updatedAt: new Date(),
        }))
      )
      .onConflictDoNothing()
  }

  await database
    .update(schema.RecurrenceRule)
    .set({ materializedUntil: to })
    .where(eq(schema.RecurrenceRule.id, rule.id))

  const userId = opts.userId ?? (await systemActorUserId(rule.organizationId))
  await mirrorVisitOntoWorkOrder(rule.organizationId, userId, rule.subjectId)
  await publishVisitChanged(
    rule.organizationId,
    { visitId: rule.id, workOrderId: rule.subjectId },
    { excludeSocketId: opts.excludeSocketId }
  )
}

/**
 * Auto-end an exhausted recurring engagement (§4.1/§4.4): exhausted = the pattern has an
 * `until`/`count` end condition AND that end is consumed (`until` before today, or `count`
 * reached by existing rows) AND no future `scheduled` visits remain. Writes
 * `work_order_status` → `ended` via plain `FieldValueService` (the sanctioned engine writer)
 * then mirrors + broadcasts.
 */
async function maybeEndExhaustedEngagement(rule: RecurrenceRuleRow): Promise<void> {
  const pattern = rule.pattern as unknown as RecurrencePattern
  if (pattern.until === undefined && pattern.count === undefined) return // never-ending

  const todayIso = todayLocalDate(rule.timezone)

  const untilExhausted = pattern.until !== undefined && pattern.until < todayIso
  let countExhausted = false
  if (pattern.count !== undefined) {
    const [row] = await database
      .select({ value: count() })
      .from(schema.WorkOrderVisit)
      .where(eq(schema.WorkOrderVisit.recurrenceRuleId, rule.id))
    countExhausted = (row?.value ?? 0) >= pattern.count
  }
  if (!untilExhausted && !countExhausted) return

  const [futureRow] = await database
    .select({ value: count() })
    .from(schema.WorkOrderVisit)
    .where(
      and(
        eq(schema.WorkOrderVisit.recurrenceRuleId, rule.id),
        eq(schema.WorkOrderVisit.status, 'scheduled'),
        gte(schema.WorkOrderVisit.occurrenceDate, todayIso)
      )
    )
  if ((futureRow?.value ?? 0) > 0) return

  const cf = await getOrgCache()
    .from(rule.organizationId, 'customFields')
    .bySystemAttributes(['work_order_status'] as const)
  if (!cf.work_order_status) return

  const userId = await systemActorUserId(rule.organizationId)
  // Resolve the type-slug to the real `entityDefinitionId` UUID before writing — an
  // unresolved `work_order:<id>` RecordId makes `setValuesForEntity`'s field-change hook
  // dispatch resolve to no cached resource (`getCachedResource` is an exact `id` match, no
  // type-slug fallback), so `entitySlug` comes back `''` and every field-change hook
  // (including MI2's on_completion `generateDraftOnCompletion`, which money MI2 build spec
  // §H documents as consuming exactly this auto-end write "for free") silently no-ops.
  // Mirrors `UnifiedCrudHandler.update`'s own recordId-resolution step
  // (unified-handler-mutations.ts:452).
  const resolveDefId = await getEntityDefIdResolver(rule.organizationId)
  const fieldValueService = new FieldValueService(rule.organizationId, userId)
  await fieldValueService.setValuesForEntity({
    recordId: toRecordId(resolveDefId('work_order'), rule.subjectId),
    values: [{ fieldId: cf.work_order_status.id, value: 'ended' }],
  })
  await mirrorVisitOntoWorkOrder(rule.organizationId, userId, rule.subjectId)
  await publishVisitChanged(rule.organizationId, { visitId: rule.id, workOrderId: rule.subjectId })
}

/**
 * Daily sweep (§4.4/§5.2/§5.3): for every `work_order_visits` recurrence rule whose engagement
 * is `active`, extends the materialization horizon when it's fallen behind, then checks for
 * exhaustion and auto-ends the engagement when its pattern has run its course. Per-rule loop —
 * fine at this cardinality (no per-org fan-out job needed).
 */
export async function sweepRecurringVisits(): Promise<void> {
  const rules = await database.query.RecurrenceRule.findMany({
    where: eq(schema.RecurrenceRule.subjectType, 'work_order_visits'),
  })

  const horizonThreshold = new Date(Date.now() + RECURRENCE_HORIZON_DAYS * 24 * 60 * 60 * 1000)

  for (const rule of rules) {
    const userId = await systemActorUserId(rule.organizationId)
    const status = await getWorkOrderStatus(rule.organizationId, userId, rule.subjectId)
    if (status !== 'active') continue

    const needsMaterialize = !rule.materializedUntil || rule.materializedUntil < horizonThreshold
    if (needsMaterialize) {
      await materializeVisits(rule, { userId })
    }

    await maybeEndExhaustedEngagement(rule)
  }
}
