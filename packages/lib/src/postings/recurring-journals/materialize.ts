// packages/lib/src/postings/recurring-journals/materialize.ts

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
 *    of bug: a locked month is an entry still OWED, not one skipped, and
 *    moving the cursor past it loses the occurrence permanently with no error
 *    anywhere. The books end up short a month of depreciation and every report
 *    ties. So the cursor lands on the held occurrence's own instant, and the
 *    sweep REPORTS the month; a person with `ledgerControl` decides whether to
 *    reopen it.
 *
 * The window and the hold are computed by `planRecurringOccurrences`, which is
 * pure and lives in `client.ts` so the templates screen renders the same
 * answer this job will act on.
 *
 * No permission checks. This runs as the org's system user, from a sweep.
 */

import type { Database } from '@auxx/database'
import { schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { eq } from 'drizzle-orm'
import type { Result } from 'neverthrow'
import { getOrgCache } from '../../cache'
import { requireJournalEntry } from '../journal-entries/reads'
import { createJournalEntry } from '../journal-entries/writes'
import { resolvePeriodLock } from '../period-lock'
import { guard } from './guard'
import { findGeneratedEntryIds, planForRule, type RecurrenceRuleRow } from './reads'

const logger = createScopedLogger('postings:recurring-journals')

/** What one pass over one template did, and what stopped it. */
export interface MaterializeRecurringJournalsResult {
  ruleId: string
  organizationId: string
  /** The template this rule schedules. */
  templateId: string
  /** Entry ids raised on this pass. */
  generated: string[]
  /** Occurrences a previous pass had already raised an entry for. */
  alreadyPresent: number
  /**
   * The closed month that stopped the pass, if any. Everything from this
   * occurrence on is still owed.
   */
  held: { occurrenceDate: string; month: string } | null
  /** Where the cursor was left. */
  cursor: Date
}

/**
 * Generate every entry this template owes, oldest first, stopping at the first
 * occurrence that could not be raised.
 *
 * ## Why a DRAFT and not a posting
 *
 * MK's decision A (task 21). An accrual reversal or a prepaid schedule is
 * exactly the entry a bookkeeper wants to look at before it lands, and the
 * safety argument costs nothing either way: both paths mint the same
 * `RJE-<fold>` period key, so the claim index is the boundary in both. A
 * draft's worst case is a DUPLICATE DRAFT - visible, discardable, and unable
 * to double-post because both drafts resolve to the same claim.
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

      const lock = await resolvePeriodLock(organizationId)
      const plan = planForRule(rule, lock, now)

      const outcome: MaterializeRecurringJournalsResult = {
        ruleId: rule.id,
        organizationId,
        templateId,
        generated: [],
        alreadyPresent: 0,
        held: plan.held,
        cursor: plan.cursor,
      }

      if (plan.due.length === 0) {
        await writeCursor(db, rule.id, plan.cursor)
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
        if (existing.has(occurrence.occurrenceDate)) {
          outcome.alreadyPresent++
          continue
        }
        try {
          const created = await createJournalEntry(db, organizationId, userId, {
            kind: 'recurring',
            // The SLOT is the accounting date on the generated entry. A person
            // may re-date the draft afterwards; `occurrenceDate` beside it does
            // not move, because it is half of what the posting is keyed on.
            date: occurrence.occurrenceDate,
            memo: template.memo ?? undefined,
            lines: template.lines,
            recurrenceRuleId: rule.id,
            occurrenceDate: occurrence.occurrenceDate,
          })
          if (created.isErr()) throw created.error
          outcome.generated.push(created.value.id)
        } catch (error) {
          // Hold the cursor AT this occurrence - see the file header. The next
          // sweep starts here and tries again.
          cursor = occurrence.start
          outcome.cursor = cursor
          outcome.held = null
          logger.error('Failed to generate a recurring journal entry; holding the cursor', {
            organizationId,
            ruleId: rule.id,
            templateId,
            occurrenceDate: occurrence.occurrenceDate,
            error: error instanceof Error ? error.message : String(error),
          })
          await writeCursor(db, rule.id, cursor)
          return outcome
        }
      }

      await writeCursor(db, rule.id, cursor)

      if (outcome.generated.length > 0 || outcome.held) {
        logger.info('Materialized recurring journal entries', {
          organizationId,
          ruleId: rule.id,
          templateId,
          generated: outcome.generated.length,
          alreadyPresent: outcome.alreadyPresent,
          heldMonth: outcome.held?.month ?? null,
        })
      }

      return outcome
    },
    'Failed to materialize recurring journal entries',
    { organizationId: rule.organizationId, ruleId: rule.id }
  )
}

/** The single writer of `materializedUntil` for this subject type. */
async function writeCursor(db: Database, ruleId: string, cursor: Date): Promise<void> {
  await db
    .update(schema.RecurrenceRule)
    .set({ materializedUntil: cursor })
    .where(eq(schema.RecurrenceRule.id, ruleId))
}
