// packages/lib/src/postings/journal-entries/client.ts
//
// Client-safe shapes for the journal-entry draft. Types and pure constants only;
// nothing here touches a database, a logger or a provider.
//
// NOTE: no 'use client' directive - server code imports this file too, and the
// directive would turn every export into a client-reference proxy there. See
// docs/lib-module-guide.md section 7.

import type {
  CounterpartyType,
  PostingDirection,
  PostingExportStatus,
  PostingStatus,
  PostingType,
} from '../types'

/** What the record IS, which decides the posting type it becomes. */
export type JournalEntryKindValue =
  | 'manual'
  | 'opening_balance'
  | 'recurring_template'
  | 'recurring'

/** Where the draft is in its one-way life. See `enum-values.ts` for why there is no `failed`. */
export type JournalEntryStatusValue = 'draft' | 'posted' | 'reversed'

/**
 * Kind -> the posting type it posts as.
 *
 * DECLARED here, in the client-safe leaf, because both the drawer and the
 * router need it and neither should have to know the mapping by heart.
 * `recurring_template` posts NOTHING - it is the stencil the sweep copies, and
 * `postJournalEntry` refuses it by name rather than by a missing map entry, so
 * the refusal carries a sentence.
 *
 * 🛑 `recurring` -> `recurring_journal` is the row that makes the scheduler
 * safe (task 21 §1.4). A generated entry keys its posting on
 * `hashedPeriodKey('RJE', '<ruleId>:<occurrenceDate>')` rather than on this
 * record's number, so two drafts of one occurrence contend on the SAME claim
 * and the second converges to `already_posted`. Mapping it to `manual_journal`
 * instead would key each draft on its own number and post the month twice.
 */
export const JOURNAL_ENTRY_POSTING_TYPE = {
  manual: 'manual_journal',
  opening_balance: 'opening_balance',
  recurring: 'recurring_journal',
  // `as const satisfies` rather than a plain annotation: the annotation would
  // widen every value to `PostingType`, and the caller needs the LITERALS -
  // `buildManualEntry` accepts only the types a person authors line by line,
  // and widening here would push that check to a cast at the call site.
} as const satisfies Record<Exclude<JournalEntryKindValue, 'recurring_template'>, PostingType>

/**
 * One line of the draft, exactly as it is stored in `journal_entry_lines`.
 *
 * 🛑 `amountMinor` is INTEGER MINOR UNITS and always positive; `direction` is
 * the only carrier of sign. Dollars never reach this shape - `toMinorUnits` in
 * `build-manual-entry.ts` is the single conversion and it is called at the
 * input boundary, in the browser.
 *
 * `glAccountId` (task 15: the id is the identity, the code is a label) - a
 * person picks a specific `gl_account` `EntityInstance` out of their own chart
 * by id, never by its code, which may not exist at all once it is optional.
 */
export interface JournalEntryLine {
  glAccountId: string
  direction: PostingDirection
  amountMinor: number
  memo?: string
  /**
   * Who this line is attributable to, when it names a receivable or payable
   * account (brief 13 §1.4). Optional everywhere; the only refusal on an
   * empty counterparty happens at QuickBooks export time, never on save.
   */
  counterpartyType?: CounterpartyType
  counterpartyId?: string
}

/**
 * What the `journal_entry_lines` JSON column actually holds.
 *
 * 🛑 **An OBJECT wrapping the array, never the bare array.** A `FieldValue`
 * write treats a top-level array as a MULTI-VALUE write - one row per element -
 * and `journal_entry_lines` is single-value, so handing it `[lineA, lineB]`
 * fails with "single-value; received 2 values", which
 * `UnifiedCrudHandler.setFieldValues` LOGS and swallows: the update reports
 * success over an entry that is silently line-less. Found by driving the path
 * against a real org, not by a test.
 *
 * ⚠️ This is the INNER shape. The field-value layer wraps every stored JSON in
 * its own `{ v, meta }` envelope (`readEnvelope` in `@auxx/types/field-value`),
 * so the column holds `{ v: { lines: [...] } }`. `parseLines` unwraps both.
 * There is deliberately no version key here: a second `v` nested inside theirs
 * reads as a mistake every time somebody opens the row.
 */
export interface JournalEntryLinesEnvelope {
  lines: JournalEntryLine[]
}

/**
 * One draft, as every read path returns it and the drawer renders it.
 *
 * Nullable almost throughout because these are `FieldValue` rows on an
 * `EntityInstance`: a field that has never been written has no row at all, and
 * an org short of migration 125 has no field either. A reader that assumed a
 * value would render `undefined` into a money column.
 */
export interface JournalEntryRecord {
  id: string
  /** `'JNL-0007'`. Hook-issued on create; also the posting's `periodKey`. */
  number: string | null
  /** `YYYY-MM-DD`. The accounting date. */
  date: string | null
  memo: string | null
  status: JournalEntryStatusValue
  kind: JournalEntryKindValue
  /** Empty until somebody adds a line. Never null - an absent value reads as `[]`. */
  lines: JournalEntryLine[]
  /** The `GlPosting` row this became. Null while `draft`. */
  glPostingId: string | null
  /**
   * The `RecurrenceRule` that generated this entry. Null on every
   * hand-authored one, and null on the TEMPLATE itself - a template is the
   * rule's `subjectId`, so pointing back would close a cycle.
   */
  recurrenceRuleId: string | null
  /**
   * The recurrence SLOT this entry fills, `YYYY-MM-DD`.
   *
   * 🛑 Not the accounting date. {@link JournalEntryRecord.date} is what the
   * period lock reads and a person may re-date; this is what the expander
   * produced and it never moves, because it is half of what the posting's
   * `periodKey` is hashed from.
   */
  occurrenceDate: string | null
  createdAt: string | null
}

/** Filters `listJournalEntries` applies IN SQL. */
export interface ListJournalEntriesFilters {
  /**
   * Match any of these kinds. An empty array and an absent value both mean
   * "every kind".
   *
   * A LIST rather than one value because the drafts list wants the two
   * postable hand-reviewed kinds (`manual` and the sweep's `recurring`) and
   * not the stencil - which one value cannot express without an
   * `excludeKind` twin that would then have to be reconciled with it.
   */
  kinds?: JournalEntryKindValue[]
  status?: JournalEntryStatusValue
  /**
   * An accounting MONTH, `'2026-08'`, matched against the entry's `date`.
   *
   * ⚠️ NOT the posting's `periodKey`, which for a `manual_journal` is the entry
   * NUMBER (`doc-number.ts`). The two are different keyspaces and only the date
   * answers "what did somebody adjust in August".
   */
  periodKey?: string
  limit?: number
  offset?: number
}

/** One posted entry, as the ledger page's entries list reads it. */
export interface PostingSummary {
  id: string
  postingType: PostingType
  periodKey: string
  /** `YYYY-MM-DD`. */
  txnDate: string
  docNumber: string
  status: PostingStatus
  /**
   * What the EXPORT did. Rendered beside `status`, never instead of it: an entry
   * whose push was refused is in the books, and a screen that shows only
   * `status` says nothing at all about the copy that never went out.
   */
  exportStatus: PostingExportStatus
  /** Why the export was refused. Never why a posting was refused - there is no such row. */
  failureReason: string | null
  revision: number
  /** The posting this one reverses, when it is a reversal. */
  reversesId: string | null
  /** Integer minor units. The header's own recorded total, never a sum of lines. */
  totalMinor: number
  /** Read off the stored draft envelope, not recomputed. */
  memo: string | null
  postedAt: string | null
}
