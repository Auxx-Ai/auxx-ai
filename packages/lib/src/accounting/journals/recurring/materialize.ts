// packages/lib/src/accounting/journals/recurring/materialize.ts

/**
 * Copy one template into the entries it owes, and move the cursor exactly as
 * far as that got.
 *
 * ## The two rules this whole file exists to hold
 *
 * 1. 🛑 **The window is BACKWARD.** `(materializedUntil ?? anchor) -> now`,
 *    never `now + horizon`. `materializedUntil` means opposite things in the
 *    two existing consumers of `RecurrenceRule` and the column comment
 *    documents only the forward one: the visit materializer sets it to
 *    `now + 56 days` and pre-creates rows, while the invoice-draft scheduler
 *    treats it as a high-water mark behind now. A journal template wants the
 *    invoice reading, and the reason is not a preference: an entry is a claim
 *    about a period that has HAPPENED. Taking the visit reading would put
 *    March's depreciation in the books in January, where it would be picked up
 *    by January's trial balance and by anything a bookkeeper filed from it.
 *
 * 2. 🛑 **The cursor never advances past an occurrence that did not land.**
 *    `auto-invoice.ts:513-522` advances `materializedUntil` to `now` WITHOUT
 *    generating when its pause gate trips - correct there, because advancing
 *    while paused IS its no-backfill mechanic. Here it would be the worst kind
 *    of bug: an occurrence that failed to post is an entry still OWED, not one
 *    skipped, and moving the cursor past it loses the occurrence permanently
 *    with no error anywhere. So the cursor lands on the failed occurrence's own
 *    instant and the next sweep tries it again.
 *
 * The window is computed by `planRecurringOccurrences`, which is
 * pure and lives in `client.ts` so the templates screen renders the same
 * answer this job will act on.
 *
 * No permission checks. This runs as the org's system user, from a sweep.
 */

import type { Database } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import type { Result } from 'neverthrow'
import { getOrgCache } from '../../../cache'
import { advanceRecurrenceCursor, type RecurrenceRuleRow } from '../../../recurrence'
import { didLedgerAccept } from '../../ledger/post/ledger-accepted'
import { requireJournalEntry } from '../entries/reads'
import { createJournalEntry, postJournalEntry } from '../entries/writes'
import { guard } from './guard'
import { findGeneratedEntryIds, planForRule } from './reads'

const logger = createScopedLogger('postings:recurring-journals')

/** What one pass over one template did, and what stopped it. */
export interface MaterializeRecurringJournalsResult {
  ruleId: string
  organizationId: string
  /** The template this rule schedules. */
  templateId: string
  /** Entry ids raised on this pass. */
  generated: string[]
  /** Entry ids the ledger accepted on this pass, including a left-over one a previous pass raised. */
  posted: string[]
  /** Occurrences a previous pass had already raised and posted. */
  alreadyPresent: number
  /** Where the cursor was left. */
  cursor: Date
}

/**
 * Generate and POST every entry this template owes, oldest first, stopping at
 * the first occurrence that did not land. Posted directly (91 D5, reversing
 * 21-A): review is the outbox, before anything leaves. The `RJE-<fold>` key and
 * the rule's occurrence claim make a raced duplicate converge to `already_posted`.
 * An occurrence raised but not accepted (a bad line, a refusal) stays an unposted
 * entry; the next pass posts that one rather than raising another.
 *
 * ## Stopping at the first failure, not skipping it
 *
 * A throw from one occurrence stops the pass at that occurrence rather than
 * logging and carrying on. That is the opposite of `auto-invoice.ts`'s choice
 * and it is deliberate: an invoice draft the sweep failed to raise is a
 * customer who gets billed next month, while a journal entry the sweep failed
 * to raise is a hole in a ledger that still balances. Occurrences are
 * generated in date order, so stopping keeps the series contiguous - the
 * alternative would leave April in the books and March missing.
 *
 * One stuck rule cannot stall any other: `sweepRecurringJournals` isolates
 * every rule in its own try/catch.
 */
export async function materializeRecurringJournals(
  db: Database,
  rule: RecurrenceRuleRow,
  options: { now?: Date } = {}
): Promise<Result<MaterializeRecurringJournalsResult, Error>> {
  return guard(
    async () => {
      const { organizationId, subjectId: templateId } = rule
      const now = options.now ?? new Date()

      const plan = planForRule(rule, now)

      const outcome: MaterializeRecurringJournalsResult = {
        ruleId: rule.id,
        organizationId,
        templateId,
        generated: [],
        posted: [],
        alreadyPresent: 0,
        cursor: plan.cursor,
      }

      if (plan.due.length === 0) {
        await advanceRecurrenceCursor(db, organizationId, rule.id, plan.cursor)
        return outcome
      }

      // The stencil, read ONCE. Its lines are what every occurrence copies, so
      // a re-read per occurrence would let a mid-sweep edit produce two months
      // with different lines and no record of which was which.
      const template = await requireJournalEntry(db, organizationId, templateId)
      if (template.kind !== 'recurring_template') {
        // A rule whose subject stopped being a template. Not a crash and not a
        // silent skip: the cursor holds where it is, so nothing is lost, and
        // the log names the row.
        logger.warn('A recurring journal rule points at something that is not a template', {
          organizationId,
          ruleId: rule.id,
          templateId,
          kind: template.kind,
        })
        return outcome
      }

      const existing = await findGeneratedEntryIds(db, organizationId, {
        recurrenceRuleId: rule.id,
        occurrenceDates: plan.due.map((occurrence) => occurrence.occurrenceDate),
      })

      const userId = await getOrgCache().get(organizationId, 'systemUser')
      let cursor = plan.cursor

      for (const occurrence of plan.due) {
        try {
          let entryId = existing.get(occurrence.occurrenceDate)
          if (entryId) {
            const standing = await requireJournalEntry(db, organizationId, entryId)
            if (standing.status !== 'draft') {
              outcome.alreadyPresent++
              continue
            }
          } else {
            const created = await createJournalEntry(db, organizationId, userId, {
              kind: 'recurring',
              // The slot is the accounting date; `occurrenceDate` never moves - it is half the key.
              date: occurrence.occurrenceDate,
              memo: template.memo ?? undefined,
              lines: template.lines.map(({ id: _id, ...line }) => line),
              recurrenceRuleId: rule.id,
              occurrenceDate: occurrence.occurrenceDate,
            })
            if (created.isErr()) throw created.error
            entryId = created.value.id
            outcome.generated.push(entryId)
          }

          const posted = await postJournalEntry(db, organizationId, userId, {
            journalEntryId: entryId,
          })
          if (posted.isErr()) throw posted.error
          if (!didLedgerAccept(posted.value)) {
            throw new Error(
              `The ledger did not accept the entry (${posted.value.status})` +
                `${posted.value.error ? `: ${posted.value.error}` : ''}`
            )
          }
          outcome.posted.push(entryId)
        } catch (error) {
          // Hold the cursor AT this occurrence - see the file header. The next
          // sweep starts here and tries again.
          cursor = occurrence.start
          outcome.cursor = cursor
          logger.error('Failed to post a recurring journal entry; holding the cursor', {
            organizationId,
            ruleId: rule.id,
            templateId,
            occurrenceDate: occurrence.occurrenceDate,
            error: error instanceof Error ? error.message : String(error),
          })
          await advanceRecurrenceCursor(db, organizationId, rule.id, cursor)
          return outcome
        }
      }

      await advanceRecurrenceCursor(db, organizationId, rule.id, cursor)

      if (outcome.posted.length > 0) {
        logger.info('Materialized recurring journal entries', {
          organizationId,
          ruleId: rule.id,
          templateId,
          generated: outcome.generated.length,
          posted: outcome.posted.length,
          alreadyPresent: outcome.alreadyPresent,
        })
      }

      return outcome
    },
    'Failed to materialize recurring journal entries',
    { organizationId: rule.organizationId, ruleId: rule.id }
  )
}
