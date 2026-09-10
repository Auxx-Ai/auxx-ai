// packages/lib/src/postings/recurring-journals/sweep.ts

/**
 * The daily pass over every journal template in every org.
 *
 * 🛑 **Per-rule `try`/`catch`, copied from `money/auto-invoice.ts:608-628` and
 * NOT from `dispatch/recurring/materialize.ts:271-290`.** The visit sweep has
 * no per-rule isolation at all - it loads every rule across every org into one
 * serial loop - and its sibling's comment says why that is tolerable there:
 * it never generates money. One org with an unreadable period lock or a
 * template somebody archived must not stop every other org's close.
 *
 * `materializeRecurringJournals` already returns a `Result` rather than
 * throwing, so the `catch` here is for the failures BELOW it - a connection
 * that dropped mid-pass. Both are logged and neither escapes.
 */

import { type Database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, eq, isNull, lt, or } from 'drizzle-orm'
import { RECURRING_JOURNAL_SUBJECT_TYPE } from './client'
import { materializeRecurringJournals } from './materialize'

const logger = createScopedLogger('postings:recurring-journals')

/** What one sweep did, across every org. */
export interface RecurringJournalSweepSummary {
  rulesEvaluated: number
  entriesGenerated: number
  /**
   * Every template whose next entry is owed to a CLOSED month.
   *
   * This is the report task 21 §1.5 asks for: the sweep does not decide, it
   * says what it wants. Somebody with `ledgerControl` reopens the month or
   * accepts that the entry is late; either way the cursor is holding the
   * occurrence, so nothing is lost while they think about it.
   */
  held: Array<{
    organizationId: string
    ruleId: string
    templateId: string
    occurrenceDate: string
    month: string
  }>
  failed: number
}

/**
 * Materialize every `journal_entries` recurrence rule whose cursor is behind
 * now.
 *
 * The `(organizationId, subjectType)` index on `RecurrenceRule` is the one
 * this query wants; the `subjectType` predicate is what keeps a visit or an
 * invoice schedule out of the accounting lane entirely.
 */
export async function sweepRecurringJournals(db: Database): Promise<RecurringJournalSweepSummary> {
  const now = new Date()
  const summary: RecurringJournalSweepSummary = {
    rulesEvaluated: 0,
    entriesGenerated: 0,
    held: [],
    failed: 0,
  }

  const rules = await db
    .select()
    .from(schema.RecurrenceRule)
    .where(
      and(
        eq(schema.RecurrenceRule.subjectType, RECURRING_JOURNAL_SUBJECT_TYPE),
        // A cursor at or ahead of now has nothing to generate. Null is a rule
        // that has never run.
        or(
          isNull(schema.RecurrenceRule.materializedUntil),
          lt(schema.RecurrenceRule.materializedUntil, now)
        )
      )
    )

  for (const rule of rules) {
    summary.rulesEvaluated++
    try {
      const result = await materializeRecurringJournals(db, rule, { now })
      if (result.isErr()) {
        summary.failed++
        logger.error('Failed to materialize a recurring journal rule', {
          organizationId: rule.organizationId,
          ruleId: rule.id,
          error: result.error.message,
        })
        continue
      }
      summary.entriesGenerated += result.value.generated.length
      if (result.value.held) {
        summary.held.push({
          organizationId: rule.organizationId,
          ruleId: rule.id,
          templateId: rule.subjectId,
          occurrenceDate: result.value.held.occurrenceDate,
          month: result.value.held.month,
        })
      }
    } catch (error) {
      summary.failed++
      logger.error('Recurring journal rule threw below the materializer', {
        organizationId: rule.organizationId,
        ruleId: rule.id,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  if (summary.held.length > 0) {
    // WARN, not info: an entry the books are owed and cannot have is exactly
    // the thing somebody should see in a log search without going looking.
    logger.warn('Recurring journal entries are owed to closed periods', {
      count: summary.held.length,
      months: [...new Set(summary.held.map((h) => h.month))].join(', '),
    })
  }

  return summary
}
