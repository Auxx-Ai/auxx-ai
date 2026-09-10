// packages/lib/src/postings/provider-sync/client.ts
//
// The shapes the inbound half of the QuickBooks seam is built out of.
//
// CLIENT-SAFE. Types and pure constants only: no database, no provider, no io.
// Everything that touches a connection lives in this directory's other files.
//
// ## What the inbound half is
//
// Brief 20: the accounting firm authors depreciation, accruals, prepaid
// amortization, reclasses and payroll IN QuickBooks, and Auxx-Lift will never
// open QuickBooks. Those entries exist, they are authored somewhere we refuse
// to look, and no amount of authoring discipline on our side pulls them across.
// So we read their general ledger, drop everything auxx authored, and write the
// remainder as our own rows.
//
// 🛑 **Every entry has exactly ONE author, forever.** An entry auxx wrote is
// never edited in QuickBooks and pulled back; an entry the accountant wrote is
// never edited in auxx and pushed back. There is no merge, no conflict
// resolution, no last-writer-wins. Two disjoint sets moving in opposite
// directions, unioned into one ledger. {@link isOurs} is that rule as a
// predicate and it is the most dangerous function in this directory.
//
// @see plans/accounting/tasks/20-two-authors-one-ledger.md §3.1, §5, §6, §7

/**
 * One line of a provider's general ledger, already flattened by the apps-repo
 * mapper: the enclosing section's account carried down, the transaction id
 * lifted off the row, and debit/credit as separate explicit amounts.
 *
 * 🛑 **One row is one journal LINE, not one entry.** The 2026-09-10 sandbox
 * fixture is 337 `Data` rows, 336 emitted lines and 128 transactions. Writing
 * one posting per row would produce hundreds of single-sided postings instead
 * of 128 balanced entries.
 *
 * (336, not 337: one zero-amount row sits under a section carrying no account
 * id, so there is nothing to emit for it. Its other leg survives, so the
 * transaction count is unaffected. A row with MONEY on it and no account is a
 * refusal, never a skip.)
 */
export interface ProviderLedgerLine {
  /**
   * The provider's transaction type, VERBATIM: `'Journal Entry'`,
   * `'Credit Card Expense'`, `'Bill Payment'`, and so on.
   *
   * ⚠️ These are report labels, not queryable entity names. `'Check'` and
   * `'Credit Card Expense'` are both `Purchase` entities over the API. Do not
   * map them to entity names and do not switch on them beyond {@link isOurs}.
   */
  txnType: string
  /** The provider's transaction id. Groups lines into one entry with `txnType`. */
  txnId: string
  /** `YYYY-MM-DD`. */
  txnDate: string
  /** The provider's account id, carried down from the enclosing section header. */
  providerAccountId: string
  /** As rendered by the provider, for messages. Never used to join. */
  providerAccountName: string
  /**
   * Integer minor units.
   *
   * 🔧 The invariant is **never BOTH non-zero**, not "exactly one is non-zero".
   * Nine lines in the 2026-09-10 fixture have both cells empty (the
   * `Inventory Qty Adjust` opening rows, both legs), and an entry that is zero
   * on both sides is an ordinary non-event rather than a fault.
   *
   * ⚠️ **Do not drop zero-amount rows at grouping.** Brief 20 §4.7 suggested it
   * as a convenience and it is wrong: it deletes transactions `110` to `113`
   * outright and yields 124 entries instead of 128. Drop a zero LEG at the
   * write step, where `buildEntry` refuses `amount === 0` anyway.
   */
  debitMinor: number
  creditMinor: number
  docNumber: string | null
  memo: string | null
}

/**
 * One chunk of a provider's general ledger, as the tool returns it.
 *
 * `from`/`to` are the range the PROVIDER echoed back (`Header.StartPeriod` /
 * `EndPeriod`), not the range that was asked for. Intuit silently ignores some
 * date parameters, so the echo is asserted against the request and a mismatch
 * is a refusal, never a relabelled result.
 */
export interface ProviderLedger {
  from: string
  to: string
  currency: string
  /** `Header.Option[NoReportData] === 'false'`. */
  hasData: boolean
  lines: ProviderLedgerLine[]
}

/** Lines sharing one `(txnType, txnId)`, which is one entry on their side. */
export interface ProviderLedgerEntry {
  txnType: string
  txnId: string
  txnDate: string
  docNumber: string | null
  lines: ProviderLedgerLine[]
  totalDebitMinor: number
  totalCreditMinor: number
  /** `totalDebitMinor === totalCreditMinor`. */
  balanced: boolean
}

/**
 * The provider transaction type auxx itself writes. Everything the exporter
 * pushes is a journal entry; nothing else we author reaches their ledger.
 */
export const OUR_PROVIDER_TXN_TYPE = 'Journal Entry'

/**
 * 🛑🛑 Is this entry one WE authored?
 *
 * **This predicate is the single most dangerous thing in the inbound half.**
 * The general ledger report contains every journal entry auxx has ever pushed.
 * An import that gets this wrong re-reads our own ledger and **doubles every
 * posted entry in it**. Both copies balance. Every statement still ties.
 * Nothing downstream can detect it. It is brief 19 §5.1's failure with the
 * arrows reversed.
 *
 * ⚠️ **Keyed on the PAIR, never on the id alone.** The 2026-09-10 sandbox shows
 * ids running as one sequence across all 17 transaction types, which is
 * consistent with a single id pool but does not prove one, and Intuit's model
 * is an id per entity type. A `Purchase` sharing an id with one of our
 * `JournalEntry` rows would otherwise silently drop a real expense.
 *
 * @param ourProviderEntryIds every `GlPosting.providerEntryId` this org holds
 */
export function isOurs(
  entry: Pick<ProviderLedgerEntry, 'txnType' | 'txnId'>,
  ourProviderEntryIds: ReadonlySet<string>
): boolean {
  return entry.txnType === OUR_PROVIDER_TXN_TYPE && ourProviderEntryIds.has(entry.txnId)
}

/**
 * How one of OUR entries compares to the provider's copy of it.
 *
 * Brief 20 §3.4: an accountant can edit an entry auxx authored, and QuickBooks
 * reports no fault and no warning when they do. Because {@link isOurs} keys on
 * authorship and an edit does not transfer authorship, an edited entry is
 * invisible to the write path and the read path at the same time. Comparing
 * before discarding is the only detector that exists.
 */
export type OurEntryVerdict = 'matches' | 'edited' | 'missing'

/**
 * One of our entries, checked against the provider's copy.
 *
 * 🛑 A mismatch is REPORTED, never repaired. Deciding that their edit wins, or
 * that ours does, makes one entry answer to two authors, which is exactly what
 * the single-writer rule exists to prevent.
 */
export interface OurEntryCheck {
  glPostingId: string
  providerEntryId: string
  docNumber: string
  verdict: OurEntryVerdict
  /** Human-readable differences, empty when `verdict` is `'matches'`. */
  differences: string[]
}

/** What one chunk of the sync found. */
export interface ProviderSyncPlan {
  /** The range actually read, echoed by the provider. */
  from: string
  to: string
  /** Entries to write as `provider_sync` postings: everything they authored. */
  theirs: ProviderLedgerEntry[]
  /** Our own entries, checked rather than written. Brief 20 §5.3. */
  ours: OurEntryCheck[]
  /**
   * Entries that do not balance as read. 🛑 Never written: an unbalanced entry
   * in the ledger is worse than a missing one, because it silently breaks every
   * statement that ties.
   */
  unbalanced: ProviderLedgerEntry[]
}

// ─── The comparison's own side (§5.3) ───────────────────────────────────────
//
// The planner is pure, so our version of an entry is a PARAMETER rather than
// something it reads. These two shapes are what `reads.ts` projects a
// `GlPosting` + its `GlPostingLine` rows into, and nothing more: the comparison
// asks four questions (same account set, same debit and credit per account,
// same total, same date) and needs exactly the columns that answer them.

/** One line of one of our own posted entries, as the comparison reads it. */
export interface OurPostedLine {
  /**
   * The `gl_account` instance id the line landed on - the IDENTITY (task 15).
   * Their side is keyed by PROVIDER account id, so the comparison needs the
   * account map to bring the two into one keyspace.
   */
  glAccountId: string
  direction: 'debit' | 'credit'
  /** Integer minor units. Always > 0 - `direction` carries the sign. */
  amountMinor: number
  /**
   * `GlPostingLine.accountCode` / `.accountName`, the SNAPSHOTS frozen on the
   * line at posting time. Present only so a reported difference can name an
   * account the way a bookkeeper reads it; nothing joins on either, and neither
   * is ever re-read from the live chart (`read-posting.ts`'s rule).
   */
  accountCode: string | null
  accountName: string | null
}

/**
 * One entry auxx authored and exported, as the comparison reads it.
 *
 * `providerEntryId` is what joins it to their copy, and `txnDate` is what
 * decides whether its absence from a chunk is evidence or noise (§5.3's ⚠️).
 */
export interface OurPostedEntry {
  glPostingId: string
  /** `GlPosting.providerEntryId`. Never null here - an entry with none was never exported. */
  providerEntryId: string
  docNumber: string
  /** `YYYY-MM-DD`, our accounting date for the entry. */
  txnDate: string
  lines: readonly OurPostedLine[]
}

/**
 * One date range, `YYYY-MM-DD` inclusive on both ends.
 *
 * §4.8 established that report endpoints do not paginate, so the range is the
 * only lever the sync has and one of these is one call to the provider.
 */
export interface ProviderSyncRange {
  from: string
  to: string
}

/**
 * The posting type every synced entry is written under.
 *
 * 🛑 The value is also declared `'none'` in `EXPORT_ROUTE_BY_POSTING_TYPE`, and
 * THAT is the loop guard - not the `exportStatus` column. Named here so the
 * sync's own files never spell the string themselves.
 */
export const PROVIDER_SYNC_POSTING_TYPE = 'provider_sync'

/**
 * The `sourceType` every synced line carries, with the provider's transaction
 * id as its `sourceId`.
 *
 * The pair is what makes a posting explainable later without joining through a
 * provider's API - the same contract every other builder's lines hold.
 */
export const PROVIDER_SYNC_SOURCE_TYPE = 'provider_ledger'

// ─── §7.3: the "synced through" marker ──────────────────────────────────────
//
// The firm posts December's depreciation in February. auxx's December balance
// sheet is INCOMPLETE until the sync runs and restates it, and then it changes.
// A statement that silently changes two months after a reader last looked at it
// is a trust problem rather than a correctness one, and the only thing that
// fixes it is the statement saying so on its own face.
//
// Everything below is PURE, so the statement pages can turn a stored date into
// a sentence without a second round trip and without the wording living in six
// components.

/**
 * The setting key holding the end of the last range the inbound sync read
 * without a refusal.
 *
 * Named here rather than spelled in `sync.ts` and the reader independently, for
 * the same reason {@link PROVIDER_SYNC_POSTING_TYPE} is: two string literals
 * that must agree is one rename away from a marker that never moves.
 */
export const PROVIDER_SYNCED_THROUGH_SETTING_KEY = 'accounting.providerSyncedThrough'

/** How far the inbound sync has genuinely read, for one organization. */
export interface ProviderSyncMarker {
  /**
   * 🛑 `false` when nothing is connected, and the statement then renders NO
   * marker at all - not "synced through: never", not an empty one. A marker on
   * an unconnected org is meaningless and implies a connection exists.
   */
  connected: boolean
  /** The connected provider's id, or `'none'`. Never assumed. */
  providerId: string
  /** `YYYY-MM-DD`, or null when the sync has never completed a chunk. */
  syncedThrough: string | null
}

/**
 * What one statement should say about its own completeness.
 *
 * `behind` is the case §7.3 is about and the most useful thing this feature can
 * say: a balance sheet as of 31 December, read on an org synced through
 * 30 November, is missing every entry the accountant has authored in between
 * and will change once the sync passes over it.
 */
export type ProviderSyncCoverage = 'not_connected' | 'never_synced' | 'behind' | 'current'

/** One rendered reading of the marker. `headline === null` means render nothing. */
export interface ProviderSyncReading {
  coverage: ProviderSyncCoverage
  /** Null only for `not_connected`. */
  headline: string | null
  /** The consequence, in the reader's terms. Null when there is nothing to add. */
  detail: string | null
}

/** `quickbooks` reads as QuickBooks. Anything unregistered reads as itself. */
const PROVIDER_LABELS: Record<string, string> = { quickbooks: 'QuickBooks' }

/** The connected provider's name as a person writes it. */
export function providerDisplayName(providerId: string): string {
  return PROVIDER_LABELS[providerId] ?? providerId
}

/**
 * Turn the stored marker and one statement's own end date into the sentence the
 * statement renders.
 *
 * 🛑 The comparison is a plain string compare and that is deliberate: both sides
 * are `YYYY-MM-DD`, which sorts lexically as it sorts chronologically, and
 * parsing either into a `Date` here would re-introduce the timezone bug that
 * puts 31 December into November for half the world.
 *
 * @param marker what {@link ProviderSyncMarker} the org holds
 * @param statementThrough the LAST date this statement covers - `asOf` for a
 *   balance sheet or an aging, `to` for a P&L or a general ledger. An empty
 *   string (no period resolved yet) reads as `current`, because a statement
 *   with no range cannot be behind one.
 */
export function describeProviderSyncCoverage(
  marker: ProviderSyncMarker,
  statementThrough: string
): ProviderSyncReading {
  const provider = providerDisplayName(marker.providerId)

  if (!marker.connected) {
    return { coverage: 'not_connected', headline: null, detail: null }
  }

  if (!marker.syncedThrough) {
    return {
      coverage: 'never_synced',
      headline: `Nothing has been read from ${provider} yet`,
      detail:
        `Entries your accountant authored in ${provider} are not in this statement. It will ` +
        'change once the first sync runs.',
    }
  }

  if (statementThrough && statementThrough > marker.syncedThrough) {
    return {
      coverage: 'behind',
      headline: `Incomplete after ${marker.syncedThrough}`,
      detail:
        `This statement runs to ${statementThrough}, but ${provider} has only been read through ` +
        `${marker.syncedThrough}. Anything your accountant authored in between is missing, and ` +
        'these figures will change when the sync catches up.',
    }
  }

  return {
    coverage: 'current',
    headline: `Synced through ${marker.syncedThrough}`,
    detail: null,
  }
}
