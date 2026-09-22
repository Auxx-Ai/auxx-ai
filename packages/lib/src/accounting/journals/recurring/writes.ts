// packages/lib/src/accounting/journals/recurring/writes.ts

/**
 * Giving a journal template a schedule, and taking it away.
 *
 * Writes only; the reads are in `reads.ts` and the generation loop in
 * `materialize.ts` (`docs/lib-module-guide.md` §5).
 *
 * No permission checks. The router asserts `ledgerControl`
 * (`docs/lib-module-guide.md` §6) - a schedule decides what lands in the books
 * every month without anybody pressing anything, which is the same authority
 * closing a period takes.
 */

import type { Database } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import type { Result } from 'neverthrow'
import { ConflictError, UnprocessableEntityError } from '../../../errors'
import {
  deleteRecurrenceRule,
  type RecurrencePattern,
  type RecurrenceRuleRow,
  recurrencePatternSchema,
  upsertRecurrenceRule,
} from '../../../recurrence'
import { readBookTimeZone } from '../../ledger/setup/book-time-zone'
import { requireJournalEntry } from '../entries/reads'
import { RECURRING_JOURNAL_SUBJECT_TYPE } from './client'
import { guard } from './guard'

const logger = createScopedLogger('postings:recurring-journals')

export interface SetRecurringJournalScheduleInput {
  /** The `journal_entry` record with `kind: 'recurring_template'`. */
  templateId: string
  pattern: RecurrencePattern
  /**
   * Series start, `YYYY-MM-DD`. Optional: it defaults to the template's own
   * accounting date, which is what a person just typed into the drawer and
   * therefore what they mean by "starting when".
   */
  anchor?: string
}

/**
 * Attach or replace the schedule on a template.
 *
 * Upsert on `(subjectType, subjectId)` - the table's unique index - so a
 * template has one schedule and re-saving the editor replaces it rather than
 * accumulating rules.
 *
 * ## What is NOT reset on an edit
 *
 * 🛑 `materializedUntil` survives. An edit to the pattern must not re-open
 * months the template has already generated entries for: those entries exist,
 * most of them are posted, and regenerating them would raise a second entry
 * per occurrence whose only defence is the claim index. `effectiveFrom` moves
 * to today instead, which is the three-way-edit anchor the recurring engine
 * already defines - occurrences on or after it follow the new pattern.
 *
 * ## Why the timezone is not an argument
 *
 * The accounting month boundary is a wall-clock midnight in
 * `accounting.bookTimeZone`, and a rule carrying a browser-detected zone would
 * make two authorities out of one question: a December 31 entry would land in
 * January for a template saved from a laptop one zone east. The column is
 * `NOT NULL`, so the org's book time zone is what goes in it, and nothing in
 * this module ever reads a zone from anywhere else (task 21 §1.3).
 */
export async function setRecurringJournalSchedule(
  db: Database,
  organizationId: string,
  input: SetRecurringJournalScheduleInput
): Promise<Result<RecurrenceRuleRow, Error>> {
  return guard(
    async () => {
      const template = await requireJournalEntry(db, organizationId, input.templateId)
      if (template.kind !== 'recurring_template') {
        throw new ConflictError(
          `Journal entry ${template.number ?? template.id} is a ${template.kind} entry, not a ` +
            'recurring template. Only a template carries a schedule - an ordinary entry posts ' +
            'once, on the date it names.',
          { journalEntryId: template.id, kind: template.kind }
        )
      }

      // Parsed rather than trusted: the pattern is `jsonb`, so nothing in the
      // database enforces the cross-field rules (weekly needs weekdays;
      // monthly needs exactly one of monthDay/nthWeekday). A malformed pattern
      // stored here expands to nothing, silently, for as long as nobody looks.
      const parsed = recurrencePatternSchema.safeParse(input.pattern)
      if (!parsed.success) {
        throw new UnprocessableEntityError(
          `That repeat rule is not usable: ${parsed.error.issues.map((i) => i.message).join('; ')}`,
          { journalEntryId: template.id }
        )
      }

      const anchor = input.anchor ?? template.date
      if (!anchor) {
        throw new UnprocessableEntityError(
          'A recurring template needs a date to start repeating from. Give the template an ' +
            'accounting date first.',
          { journalEntryId: template.id }
        )
      }
      assertLocalDate(anchor)

      const timezone = await readBookTimeZone(organizationId)

      const { rule, previous } = await upsertRecurrenceRule(db, organizationId, {
        subjectType: RECURRING_JOURNAL_SUBJECT_TYPE,
        subjectId: template.id,
        pattern: parsed.data,
        timezone,
        anchor,
        effectiveFrom: todayInZone(timezone),
      })

      logger.info('Saved recurring journal schedule', {
        organizationId,
        journalEntryId: template.id,
        ruleId: rule.id,
        frequency: parsed.data.frequency,
        interval: parsed.data.interval,
        replaced: Boolean(previous),
      })

      return rule
    },
    'Failed to set recurring journal schedule',
    { organizationId, templateId: input.templateId }
  )
}

/**
 * Stop a template repeating.
 *
 * 🛑 Deletes the RULE and nothing else. Entries the template has already
 * generated stay exactly where they are, posted or not: a schedule is
 * declarative configuration and the entries are what actually happened. The
 * same call is also what "delete this template" has to do first, because
 * `RecurrenceRule.subjectId` cascades from `EntityInstance` and a template
 * archived with a live rule would leave a rule the sweep still reads.
 *
 * A template with no rule is not an error - clearing twice is the same
 * outcome, which is what a person pressing the button twice means.
 */
export async function clearRecurringJournalSchedule(
  db: Database,
  organizationId: string,
  templateId: string
): Promise<Result<void, Error>> {
  return guard(
    async () => {
      await deleteRecurrenceRule(db, organizationId, {
        subjectType: RECURRING_JOURNAL_SUBJECT_TYPE,
        subjectId: templateId,
      })
      logger.info('Cleared recurring journal schedule', { organizationId, templateId })
    },
    'Failed to clear recurring journal schedule',
    { organizationId, templateId }
  )
}

/** `YYYY-MM-DD` in `timeZone`, via the one locale whose short date IS that format. */
function todayInZone(timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}

function assertLocalDate(value: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new UnprocessableEntityError(
      `A recurring schedule starts on a YYYY-MM-DD date, got '${value}'`,
      { anchor: value }
    )
  }
}
