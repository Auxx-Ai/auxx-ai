// packages/lib/src/banking/review/client.ts

/**
 * The client-safe half of the bank review queue: the vocabularies, the read
 * models, and the pure arithmetic the candidate window and the code entry are
 * built from (`docs/lib-module-guide.md` §7).
 *
 * Imports nothing server-only and carries no `'use client'` directive - server
 * code imports this file too, and the directive would turn every export into a
 * client-reference proxy there.
 *
 * ⚠️ Browser code imports `@auxx/lib/banking/review/client`, never
 * `@auxx/lib/banking/review`. The barrel reaches Drizzle, the org cache and the
 * poster.
 */

import { daysBetween } from '../client'

/** What a human has decided about a line. Mirrors `BANK_TRANSACTION_REVIEW_STATUS_OPTIONS`. */
export const REVIEW_STATUSES = ['for_review', 'suggested', 'matched', 'coded', 'excluded'] as const
export type ReviewStatus = (typeof REVIEW_STATUSES)[number]

/** What the BANK says. Mirrors `BANK_TRANSACTION_BANK_STATUS_OPTIONS`. */
export const BANK_STATUSES = ['pending', 'posted', 'void'] as const
export type BankStatus = (typeof BANK_STATUSES)[number]

/** The queue's state filter: the five statuses plus "everything". */
export const REVIEW_QUEUE_STATES = [...REVIEW_STATUSES, 'all'] as const
export type ReviewQueueState = (typeof REVIEW_QUEUE_STATES)[number]

export const REVIEW_STATUS_LABELS: Record<ReviewStatus, string> = {
  for_review: 'For review',
  suggested: 'Suggested',
  matched: 'Matched',
  coded: 'Coded',
  excluded: 'Excluded',
}

/**
 * The four documents a bank line can corroborate, plus the fifth pointer a
 * transfer uses.
 *
 * 🛑 `bank_transaction` is in this list because a transfer's two legs match
 * EACH OTHER (03 §3.3). It is not a document, and `matchTransaction` refuses it
 * - only `transferTransaction` may write it, because a transfer also has to
 * post the one cash-to-cash entry that a document match must never post.
 */
export const MATCH_RECORD_TYPES = [
  'vendor_payment',
  'payment_transaction',
  'bank_deposit',
  'vendor_bill',
  'bank_transaction',
] as const
export type MatchRecordType = (typeof MATCH_RECORD_TYPES)[number]

/** The four a person may pick in the match panel. */
export const MATCHABLE_RECORD_TYPES = MATCH_RECORD_TYPES.filter(
  (type) => type !== 'bank_transaction'
) as readonly Exclude<MatchRecordType, 'bank_transaction'>[]

/**
 * The fifth pointer, and it is not a document.
 *
 * 🛑 A transfer whose counterpart has not arrived yet stamps the counterpart
 * ACCOUNT into `matchedRecordId` so the leg that turns up later can be
 * recognised, with `matchedRecordType: 'bank_account'`. It is stored but never
 * OFFERED: `matchTransaction` takes a {@link MatchRecordType}, and
 * `MATCHABLE_RECORD_TYPES` is what the panel and the router accept.
 *
 * ⚠️ It has to be in the READ vocabulary all the same. Narrowing it away on read
 * turned every stranded first leg into `matchedRecordType: null`, which is
 * exactly the row {@link isLinkableTransferLeg} has to find - so the late leg
 * posted a second entry for the same movement.
 */
export const MATCHED_RECORD_TYPES = [...MATCH_RECORD_TYPES, 'bank_account'] as const

/** What `bank_transaction.matchedRecordType` may actually hold. */
export type MatchedRecordType = (typeof MATCHED_RECORD_TYPES)[number]

export const MATCH_RECORD_TYPE_LABELS: Record<MatchRecordType, string> = {
  vendor_payment: 'Vendor payment',
  payment_transaction: 'Customer payment',
  bank_deposit: 'Bank deposit',
  vendor_bill: 'Vendor bill',
  bank_transaction: 'Bank line',
}

/**
 * Labels for every type `matchedRecordType` can actually READ BACK as, which is
 * one more than the panel offers.
 *
 * Kept separate from {@link MATCH_RECORD_TYPE_LABELS} rather than widened:
 * that one is the candidate picker's vocabulary and must stay exactly the set a
 * person may choose. This one is the settled row's vocabulary, and it has to
 * cover `bank_account`, because a transfer whose counterpart has not arrived
 * yet reads back that way and a screen that cannot name it renders a bare cuid.
 */
export const MATCHED_RECORD_TYPE_LABELS: Record<MatchedRecordType, string> = {
  ...MATCH_RECORD_TYPE_LABELS,
  bank_account: 'Transfer, waiting for the other side',
}

/** `sourceType` on every line a coded or transferred bank entry writes. */
export const BANK_TRANSACTION_SOURCE_TYPE = 'bank_transaction'

/**
 * How many days either side of the bank line a candidate document may sit.
 *
 * Three, and it is the same three the transfer detector uses. A cheque banked
 * on Friday clears on Monday; a wire raised on the 30th lands on the 1st. Wider
 * than a week and a monthly rent payment matches the previous month's.
 */
export const CANDIDATE_DAY_WINDOW = 3

/**
 * How far a candidate's amount may sit from the bank line's, as a fraction.
 *
 * One percent, so a $1,000 payment matches at $990 to $1,010 - enough for a
 * wire fee deducted in transit, not enough for two different invoices to the
 * same vendor to both look right. Compared on the ABSOLUTE value of the bank
 * line, because `amountMinor` is the one signed money column in the books.
 */
export const CANDIDATE_AMOUNT_TOLERANCE = 0.01

/** `'in'` for money arriving, `'out'` for money leaving. Never a sign. */
export type BankLineFlow = 'in' | 'out'

/**
 * Which way the money went.
 *
 * 🛑 Zero is `'in'` by fiat rather than a third case. A zero-amount bank line is
 * a bank artefact (a reversed authorisation, a $0 fee waiver) and nothing can
 * be posted for it - `buildBankTransactionEntry` refuses it by amount before
 * this answer is ever used - so the value only has to be total, not meaningful.
 */
export function bankLineFlow(amountMinor: number): BankLineFlow {
  return amountMinor < 0 ? 'out' : 'in'
}

/** Whether a candidate's date is inside the window around the bank line's. */
export function isWithinCandidateWindow(
  bankDateKey: string,
  candidateDateKey: string | null,
  windowDays: number = CANDIDATE_DAY_WINDOW
): boolean {
  if (!candidateDateKey) return false
  const delta = daysBetween(bankDateKey, candidateDateKey)
  return Number.isFinite(delta) && Math.abs(delta) <= windowDays
}

/**
 * Whether a candidate's amount is inside the tolerance around the bank line's.
 *
 * Both figures are UNSIGNED minor units: the caller has already taken the bank
 * line's absolute value and picked the candidates whose direction agrees. A
 * signed comparison here would silently match a $500 refund to a $500 charge.
 *
 * ⚠️ The tolerance is rounded UP to whole cents, so a small line is compared
 * exactly rather than against a fractional cent that no amount can hit: 1% of
 * $1.00 is one cent, and 1% of $0.50 rounds to one cent rather than to zero.
 */
export function isWithinAmountTolerance(
  bankAbsMinor: number,
  candidateAbsMinor: number,
  tolerance: number = CANDIDATE_AMOUNT_TOLERANCE
): boolean {
  if (!Number.isFinite(bankAbsMinor) || !Number.isFinite(candidateAbsMinor)) return false
  const allowed = Math.max(1, Math.ceil(Math.abs(bankAbsMinor) * tolerance))
  return Math.abs(Math.abs(bankAbsMinor) - Math.abs(candidateAbsMinor)) <= allowed
}

/**
 * How good a candidate looks, 0 to 1. Presentation only, never a threshold.
 *
 * An exact amount on the exact day is 1. The amount carries more weight than
 * the date because two documents on one day are common and two documents for
 * the same cent are not. Nothing auto-applies on this number: the ordering of a
 * list a person is reading is all it decides.
 */
export function scoreCandidate(params: {
  bankAbsMinor: number
  candidateAbsMinor: number
  bankDateKey: string
  candidateDateKey: string | null
}): number {
  const { bankAbsMinor, candidateAbsMinor, bankDateKey, candidateDateKey } = params
  const spread = Math.abs(Math.abs(bankAbsMinor) - Math.abs(candidateAbsMinor))
  const amountScore =
    spread === 0 ? 1 : Math.max(0, 1 - spread / Math.max(1, Math.abs(bankAbsMinor)))
  const days = candidateDateKey ? Math.abs(daysBetween(bankDateKey, candidateDateKey)) : 99
  const dateScore = Math.max(0, 1 - days / (CANDIDATE_DAY_WINDOW + 1))
  return Math.round((amountScore * 0.7 + dateScore * 0.3) * 100) / 100
}

/** The three-letter prefix a minted bank-transaction period key carries. */
export const BANK_PERIOD_KEY_PREFIX = 'BNK'

/**
 * `AUXX-BNK-` is nine characters and a reversal adds `-R9`, so nine are left
 * for the compacted key. `doc-number.ts`'s cap, restated as the budget this
 * file has to mint inside.
 */
const MAX_COMPACT_PERIOD_KEY = 21 - 'AUXX-BNK-'.length - '-R9'.length

/**
 * How many base-36 characters of the compact key belong to the ACCOUNT.
 *
 * 🛑 An OFX `FITID` is unique PER ACCOUNT, never per institution and never per
 * org - which is why the parser reports `duplicateFitIds` per file. Two accounts
 * at one bank sharing a FITID would otherwise mint the same period tuple, the
 * second `postEntry` would answer `already_posted` (a SUCCESS), and the second
 * bank line would be stamped with the FIRST line's posting id: one entry for two
 * transactions, and it balances.
 *
 * Three characters is 46,656 buckets, so two accounts of one org colliding here
 * AND sharing a FITID is not a case that occurs; and the fallback (a hash of the
 * row's own id) is unique outright, so an over-long external id is always safe.
 *
 * ⚠️ It costs the shortcut most of its reach: nine characters minus three leaves
 * SIX for the compacted external id, so a real OFX `FITID` (routinely twelve to
 * thirty) takes the hash path, as it already did. What still comes through is
 * the short hand-keyed reference - a cheque number, `TXN123` - which is where
 * reading the ledger against the statement actually pays.
 */
const ACCOUNT_SCOPE_CHARS = 3

/** 36 retries, which is what one base-36 character of the key budget holds. */
export const MAX_PERIOD_KEY_ATTEMPT = 35

/**
 * Mint the period key for one bank line.
 *
 * ## Why the external id first and a hash second
 *
 * `periodKey` is what `buildDocNumber` keys the document number on, and a
 * document number is a natural key a bookkeeper reads in the register. When the
 * provider's own id is short enough to fit - an imported OFX `FITID`, a
 * hand-keyed reference - carrying it through means the ledger row and the
 * statement line share a string, which is exactly what reconciliation is.
 *
 * A Stripe FC id (`fctxn_1LXp9RGxLVUXRs6HtTSVfxse`) is far over the cap, so the
 * fallback mints `BNK-<6 base36>` from an FNV-1a hash of the row's own id, the
 * same shape and for the same reason as `paymentPeriodKey`: a counted sequence
 * is the one alternative that is actively dangerous, because two concurrent
 * lines minting one key converge the loser to `already_posted`, a SUCCESS, and
 * two bank lines silently become one entry.
 *
 * 🛑 Hyphens are the only separator `buildDocNumber` strips, so an external id
 * carrying anything else (`fctxn_…`'s underscore) is rejected here rather than
 * passed through to become an over-length or non-alphanumeric document number.
 */
export function bankTransactionPeriodKey(params: {
  transactionId: string
  externalId?: string | null
  /**
   * The `bank_account` the line sits on. **Required for the external-id
   * shortcut**, which is skipped without it - see {@link ACCOUNT_SCOPE_CHARS}.
   */
  bankAccountId?: string | null
  /**
   * How many postings this line has already produced.
   *
   * 🛑 **Without this a line can be coded exactly once, ever.** The period key
   * is a function of the row, so re-coding after an undo re-claims the tuple the
   * reversed original still holds and `postEntry` answers `already_posted` - a
   * SUCCESS - handing back the REVERSED posting's id. The line would then read
   * `coded` while pointing at an entry that has been backed out.
   *
   * So a retry mints a different key. The caller passes the count of postings
   * already filed against this line (original plus reversal is 2), and the key
   * carries it, which also makes the document numbers of a corrected line read
   * in order in the register.
   */
  attempt?: number
}): string {
  const attempt = params.attempt ?? 0
  if (!Number.isInteger(attempt) || attempt < 0) {
    throw new Error(`A bank transaction period key attempt must be a whole number, got ${attempt}`)
  }
  if (attempt > MAX_PERIOD_KEY_ATTEMPT) {
    throw new Error(
      `This bank line has been posted and reversed ${attempt} times, which is more than the ` +
        'document-number keyspace can hold. Correct it with a manual journal entry instead.'
    )
  }

  const external = params.externalId?.trim() ?? ''
  const account = params.bankAccountId?.trim() ?? ''
  if (attempt === 0 && external && account && /^[A-Za-z0-9-]+$/.test(external)) {
    const compact = external.replace(/-/g, '').toUpperCase()
    const scope = fold36(account, ACCOUNT_SCOPE_CHARS)
    if (compact.length > 0 && compact.length + scope.length <= MAX_COMPACT_PERIOD_KEY) {
      return `${compact}${scope}`
    }
  }

  const id = params.transactionId.trim()
  if (!id) throw new Error('A bank transaction entry needs the row id to key on')
  // Six digits for a first posting, five plus the attempt for a retry: both
  // compact to nine, which is the whole budget `AUXX-BNK-…-R9` leaves. Folded
  // with a modulus rather than sliced, so all 32 bits reach the digits that
  // survive.
  if (attempt === 0) {
    return `${BANK_PERIOD_KEY_PREFIX}-${fold36(id, 6)}`
  }
  return `${BANK_PERIOD_KEY_PREFIX}-${fold36(id, 5)}${attempt.toString(36).toUpperCase()}`
}

/**
 * FNV-1a, 32 bit, folded into `width` base-36 characters.
 *
 * A keyspace, not a secret, and a pure function beats importing node:crypto into
 * a file that has to stay client-safe. Folded with a modulus rather than sliced,
 * so all 32 bits reach the digits that survive.
 */
function fold36(value: string, width: number): string {
  let hash = 0x811c9dc5
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return (hash % 36 ** width).toString(36).toUpperCase().padStart(width, '0')
}

/** One bank line, as every review surface reads it. */
export interface BankTransactionRow {
  id: string
  recordId: string
  externalId: string | null
  bankAccountId: string | null
  bankAccountName: string | null
  /** The bank account's mapped GL code. The other half of every coded entry. */
  bankAccountCode: string | null
  /**
   * The `DataConnector` behind the account, or null for a manual one.
   *
   * Carried so a posted line can be pinned against the feed without a second
   * read of the account. Null is the ordinary case for an imported statement,
   * and pinning is then a no-op: there is no feed to protect the row from.
   */
  bankAccountConnectorId: string | null
  /** `YYYY-MM-DD`. THE accounting date, and the posting's `txnDate`. */
  postedAt: string | null
  description: string | null
  /** Integer minor units, SIGNED - negative is money out. */
  amountMinor: number
  bankStatus: BankStatus
  matchKey: string | null
  source: string | null
  importBatchId: string | null
  reviewStatus: ReviewStatus
  glAccountCode: string | null
  matchedRecordId: string | null
  /** Includes `bank_account` - see {@link MATCHED_RECORD_TYPES}. */
  matchedRecordType: MatchedRecordType | null
  excludeReason: string | null
  reviewedAt: Date | null
  reviewedByUserId: string | null
  glPostingId: string | null
  ruleId: string | null
  /** 3C's stored suggestion, or null when 3C has not landed its fields. */
  suggestedGlAccount: string | null
  suggestionReason: string | null
  createdAt: Date | null
}

/** What the stat strip renders. Every figure is unsigned minor units. */
export interface ReviewQueueStats {
  /** Lines still in `for_review`. The number on the tab. */
  forReviewCount: number
  /** Lines in `for_review` or `suggested`, which is what "unreviewed" means. */
  unreviewedCount: number
  /** `YYYY-MM-DD` of the oldest unreviewed line, or null when there is none. */
  oldestUnreviewedDate: string | null
  /** Unreviewed money arriving, unsigned. */
  unreviewedInMinor: number
  /** Unreviewed money leaving, unsigned. */
  unreviewedOutMinor: number
  /** The selected account's coverage floor, or null when no one account is selected. */
  coverageFrom: string | null
  /** How many gaps that account's coverage record reports. */
  coverageGapCount: number
}

/** One thing a bank line might be. */
export interface MatchCandidate {
  recordType: MatchRecordType
  recordId: string
  /** What the person reads - `VP-0007`, `DEP-0001`, `Check 1042`. */
  label: string
  /** The line beneath it - the vendor, the invoice, the method. */
  secondary: string | null
  /** `YYYY-MM-DD` of the document's own date. */
  dateKey: string | null
  /** Integer minor units, UNSIGNED. Direction is implied by the source. */
  amountMinor: number
  /** 0 to 1, {@link scoreCandidate}. Ordering only. */
  score: number
  /** The bank line it is already matched to, or null. A matched candidate is shown, disabled. */
  matchedToBankTransactionId: string | null
}

/** One row of the drawer's history section. */
export interface ReviewHistoryEntry {
  /** A short machine key - `matched`, `coded`, `excluded`, `posted`, `imported`. */
  kind: string
  label: string
  detail: string | null
  at: Date | null
  /** The `GlPosting` this row points at, when it has one. */
  glPostingId?: string | null
  docNumber?: string | null
}

/**
 * Is `candidate` the other half of `line`'s transfer?
 *
 * ⚠️ **Exact on the amount, not within {@link CANDIDATE_AMOUNT_TOLERANCE}.** A
 * transfer between two accounts we own is one movement seen twice, so the two
 * figures agree to the cent unless a fee was taken in transit - and a fee makes
 * it two events, not one, so the near-miss belongs in front of a person rather
 * than being paired up automatically.
 *
 * A void candidate is never a leg: the bank withdrew it, so no money moved. Nor
 * is a line somebody has already dealt with, because pairing it would silently
 * undo their decision.
 */
export function isOppositeLeg(
  line: Pick<BankTransactionRow, 'id' | 'amountMinor' | 'postedAt'>,
  candidate: Pick<
    BankTransactionRow,
    'id' | 'amountMinor' | 'postedAt' | 'bankStatus' | 'reviewStatus'
  >,
  windowDays: number = CANDIDATE_DAY_WINDOW
): boolean {
  if (!line.postedAt) return false
  if (candidate.id === line.id) return false
  if (candidate.bankStatus === 'void') return false
  if (candidate.reviewStatus !== 'for_review' && candidate.reviewStatus !== 'suggested')
    return false
  if (line.amountMinor === 0) return false
  if (candidate.amountMinor !== -line.amountMinor) return false
  return isWithinCandidateWindow(line.postedAt, candidate.postedAt, windowDays)
}

/**
 * The opposite leg to pair with, or `null`.
 *
 * ⚠️ Ties break on the closest date, then the smallest id, so the answer is
 * deterministic. Two identical transfers on one day between the same pair of
 * accounts would otherwise pair up differently on every call, and the second
 * pairing would contradict the first.
 */
export function pickOppositeLeg<
  T extends Pick<
    BankTransactionRow,
    'id' | 'amountMinor' | 'postedAt' | 'bankStatus' | 'reviewStatus'
  >,
>(
  line: Pick<BankTransactionRow, 'id' | 'amountMinor' | 'postedAt'>,
  candidates: readonly T[],
  windowDays: number = CANDIDATE_DAY_WINDOW
): T | null {
  const matches = candidates.filter((candidate) => isOppositeLeg(line, candidate, windowDays))
  return closestFirst(line.postedAt ?? '', matches)
}

/**
 * Is `candidate` the leg of this transfer that ALREADY POSTED, waiting to be
 * linked?
 *
 * 🛑 **This is what stops a transfer being posted twice.** When the counterpart
 * has not arrived yet, `transferTransaction` posts anyway and stamps the line
 * `coded` with the counterpart ACCOUNT in `matchedRecordId` (see its doc
 * comment). The leg that arrives later can only be offered Transfer - `match`
 * refuses `bank_transaction` and the router does not even accept it - and
 * {@link isOppositeLeg} cannot see the first leg, because it is `coded` rather
 * than waiting. Without this predicate the late leg posts a SECOND cash-to-cash
 * entry for one movement, both entries balance, and nothing detects it.
 *
 * So the four things that identify the stranded first leg are all required: it
 * is `coded`, it carries a posting, it is stamped with THIS line's own account
 * as the counterpart it could not find, and it mirrors the amount inside the
 * window.
 */
export function isLinkableTransferLeg(
  line: Pick<BankTransactionRow, 'id' | 'amountMinor' | 'postedAt' | 'bankAccountId'>,
  candidate: Pick<
    BankTransactionRow,
    | 'id'
    | 'amountMinor'
    | 'postedAt'
    | 'bankStatus'
    | 'reviewStatus'
    | 'matchedRecordId'
    | 'matchedRecordType'
    | 'glPostingId'
  >,
  windowDays: number = CANDIDATE_DAY_WINDOW
): boolean {
  if (!line.postedAt || !line.bankAccountId) return false
  if (candidate.id === line.id) return false
  if (candidate.bankStatus === 'void') return false
  if (candidate.reviewStatus !== 'coded') return false
  if (!candidate.glPostingId) return false
  if (candidate.matchedRecordType !== 'bank_account') return false
  if (candidate.matchedRecordId !== line.bankAccountId) return false
  if (line.amountMinor === 0) return false
  if (candidate.amountMinor !== -line.amountMinor) return false
  return isWithinCandidateWindow(line.postedAt, candidate.postedAt, windowDays)
}

/** The already-posted leg to link to, or `null`. Same tie-break as {@link pickOppositeLeg}. */
export function pickLinkableTransferLeg<
  T extends Pick<
    BankTransactionRow,
    | 'id'
    | 'amountMinor'
    | 'postedAt'
    | 'bankStatus'
    | 'reviewStatus'
    | 'matchedRecordId'
    | 'matchedRecordType'
    | 'glPostingId'
  >,
>(
  line: Pick<BankTransactionRow, 'id' | 'amountMinor' | 'postedAt' | 'bankAccountId'>,
  candidates: readonly T[],
  windowDays: number = CANDIDATE_DAY_WINDOW
): T | null {
  const matches = candidates.filter((candidate) =>
    isLinkableTransferLeg(line, candidate, windowDays)
  )
  return closestFirst(line.postedAt ?? '', matches)
}

/** Closest date to `anchor` first, then the smallest id. Deterministic by construction. */
function closestFirst<T extends { id: string; postedAt: string | null }>(
  anchor: string,
  matches: readonly T[]
): T | null {
  if (matches.length === 0) return null
  return (
    [...matches].sort((a, b) => {
      const aDays = Math.abs(daysBetween(anchor, a.postedAt ?? '')) || 0
      const bDays = Math.abs(daysBetween(anchor, b.postedAt ?? '')) || 0
      return aDays - bDays || a.id.localeCompare(b.id)
    })[0] ?? null
  )
}

/** What a treatment write answers with. */
export interface ReviewOutcome {
  transaction: BankTransactionRow
  /** The ledger's answer, or null for the treatments that post nothing (B5). */
  post: { status: string; error?: string; docNumber?: string; glPostingId?: string } | null
  /** Anything worth saying that is not a refusal - the unmatched transfer leg. */
  warnings: string[]
}
