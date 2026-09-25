// packages/lib/src/accounting/journals/recurring/client.ts

/**
 * The recurring journal template, reduced to what is PURE: the keyspace, and
 * the window.
 *
 * Both halves are here rather than beside the database code because both are
 * things a screen has to be able to answer without a round trip - the
 * templates list renders "next due 1 Mar" from {@link planRecurringOccurrences},
 * and the drawer renders the document number an occurrence WOULD claim from {@link recurringJournalPeriodKey}. A second
 * copy of either on the client is a second keyspace, and a drifted keyspace is
 * undetectable (`period-key.ts` makes this argument at length).
 *
 * NOTE: no 'use client' directive - the materializer imports this file too, and
 * the directive would turn every export into a client-reference proxy there.
 * See docs/lib-module-guide.md §7.
 */

// The `recurrence` BARREL, not its `/client` subpath: that file carries a
// `'use client'` directive, and the materializer imports this module on the
// server, where the directive would turn every export into a client-reference
// proxy. The barrel is equally pure - `recurrence/client.ts` re-exports it
// verbatim - so nothing server-only comes with it.
import {
  expandOccurrences,
  localDateStartUtc,
  type RecurrenceOccurrence,
  type RecurrencePattern,
} from '../../../recurrence'
import { hashedPeriodKey } from '../../ledger/periods/period-key'

/**
 * The `RecurrenceRule.subjectType` a journal template's schedule is stored
 * under - the third value on a column that already carries
 * `'work_order_visits'` and `'invoice_drafts'`.
 *
 * Plural, matching its two siblings: the value names the KIND OF THING the
 * rule produces, not the one record it hangs off.
 */
export const RECURRING_JOURNAL_SUBJECT_TYPE = 'journal_entries' as const

/**
 * The three letters `DOC_NUMBER_PREFIX.recurring_journal` declares.
 *
 * Restated here so {@link recurringJournalPeriodKey} does not have to import
 * `doc-number.ts` for one string, and pinned to it by test: a prefix that
 * drifted from the document number's would mint a key naming one type inside a
 * number naming another.
 */
export const RECURRING_JOURNAL_DOC_PREFIX = 'RJE' as const

/** Which rule, and which slot in it. Together, the identity of one occurrence. */
export interface RecurringJournalIdentity {
  recurrenceRuleId: string
  /** `YYYY-MM-DD`, as `expandOccurrences` produced it. Never the accounting date. */
  occurrenceDate: string
}

/**
 * The `sourceId` an occurrence's period key is folded from.
 *
 * 🛑 The rule id AND the date, never one of them. The rule alone repeats every
 * month onto one key; the date alone collides across two templates that both
 * fire on the last day of the month, which is the ordinary case for
 * depreciation and accrual reversals sitting side by side.
 */
export function recurringJournalSourceId(identity: RecurringJournalIdentity): string {
  return `${identity.recurrenceRuleId}:${identity.occurrenceDate}`
}

/**
 * The `GlPosting.periodKey` one occurrence claims.
 *
 * 🛑 **This is the whole of the idempotency** (task 21 §1.4). The record layer
 * cannot help: a generated entry is an `EntityInstance` and `FieldValue` has
 * exactly one unique index, which is `(entityId, fieldId, sortKey)` and not
 * `(ruleId, occurrenceDate)` - so the check-then-write dedupe in the
 * materializer races. The claim's unique index on
 * `(organizationId, postingType, periodKey, revision)` does not, and this
 * function is what puts two runs of March on one tuple.
 *
 * Hashed rather than composed: a rule number plus a month has no fixed width,
 * and a hash is the shape the other hash-keyed types share (`period-key.ts`).
 * `RJE-A1B2C3` is 10, and `-R1` keeps it well inside the 21-character cap.
 *
 * ⚠️ The fold's collision caveat is inherited in full. A caller that sees
 * `already_posted` owes a check that the winning posting fills the SAME SLOT
 * before it believes it - `findRecurringKeyCollision` in
 * `journal-entries/writes.ts` is that check.
 *
 * @throws {UnprocessableEntityError} on a blank rule id or occurrence date.
 */
export function recurringJournalPeriodKey(identity: RecurringJournalIdentity): string {
  return hashedPeriodKey({
    prefix: RECURRING_JOURNAL_DOC_PREFIX,
    sourceId: recurringJournalSourceId(identity),
    label: 'recurring journal entry',
    idLabel: 'rule id and occurrence date',
  })
}

/** Everything {@link planRecurringOccurrences} needs, and nothing it does not. */
export interface RecurringJournalWindow {
  pattern: RecurrencePattern
  /** `RecurrenceRule.anchor` - the series start, local ISO date. */
  anchor: string
  /**
   * `RecurrenceRule.timezone`.
   *
   * 🛑 For this subject type it holds the org's `accounting.bookTimeZone` and
   * is read from nowhere else (task 21 §1.3). The accounting month boundary is
   * a wall-clock midnight in the book time zone, and a rule carrying its own
   * zone would make two authorities out of one question - a December 31 entry
   * would land in January for half of them.
   */
  timezone: string
  /**
   * `RecurrenceRule.materializedUntil`, or `null` when nothing has been
   * generated yet.
   *
   * 🛑 A BACKWARD cursor, the `invoice_drafts` reading, NOT the visit
   * materializer's forward horizon. The two consumers of this column mean
   * opposite things by it and the column comment documents only the forward
   * one. A journal template wants the backward reading: a depreciation entry
   * for March may not exist in January.
   */
  materializedUntil: Date | null
  /** The instant the window closes at. "Today", never "today plus a horizon". */
  now: Date
}

/** What a template owes. */
export interface RecurringJournalPlan {
  /** The occurrences to generate, oldest first. */
  due: RecurrenceOccurrence[]
  /** What `materializedUntil` becomes once every occurrence in `due` has landed. */
  cursor: Date
}

/**
 * What a template owes right now: the backward window. A reviewed month holds nothing back.
 *
 * PURE. No database, no clock of its own, no settings - `now` is an argument so
 * the whole window rule is exhaustively testable and so the templates screen can
 * render the same answer the sweep will act on.
 *
 * `countConsumed` is derived from the cursor rather than from a counter column
 * (the recurring engine's §4.4 principle): occurrences strictly before the
 * boundary are what the series has already spent, so a `count`-ended template
 * exhausts exactly once even though nothing counts the rows.
 */
export function planRecurringOccurrences(window: RecurringJournalWindow): RecurringJournalPlan {
  const { pattern, anchor, timezone, materializedUntil, now } = window

  const anchorStart = localDateStartUtc(anchor, timezone)
  const boundary = materializedUntil ?? anchorStart

  const countConsumed = expandOccurrences(pattern, {
    anchor,
    timezone,
    from: anchorStart,
    to: new Date(boundary.getTime() - 1),
    // Local midnight. A journal entry has no time of day - the accounting date
    // is the whole of what it lands on - so the slot is the day itself.
    startMinute: 0,
  }).length

  const occurrences = expandOccurrences(pattern, {
    anchor,
    timezone,
    from: boundary,
    to: now,
    startMinute: 0,
    countConsumed,
  })

  return { due: occurrences, cursor: now }
}
