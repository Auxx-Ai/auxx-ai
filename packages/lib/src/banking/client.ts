// packages/lib/src/banking/client.ts

/**
 * The client-safe half of `banking/`: the vocabularies, the read models and the
 * pure coverage arithmetic (`docs/lib-module-guide.md` §7).
 *
 * Imports nothing server-only, and carries no `'use client'` directive - server
 * code imports this file too, and the directive would turn every export into a
 * client-reference proxy there.
 *
 * ⚠️ Browser code must import `@auxx/lib/banking/client`, never
 * `@auxx/lib/banking`. The barrel reaches Drizzle and the org cache.
 */

/** What kind of account the bank says this is. Mirrors `BANK_ACCOUNT_TYPE_OPTIONS`. */
export const BANK_ACCOUNT_TYPES = ['depository', 'credit'] as const
export type BankAccountType = (typeof BANK_ACCOUNT_TYPES)[number]

/** Where this account's rows come from. Mirrors `BANK_ACCOUNT_STATUS_OPTIONS`. */
export const BANK_ACCOUNT_STATUSES = ['manual', 'connected', 'disconnected'] as const
export type BankAccountStatus = (typeof BANK_ACCOUNT_STATUSES)[number]

/** Human labels, so the picker and the badge agree without a second table. */
export const BANK_ACCOUNT_TYPE_LABELS: Record<BankAccountType, string> = {
  depository: 'Depository',
  credit: 'Credit',
}

export const BANK_ACCOUNT_STATUS_LABELS: Record<BankAccountStatus, string> = {
  manual: 'Manual',
  connected: 'Connected',
  disconnected: 'Disconnected',
}

/**
 * Which statement classifications a bank account of each type may map onto.
 *
 * 🛑 **A `credit` account is a LIABILITY and its signs are inverted**
 * (plans/bank-connection/02-connection-architecture.md §6). Mapping a card to an
 * asset account produces a balance sheet that balances and is wrong by twice the
 * card balance, which is a failure nothing downstream can detect. The picker
 * filters on this; the write path refuses on it.
 */
export const BANK_ACCOUNT_GL_TYPES: Record<BankAccountType, 'asset' | 'liability'> = {
  depository: 'asset',
  credit: 'liability',
}

/** The sentence the settings editor renders under the GL account row. */
export const CREDIT_SIGN_WARNING =
  'A credit card is a liability, and its signs are the reverse of a chequing account. Map it ' +
  'to a liability account, never an asset one - the balance sheet still balances either way, ' +
  'so nothing downstream will catch it.'

/**
 * How an exclusion written by an ARCHIVE begins.
 *
 * 🛑 Archiving a bank account bulk-sets its `for_review` and `suggested` lines to
 * `excluded`, because after the archive nobody will ever look at them again and
 * the two alternatives are worse: refusing until the queue is empty leaves an org
 * that connected the wrong bank unable to clear 180 days of noise off the screen,
 * and a silent bulk delete destroys evidence that cash moved with no trace
 * (plans/bank-connection/08-removing-a-bank-account.md §6).
 *
 * The prefix is what lets a later path tell an archive's own bookkeeping from a
 * person's decision, exactly as `IMPORT_LINK_EXCLUSION_PREFIX` does for the
 * importer's. An exclusion a HUMAN wrote carries the reason they gave and is the
 * record of that decision; this one carries the account's name and the fact that
 * the account went away.
 */
export const ARCHIVE_EXCLUSION_PREFIX = 'Excluded when the bank account was archived'

/** Was this exclusion written by an archive, or by a person? */
export function isArchiveExclusion(reason: string | null | undefined): boolean {
  return !!reason?.trimStart().startsWith(ARCHIVE_EXCLUSION_PREFIX)
}

/**
 * A range with no data on an account, as inclusive `YYYY-MM-DD` date keys.
 *
 * Stored on `bank_account.coverageGaps` as an array of exactly this shape.
 */
export interface CoverageGap {
  from: string
  to: string
}

/**
 * 🛑 **The gap heuristic, and it IS a heuristic.**
 *
 * There is no way to distinguish "we hold no rows for this fortnight" from "this
 * account had no activity for a fortnight" by looking at transactions alone -
 * only the statement knows, and the statement is the thing we do not have. So
 * `readCoverage` calls any run of more than this many consecutive days without a
 * transaction a *possible* gap and says so in the UI.
 *
 * Seven days is chosen because a business bank account with genuinely no
 * movement for over a week is rare enough to be worth a look, and because it
 * survives a holiday weekend without crying wolf. A quiet personal savings
 * account will report gaps constantly; that is the cost of the alternative
 * (silence over a real hole) being unacceptable - a balance sheet spanning a
 * hole renders happily and is wrong (plans/bank-connection/01 §4.1 (4c)).
 *
 * The authoritative record is the STORED `coverageGaps` array, which an importer
 * writes when it knows something the transactions cannot say.
 */
export const COVERAGE_GAP_DAYS = 7

const MS_PER_DAY = 86_400_000

/** `YYYY-MM-DD` for a Date or an ISO string, in UTC. Never a locale format. */
export function toDateKey(value: Date | string): string {
  return (typeof value === 'string' ? value : value.toISOString()).slice(0, 10)
}

/** Parse a `YYYY-MM-DD` key to the UTC epoch millis of its midnight. */
function dateKeyToUtc(key: string): number {
  return Date.parse(`${key}T00:00:00.000Z`)
}

/** `key` shifted by `days`, back as a `YYYY-MM-DD` key. */
export function shiftDateKey(key: string, days: number): string {
  return new Date(dateKeyToUtc(key) + days * MS_PER_DAY).toISOString().slice(0, 10)
}

/** Whole days from `from` to `to`. Negative when `to` precedes `from`. */
export function daysBetween(from: string, to: string): number {
  return Math.round((dateKeyToUtc(to) - dateKeyToUtc(from)) / MS_PER_DAY)
}

/**
 * Every run of more than {@link COVERAGE_GAP_DAYS} consecutive days with no
 * transaction, between `coverageFrom` and `today` inclusive.
 *
 * Pure, and exported so the heuristic can be tested exhaustively without a
 * database. `dateKeys` need be neither sorted nor unique.
 *
 * Three kinds of gap, and all three matter:
 *
 * - **leading** - `coverageFrom` is earlier than the first transaction. This is
 *   the cutover-to-first-feed-row hole the file importer exists to fill.
 *   Reported whether or not it exceeds the threshold, because a bounded,
 *   deliberate hole at the start of the record is exactly the one somebody is
 *   about to import statements for.
 * - **interior** - two transactions more than the threshold apart.
 * - **trailing** - nothing since more than the threshold ago, which is what a
 *   silently dead feed looks like from the ledger's side.
 *
 * Returns `[]` when `coverageFrom` is null (nothing is known, so nothing can be
 * missing) and, when there are no transactions at all, one gap spanning the
 * whole window.
 */
export function computeCoverageGaps(params: {
  dateKeys: readonly string[]
  coverageFrom: string | null
  today: string
  maxGapDays?: number
}): CoverageGap[] {
  const { coverageFrom, today, maxGapDays = COVERAGE_GAP_DAYS } = params
  if (!coverageFrom) return []
  if (daysBetween(coverageFrom, today) < 0) return []

  const within = [...new Set(params.dateKeys)]
    .filter((key) => daysBetween(coverageFrom, key) >= 0 && daysBetween(key, today) >= 0)
    .sort()

  if (within.length === 0) return [{ from: coverageFrom, to: today }]

  const gaps: CoverageGap[] = []

  // Leading: reported at ANY width. `coverageFrom` is a claim that the record
  // starts there, so a week of nothing after it is the hole to import, not noise.
  const firstKey = within[0]!
  if (daysBetween(coverageFrom, firstKey) > 0) {
    gaps.push({ from: coverageFrom, to: shiftDateKey(firstKey, -1) })
  }

  for (let i = 1; i < within.length; i++) {
    const previous = within[i - 1]!
    const current = within[i]!
    if (daysBetween(previous, current) > maxGapDays) {
      gaps.push({ from: shiftDateKey(previous, 1), to: shiftDateKey(current, -1) })
    }
  }

  const lastKey = within[within.length - 1]!
  if (daysBetween(lastKey, today) > maxGapDays) {
    gaps.push({ from: shiftDateKey(lastKey, 1), to: today })
  }

  return gaps
}

/**
 * Fold the derived gaps together with the ones stored on the record, dropping
 * anything fully contained in another.
 *
 * The stored list wins on overlap because it is testimony ("we imported January
 * and it really was empty") and the derived list is inference.
 */
export function mergeCoverageGaps(
  stored: readonly CoverageGap[],
  derived: readonly CoverageGap[]
): CoverageGap[] {
  const all = [...stored, ...derived]
    .filter((gap) => gap?.from && gap?.to && daysBetween(gap.from, gap.to) >= 0)
    .sort((a, b) =>
      a.from === b.from
        ? daysBetween(b.from, b.to) - daysBetween(a.from, a.to)
        : a.from < b.from
          ? -1
          : 1
    )

  const kept: CoverageGap[] = []
  for (const gap of all) {
    const covered = kept.some(
      (existing) =>
        daysBetween(existing.from, gap.from) >= 0 && daysBetween(gap.to, existing.to) >= 0
    )
    if (!covered) kept.push(gap)
  }
  return kept
}

/** Narrow an unknown option value to a {@link BankAccountType}. */
export function resolveBankAccountType(value: string | null | undefined): BankAccountType {
  return value === 'credit' ? 'credit' : 'depository'
}

/** Narrow an unknown option value to a {@link BankAccountStatus}. */
export function resolveBankAccountStatus(value: string | null | undefined): BankAccountStatus {
  return value === 'connected' || value === 'disconnected' ? value : 'manual'
}

/**
 * A `bank_account` row plus, when it has one, the live health of the
 * `DataConnector` that feeds it.
 *
 * 🛑 The connector half is READ THROUGH, never copied onto the record (decision
 * **B4**). One connector is one account and one credential is one bank LOGIN, so
 * two accounts at the same bank hold two connector ids and share a credential.
 */
export interface BankAccountRow {
  id: string
  recordId: string
  name: string | null
  institution: string | null
  last4: string | null
  type: BankAccountType
  currency: string | null
  /** The `gl_account` instance id this account maps to (task 15 §4). No foreign key. */
  glAccountId: string | null
  feedStartDate: string | null
  coverageFrom: string | null
  coverageGaps: CoverageGap[]
  connectorId: string | null
  status: BankAccountStatus
  /**
   * 🛑 The write-once high-water mark: `true` once any line on this account has
   * produced a journal entry, and NOTHING ever clears it - not `undoReview`, not
   * a reversal, not `reverseImport`. It is the ONLY term in the removal gate
   * (`resolveRemoval`): false deletes, true archives
   * (plans/bank-connection/08-removing-a-bank-account.md §5.1).
   */
  hasEverPosted: boolean
  /** When this account was archived, or null while it is live. */
  archivedAt: Date | null
  createdAt: Date | null
  /** Null for a manual account, or when the connector row has gone. */
  connector: BankConnectorHealth | null
}

/**
 * What the removal gate and the confirm dialog both read
 * (plans/bank-connection/08-removing-a-bank-account.md §7.1).
 *
 * 🛑 **Only {@link BankAccountRemovalFacts.hasEverPosted} decides.** Everything
 * else on this shape is there so the dialog can say what a delete would take
 * with it, and none of it is allowed to change the verb.
 */
export interface BankAccountRemovalFacts {
  /**
   * 🛑 The write-once high-water mark, read straight off
   * `bank_account_has_posted`. The ONLY term in the gate.
   */
  hasEverPosted: boolean
  /** For the dialog: how much a delete would take with it. Never decides. */
  transactionCount: number
  /** Lines matched to a document. A delete removes them, deliberately (§5.1). */
  matchedCount: number
  /** `for_review` + `suggested`. An archive bulk-excludes these (§6). */
  unreviewedCount: number
  connectorId: string | null
  /** Rules naming this account, in either field. A WARNING, never a blocker. */
  rules: { id: string; name: string }[]
}

/** What removing a bank account actually does. Never a third option. */
export type RemovalVerb = 'delete' | 'archive'

/** {@link resolveRemoval}'s answer: the verb, what it costs, and what it breaks. */
export interface BankAccountRemovalPlan {
  verb: RemovalVerb
  /** What a delete would destroy. Zeroed for an archive, which destroys nothing. */
  cascade: { transactions: number; matched: number; releasesAtStripe: boolean }
  /** How many unreviewed lines an archive would bulk-exclude (§6). */
  unreviewed: number
  /** Rules a delete would leave inert. Never blocks. */
  warnings: { id: string; name: string }[]
}

/** The `DataConnector` columns a bank account's settings row renders. */
export interface BankConnectorHealth {
  id: string
  name: string
  /** The raw `dataConnectorStatus` value; `resolveSyncStatus` maps it in the UI. */
  status: string
  lastSyncedAt: Date | null
  lastWebhookEventAt: Date | null
  itemCount: number
  error: string | null
}

/** What `readCoverage` answers. */
export interface BankAccountCoverage {
  bankAccountId: string
  /** Earliest date the account holds data for, derived unless stored. */
  coverageFrom: string | null
  /** The day the answer was computed for, so a cached response is legible. */
  asOf: string
  /** How many `bank_transaction` rows the derivation saw. */
  transactionCount: number
  /** What the record says, verbatim. */
  storedGaps: CoverageGap[]
  /** What the transactions imply, per {@link computeCoverageGaps}. */
  derivedGaps: CoverageGap[]
  /** {@link mergeCoverageGaps} of the two - what the UI renders. */
  gaps: CoverageGap[]
}

/**
 * The connect surface's contract, re-exported as a TYPE only.
 *
 * `export type` is erased at build time, so this pulls no runtime module into the
 * browser bundle even though `feed/actions.ts` reaches Drizzle and the Stripe SDK.
 */
export type { BankConnectionStart } from './feed/actions'
// ── The Stripe Financial Connections feed (HANDOFF slot 3A) ───────────────────
//
// `normalizeMatchKey` is pure and dependency-free, and the review queue's browser code
// needs it to preview what a rule would group. It is re-exported here rather than
// reached through `banking/feed`, whose barrel pulls the Stripe SDK and the connector
// engine (`docs/lib-module-guide.md` §7).
export { normalizeMatchKey } from './feed/match-key'
