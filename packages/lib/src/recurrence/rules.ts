// packages/lib/src/recurrence/rules.ts

/**
 * Every read and write of the `RecurrenceRule` table (`docs/lib-module-guide.md` §8).
 *
 * The table is shared: `work_order_visits` (dispatch), `invoice_drafts` (sales billing)
 * and `recurring_journals` (accounting) are three subject types on one row shape, so the
 * owner sits here rather than under any one of them. Nothing in this file knows what a
 * subject type means.
 *
 * No permission checks. The router asserts (`docs/lib-module-guide.md` §6).
 */

import { type Database, schema, type Transaction } from '@auxx/database'
import { and, eq, inArray, isNull, lt, or } from 'drizzle-orm'
import { UnprocessableEntityError } from '../errors'
import type { RecurrencePattern } from './types'

/** A `RecurrenceRule` row, as drizzle returns it. */
export type RecurrenceRuleRow = typeof schema.RecurrenceRule.$inferSelect

type Db = Database | Transaction

/** The table's unique key: one rule per `(subjectType, subjectId)`. */
export interface RecurrenceSubject {
  subjectType: string
  subjectId: string
}

/**
 * `RecurrenceRule.pattern` is `Record<string, unknown>` on the table — `@auxx/database`
 * sits below `lib` and may not import {@link RecurrencePattern} — so the cast lives here.
 */
function toColumn(pattern: RecurrencePattern): Record<string, unknown> {
  return pattern as unknown as Record<string, unknown>
}

/**
 * The rule scheduling one subject, or `null`.
 *
 * Scoped by `subjectType` as well as `subjectId`: the unique index is
 * `(subjectType, subjectId)`, so one `EntityInstance` id can carry a rule under a second
 * subject type, and reading it by id alone would hand a work order's visit schedule to the
 * accounting screen.
 */
export async function getRecurrenceRule(
  db: Db,
  organizationId: string,
  subject: RecurrenceSubject
): Promise<RecurrenceRuleRow | null> {
  const [rule] = await db
    .select()
    .from(schema.RecurrenceRule)
    .where(
      and(
        eq(schema.RecurrenceRule.organizationId, organizationId),
        eq(schema.RecurrenceRule.subjectType, subject.subjectType),
        eq(schema.RecurrenceRule.subjectId, subject.subjectId)
      )
    )
    .limit(1)
  return rule ?? null
}

/** One rule by its own id, for callers holding a `recurrenceRuleId` off a generated row. */
export async function getRecurrenceRuleById(
  db: Db,
  organizationId: string,
  ruleId: string
): Promise<RecurrenceRuleRow | null> {
  const [rule] = await db
    .select()
    .from(schema.RecurrenceRule)
    .where(
      and(
        eq(schema.RecurrenceRule.id, ruleId),
        eq(schema.RecurrenceRule.organizationId, organizationId)
      )
    )
    .limit(1)
  return rule ?? null
}

/** The rules for these subjects, keyed by `subjectId`; subjects with no rule are absent. */
export async function listRecurrenceRules(
  db: Db,
  organizationId: string,
  params: { subjectType: string; subjectIds: string[] }
): Promise<Map<string, RecurrenceRuleRow>> {
  if (params.subjectIds.length === 0) return new Map()
  const rules = await db
    .select()
    .from(schema.RecurrenceRule)
    .where(
      and(
        eq(schema.RecurrenceRule.organizationId, organizationId),
        eq(schema.RecurrenceRule.subjectType, params.subjectType),
        inArray(schema.RecurrenceRule.subjectId, params.subjectIds)
      )
    )
  return new Map(rules.map((rule) => [rule.subjectId, rule]))
}

export interface UpsertRecurrenceRuleInput extends RecurrenceSubject {
  pattern: RecurrencePattern
  timezone: string
  /**
   * Series start, `YYYY-MM-DD`. Written on INSERT only — the column is the immutable
   * expansion origin, so an edit moves `effectiveFrom` and leaves this alone. Each lane
   * means something different by it (a journal template keeps the caller's date, an
   * invoice schedule starts today), which is why it is a parameter and not derived.
   * A new rule is effective from its anchor; all three lanes agree on that.
   */
  anchor: string
  /** The edit anchor, written on UPDATE only: occurrences on/after it follow the new pattern. */
  effectiveFrom: string
  startMinute?: number | null
  durationMinutes?: number | null
  defaultAssigneeWorkerId?: string | null
}

/**
 * Attach or replace the rule on a subject, returning the row and the one it replaced.
 *
 * `materializedUntil` survives an edit: the occurrences it names have already been
 * generated, and re-opening them would raise a second row per occurrence.
 */
export async function upsertRecurrenceRule(
  db: Db,
  organizationId: string,
  input: UpsertRecurrenceRuleInput
): Promise<{ rule: RecurrenceRuleRow; previous: RecurrenceRuleRow | null }> {
  const previous = await getRecurrenceRule(db, organizationId, input)
  const startMinute = input.startMinute ?? null
  const durationMinutes = input.durationMinutes ?? null
  const defaultAssigneeWorkerId = input.defaultAssigneeWorkerId ?? null

  const [rule] = previous
    ? await db
        .update(schema.RecurrenceRule)
        .set({
          pattern: toColumn(input.pattern),
          timezone: input.timezone,
          effectiveFrom: input.effectiveFrom,
          startMinute,
          durationMinutes,
          defaultAssigneeWorkerId,
        })
        .where(eq(schema.RecurrenceRule.id, previous.id))
        .returning()
    : await db
        .insert(schema.RecurrenceRule)
        .values({
          organizationId,
          subjectType: input.subjectType,
          subjectId: input.subjectId,
          pattern: toColumn(input.pattern),
          timezone: input.timezone,
          anchor: input.anchor,
          effectiveFrom: input.anchor,
          startMinute,
          durationMinutes,
          defaultAssigneeWorkerId,
        })
        .returning()

  if (!rule) throw new UnprocessableEntityError('Failed to save the recurrence rule')
  return { rule, previous }
}

/** Replace a rule's pattern, leaving its cursor and anchor alone. `null` when it is gone. */
export async function updateRecurrencePattern(
  db: Db,
  organizationId: string,
  ruleId: string,
  pattern: RecurrencePattern
): Promise<RecurrenceRuleRow | null> {
  const [updated] = await db
    .update(schema.RecurrenceRule)
    .set({ pattern: toColumn(pattern) })
    .where(
      and(
        eq(schema.RecurrenceRule.id, ruleId),
        eq(schema.RecurrenceRule.organizationId, organizationId)
      )
    )
    .returning()
  return updated ?? null
}

/**
 * The sweep predicate, deliberately CROSS-ORG: all three sweeps are one daily job over
 * every tenant, so there is no `organizationId` argument to pass.
 *
 * Omit `now` to get every rule of the subject type: the visit sweep checks exhaustion on
 * rules whose cursor is already ahead, so a cursor filter would skip the engagements it
 * exists to end.
 */
export async function listDueRecurrenceRules(
  db: Db,
  params: { subjectType: string; now?: Date; limit?: number }
): Promise<RecurrenceRuleRow[]> {
  const behindCursor = params.now
    ? or(
        isNull(schema.RecurrenceRule.materializedUntil),
        lt(schema.RecurrenceRule.materializedUntil, params.now)
      )
    : undefined
  const query = db
    .select()
    .from(schema.RecurrenceRule)
    .where(and(eq(schema.RecurrenceRule.subjectType, params.subjectType), behindCursor))
  return params.limit ? query.limit(params.limit) : query
}

/** The single writer of `materializedUntil` — the materializer's horizon high-water mark. */
export async function advanceRecurrenceCursor(
  db: Db,
  organizationId: string,
  ruleId: string,
  materializedUntil: Date
): Promise<void> {
  await db
    .update(schema.RecurrenceRule)
    .set({ materializedUntil })
    .where(
      and(
        eq(schema.RecurrenceRule.id, ruleId),
        eq(schema.RecurrenceRule.organizationId, organizationId)
      )
    )
}

/**
 * Drop a subject's rule. Deletes the RULE and nothing else — rows it already generated are
 * what happened; the rule was only the configuration. Deleting a subject with no rule is
 * not an error.
 */
export async function deleteRecurrenceRule(
  db: Db,
  organizationId: string,
  subject: RecurrenceSubject
): Promise<void> {
  await db
    .delete(schema.RecurrenceRule)
    .where(
      and(
        eq(schema.RecurrenceRule.organizationId, organizationId),
        eq(schema.RecurrenceRule.subjectType, subject.subjectType),
        eq(schema.RecurrenceRule.subjectId, subject.subjectId)
      )
    )
}
