// packages/lib/src/banking/import/types.ts

import type { BankAccountCoverage, CoverageGap } from '../client'

/**
 * How an exclusion written by the IMPORTER itself begins.
 *
 * 🛑 The only string that distinguishes "the importer linked this row to the feed
 * row that already held it" from "a person decided this line is not ours and said
 * why". `reverseImport` hard-deletes what it may, so without this it would delete
 * a human's deliberate exclusion and the reason it is required to carry - and an
 * exclusion with no reason reads exactly like an unreviewed line to the next
 * person who opens the queue.
 *
 * Declared here rather than in `finalize.ts` so `reverse.ts`'s pure
 * `refusalReason` can read it without importing the write path.
 */
export const IMPORT_LINK_EXCLUSION_PREFIX = 'Already present from the bank feed as'

/**
 * One statement line as the import surface sees it, before it is a record.
 *
 * The same shape whether it came from an OFX `<STMTTRN>` or a mapped CSV row,
 * which is the whole point: the mapping step exists to turn every bank's own
 * columns into exactly this.
 */
export interface BankImportRow {
  /** `FITID` for OFX, the deterministic composite for CSV, null when unknown. */
  externalId: string | null
  /** `YYYY-MM-DD` wall-clock. Period membership is decided by it. */
  postedAt: string | null
  /** Signed integer minor units, verbatim from the bank. */
  amountMinor: number | null
  description: string | null
}

/**
 * What one column of a remembered mapping says.
 *
 * Deliberately the same three fields `dataImport.saveColumnMapping` takes, so
 * replaying a saved mapping is N calls to the procedure the wizard already uses
 * rather than a second write path into `ImportMappingProperty`.
 */
export interface SavedMappingColumn {
  columnIndex: number
  /** The `bank_transaction` field key, or null for a column to skip. */
  targetFieldKey: string | null
  resolutionType: string
  /** True when this column is (part of) the job's match key. */
  isIdentifier: boolean
}

/** A whole remembered mapping, keyed by {@link headerSignature} in the setting. */
export interface SavedMapping {
  signature: string
  /** The header row it was made for, verbatim, so a stale entry is legible. */
  headers: string[]
  columns: SavedMappingColumn[]
  /** ISO timestamp of the last save. Used to evict the oldest entry. */
  savedAt: string
  /** What the person called it, e.g. the file name it came from. */
  label: string | null
}

/**
 * What a file would do to an account's coverage, and what of it we already hold.
 *
 * Rendered on the confirm step (`ui-plan.md` §2.9) so the sentence a person
 * reads before pressing Start Import is "this file covers 1 Jan to 9 Mar, it
 * closes the gap on ···5381, and 14 of its 62 rows are already here from the
 * feed" - rather than a row count.
 */
export interface CoverageEffect {
  bankAccountId: string
  /** Earliest `postedAt` in the file, null when no row carried a usable date. */
  fileFrom: string | null
  fileTo: string | null
  rowCount: number
  /** Rows whose date or amount did not parse; they import as blanks. */
  unusableRowCount: number
  /** The account's coverage as it stands, before this import. */
  coverage: BankAccountCoverage
  /** Gaps the file's range touches at all. */
  gapsTouched: CoverageGap[]
  /** Gaps the file's range covers end to end. */
  gapsClosed: CoverageGap[]
  /** What `coverageFrom` becomes if this import runs. */
  newCoverageFrom: string | null
  overlap: BankImportOverlap
}

/**
 * The cross-source overlap: how much of this file we already hold.
 *
 * 🛑 An overlap is the NORMAL case, not an edge case (05 §6). Files cover up to
 * the cutover, the API covers 180 days back, and 01 §4.1 deliberately overlaps
 * them so there is no hole.
 */
export interface BankImportOverlap {
  /** Rows whose `externalId` is already on this account. They UPDATE, never duplicate. */
  byExternalId: number
  /**
   * Rows that are not known by id but whose `(postedAt, amountMinor, matchKey)`
   * already exists on this account from a DIFFERENT source. They are LINKED and
   * excluded on finalize, never merged and never duplicated.
   */
  byMatchKey: number
  /** Rows neither door recognised. This is what the import actually adds. */
  added: number
}

/** What `finalizeBankImport` did. */
export interface FinalizeBankImportResult {
  importBatchId: string
  bankAccountId: string
  /** Rows the import job produced and this stamped. */
  stamped: number
  /** Of those, how many were given a synthesised `externalId`. */
  externalIdsSynthesised: number
  /** Of those, how many were linked to an existing feed row and excluded. */
  linkedToFeed: number
  coverageFrom: string | null
  gaps: CoverageGap[]
}

/** One row `reverseImport` would not delete, and why. */
export interface ReverseImportRefusal {
  id: string
  postedAt: string | null
  amountMinor: number | null
  description: string | null
  reason: string
}

/** What `reverseImport` did, and what it would not do. */
export interface ReverseImportResult {
  importBatchId: string
  deleted: number
  refused: ReverseImportRefusal[]
  coverageFrom: string | null
  gaps: CoverageGap[]
}

/** One finished import, as the batches list renders it. */
export interface BankImportBatch {
  importBatchId: string
  bankAccountId: string | null
  bankAccountName: string | null
  rowCount: number
  from: string | null
  to: string | null
  /** Rows that carry a posting or a match, which "Reverse this import" will refuse. */
  protectedCount: number
  firstSeenAt: Date | null
}
