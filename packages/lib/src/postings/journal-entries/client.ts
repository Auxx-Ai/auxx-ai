// packages/lib/src/postings/journal-entries/client.ts
//
// Client-safe shapes for the journal-entry draft. Types and pure constants only;
// nothing here touches a database, a logger or a provider.
//
// NOTE: no 'use client' directive - server code imports this file too, and the
// directive would turn every export into a client-reference proxy there. See
// docs/lib-module-guide.md section 7.

import type { PostingDirection, PostingType } from '../types'

/** What the record IS, which decides the posting type it becomes. */
export type JournalEntryKindValue = 'manual' | 'opening_balance' | 'recurring_template'

/** Where the draft is in its one-way life. See `enum-values.ts` for why there is no `failed`. */
export type JournalEntryStatusValue = 'draft' | 'posted' | 'reversed'

/**
 * Kind -> the posting type it posts as.
 *
 * DECLARED here, in the client-safe leaf, because both the drawer and the
 * router need it and neither should have to know the mapping by heart.
 * `recurring_template` posts NOTHING - it is a stencil a future scheduler
 * copies, and `postJournalEntry` refuses it by name rather than by a missing
 * map entry, so the refusal carries a sentence.
 */
export const JOURNAL_ENTRY_POSTING_TYPE = {
  manual: 'manual_journal',
  opening_balance: 'opening_balance',
  // `as const satisfies` rather than a plain annotation: the annotation would
  // widen both values to `PostingType`, and the caller needs the two LITERALS -
  // `buildManualEntry` accepts only the two types a human authors, and widening
  // here would push that check to a cast at the call site.
} as const satisfies Record<Exclude<JournalEntryKindValue, 'recurring_template'>, PostingType>

/**
 * One line of the draft, exactly as it is stored in `journal_entry_lines`.
 *
 * 🛑 `amountMinor` is INTEGER MINOR UNITS and always positive; `direction` is
 * the only carrier of sign. Dollars never reach this shape - `toMinorUnits` in
 * `build-manual-entry.ts` is the single conversion and it is called at the
 * input boundary, in the browser.
 */
export interface JournalEntryLine {
  accountCode: string
  direction: PostingDirection
  amountMinor: number
  memo?: string
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
  createdAt: string | null
}

/** Filters `listJournalEntries` applies IN SQL. */
export interface ListJournalEntriesFilters {
  kind?: JournalEntryKindValue
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
  status: 'pending' | 'posted' | 'failed' | 'reversed'
  revision: number
  /** The posting this one reverses, when it is a reversal. */
  reversesId: string | null
  /** Integer minor units. The header's own recorded total, never a sum of lines. */
  totalMinor: number
  /** Read off the stored draft envelope, not recomputed. */
  memo: string | null
  postedAt: string | null
}
