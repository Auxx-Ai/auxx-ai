// packages/lib/src/accounting/journals/recurring/reads.ts

/**
 * Every READ over a recurring journal template: its schedule, the entries it
 * has already generated, and what it currently owes.
 *
 * Reads only. The writes live in `writes.ts` and the generation loop in
 * `materialize.ts` (`docs/lib-module-guide.md` §5).
 *
 * No permission checks anywhere in this file. The router asserts
 * (`docs/lib-module-guide.md` §6).
 */

import { type Database, schema } from '@auxx/database'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import type { Result } from 'neverthrow'
import {
  listRecurrenceRules,
  type RecurrencePattern,
  type RecurrenceRuleRow,
} from '../../../recurrence'
import { systemValueJoin } from '../../../resources/system-records'
import { resolvePeriodLock } from '../../ledger/periods/period-lock'
import type { PeriodLock } from '../../ledger/periods/periods'
import type { JournalEntryRecord } from '../entries/client'
import { loadRecurrenceIdentityContext } from '../entries/fields'
import { listJournalEntries } from '../entries/reads'
import {
  planRecurringOccurrences,
  RECURRING_JOURNAL_SUBJECT_TYPE,
  type RecurringJournalPlan,
} from './client'
import { guard } from './guard'

/** One template, its schedule, and what it currently owes. */
export interface RecurringJournalTemplate {
  /** The `journal_entry` record with `kind: 'recurring_template'`. */
  template: JournalEntryRecord
  /** `null` until somebody gives the template a schedule. */
  rule: RecurrenceRuleRow | null
  /**
   * What the next sweep would do, computed against the SAME pure planner the
   * sweep runs - so the screen cannot disagree with the job about which month
   * is held. `null` when there is no rule.
   */
  plan: RecurringJournalPlan | null
}

/**
 * Every template in the org, with its schedule and what it owes.
 *
 * One query for the templates, one for their rules, one lock read - never a
 * rule query per template. The plan is computed in memory from the pure
 * planner, so this costs no more than the list itself.
 */
export async function listRecurringJournalTemplates(
  db: Database,
  organizationId: string,
  options: { now?: Date } = {}
): Promise<Result<RecurringJournalTemplate[], Error>> {
  return guard(
    async () => {
      const listed = await listJournalEntries(db, organizationId, {
        kinds: ['recurring_template'],
        limit: 200,
      })
      if (listed.isErr()) throw listed.error
      const templates = listed.value
      if (templates.length === 0) return []

      const ruleBySubject = await listRecurrenceRules(db, organizationId, {
        subjectType: RECURRING_JOURNAL_SUBJECT_TYPE,
        subjectIds: templates.map((entry) => entry.id),
      })

      // One lock read for the whole list. It fails CLOSED on a malformed
      // setting (`period-lock.ts`), which is right here too: a screen that
      // silently reported "nothing held" over an unreadable lock would be
      // telling a bookkeeper the opposite of the truth.
      const lock = await resolvePeriodLock(organizationId)
      const now = options.now ?? new Date()

      return templates.map((template) => {
        const rule = ruleBySubject.get(template.id) ?? null
        return { template, rule, plan: rule ? planForRule(rule, lock, now) : null }
      })
    },
    'Failed to list recurring journal templates',
    { organizationId }
  )
}

/**
 * {@link planRecurringOccurrences} over a stored rule row.
 *
 * The one place the `jsonb` pattern is read back as a `RecurrencePattern`.
 * `RecurrenceRule.pattern` is typed `Record<string, unknown>` on the table
 * (the `database` package sits below `lib` and may not import the real type),
 * so the cast lives here rather than at four call sites.
 */
export function planForRule(
  rule: RecurrenceRuleRow,
  lock: PeriodLock,
  now: Date
): RecurringJournalPlan {
  return planRecurringOccurrences({
    pattern: rule.pattern as unknown as RecurrencePattern,
    anchor: rule.anchor,
    timezone: rule.timezone,
    materializedUntil: rule.materializedUntil,
    now,
    lock,
  })
}

/**
 * Which of `occurrenceDates` this rule has ALREADY generated an entry for.
 *
 * 🛑 This is idempotency layer 1 and it RACES, by construction. `FieldValue`
 * carries exactly one unique index and it is `(entityId, fieldId, sortKey)`
 * (§0.10), so there is no `(ruleId, occurrenceDate)` tuple for the database to
 * refuse a second write on - unlike `WorkOrderVisit` and
 * `InvoiceScheduleAllocation`, which both land on a real partial unique index.
 * Two sweeps running at once can therefore both read "no entry" and both write
 * one.
 *
 * That is tolerable only because layer 2 is exact: both drafts mint the same
 * `RJE-<fold>` period key, so the second to POST loses the claim index and
 * converges to `already_posted`. The worst case is a duplicate DRAFT - visible
 * and discardable - never a duplicate posting.
 *
 * Returns entry ids keyed by occurrence date, including entries that have
 * since been posted: a posted occurrence is emphatically still generated.
 * Archived (discarded) entries are excluded, so discarding a generated draft
 * lets the next sweep raise it again - which is what "throw this one away and
 * let it regenerate" has to mean.
 */
export async function findGeneratedEntryIds(
  db: Database,
  organizationId: string,
  params: { recurrenceRuleId: string; occurrenceDates: string[] }
): Promise<Map<string, string>> {
  const found = new Map<string, string>()
  if (params.occurrenceDates.length === 0) return found

  const ctx = await loadRecurrenceIdentityContext(db, organizationId)
  if (!ctx) return found
  const ruleField = ctx.fields.journal_entry_recurrence_rule_id
  const slotField = ctx.fields.journal_entry_occurrence_date
  if (!ruleField || !slotField) return found

  // Two aliases, because both sides are rows of the same table and drizzle
  // would otherwise emit `FieldValue` twice under one name. Each alias matches
  // at most one row - both fields are single-value TEXT - so the join does not
  // multiply the result.
  const ruleValue = alias(schema.FieldValue, 'je_rule_v')
  const slotValue = alias(schema.FieldValue, 'je_slot_v')

  const rows = await db
    .select({
      entityId: schema.EntityInstance.id,
      occurrenceDate: slotValue.valueText,
    })
    .from(schema.EntityInstance)
    .innerJoin(
      ruleValue,
      and(
        systemValueJoin(ruleValue, ruleField.id),
        eq(ruleValue.valueText, params.recurrenceRuleId)
      )
    )
    .innerJoin(
      slotValue,
      and(
        systemValueJoin(slotValue, slotField.id),
        inArray(slotValue.valueText, params.occurrenceDates)
      )
    )
    .where(
      and(
        eq(schema.EntityInstance.organizationId, organizationId),
        eq(schema.EntityInstance.entityDefinitionId, ctx.defId),
        isNull(schema.EntityInstance.archivedAt)
      )
    )

  for (const row of rows) {
    if (row.occurrenceDate) found.set(row.occurrenceDate, row.entityId)
  }
  return found
}
