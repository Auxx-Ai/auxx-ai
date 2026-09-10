// packages/lib/src/postings/duplicate-movements.ts
//
// The duplicate detector (plans/accounting/tasks/18-two-feeds-one-author.md
// §1, DECIDED by MK "no matter what"). One read over the posted ledger: has
// more than one door written the same bank account by the same amount, in the
// same direction, within a few days of each other?
//
// ## The failure this catches
//
// `postPayoutEntry` debits the bank account a payout lands in. If nobody
// matches the resulting bank-feed line to that payout (`readPayoutCandidates`
// is the other half of brief 18 §1, and is not this file), the reviewer's only
// door is to CODE the line - and `codeTransaction` posts a second entry that
// debits the same bank account for the same amount a day or two later. Both
// entries balance. The trial balance balances. Nothing downstream can tell the
// difference between "the payout landed and was coded twice" and "two
// unrelated deposits of the same size arrived two days apart" except a human
// looking at both doc numbers - which is exactly what this read hands them.
//
// This is also what closes the `TODO(brief 13 §2.5)` in `regime.ts`:
// `SINGLE_WRITER_ROLES` could only ever declare a table over ROLES, and a bank
// account is named by `glAccountId`, never a role, since `13` §2 retired
// `cash`. A single-writer guard over bank-account ids would have to be
// declared the same way `findWriterConflicts` is - which posting types may
// write a given bank account - and that table does not exist because nothing
// in this codebase enumerates "every posting type that might touch some
// bank account" the way it enumerates the three inventory roles. Grouping the
// POSTED LINES themselves, by account and amount and direction, answers the
// same question - "is more than one door moving this account by this much" -
// without needing that table at all, and it catches a duplicate a single-writer
// table could not: two different DOCUMENTS of the same enabled type (a payout
// and a manually coded fee) both correctly allowed to write the account, that
// nonetheless collided on one real event.
//
// ## Why grouping by (account, amount, direction) already excludes a reversal
//
// A reversal (decision G4, `reverse-entry.ts`) is a second, opposite entry:
// every line's `direction` is flipped from the line it backs out, and the
// entry it backs out flips to `GlPosting.status = 'reversed'` in the same
// transaction that posts the reversal. So at any moment at most ONE of a
// reversal pair carries `status = 'posted'`, and the one that does has the
// OPPOSITE direction from the one that does not. Filtering to `status =
// 'posted'` and grouping by `direction` therefore never puts a reversal
// pair in the same bucket - there is nothing extra to exclude by revision or
// by `reversesId`.
//
// ## Why a coded `bank_transaction` line needs no second read
//
// Brief 18 §1 asks about "bank-typed `bank_transaction` codings not yet linked
// to an entry" as a possible second shape. Reading `codeTransaction`
// (`banking/review/writes.ts`) settles it: the record's
// `bank_transaction_gl_account` and `bank_transaction_gl_posting_id` fields are
// stamped ONLY when `postEntry` returns a status in `ACCEPTED_POST_STATUSES`
// (`posted`, `already_posted`, `healed`, `not_connected`, `disabled`) - every
// one of which either wrote a `GlPostingLine` or means there was no ledger to
// write to. A refused post (an unmapped account, a locked period) leaves the
// line un-stamped and un-posted. So a coded line with a `gl_account` on it
// ALWAYS has a matching `GlPostingLine`, and the read below already sees it
// through that line. There is no second population of "coded but unposted"
// lines to read separately, and this module does not add one.
//
// No permission checks here. The router asserts (`docs/lib-module-guide.md` §6).

import { type Database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, asc, eq, gte, inArray, lte } from 'drizzle-orm'
import { err, ok, type Result } from 'neverthrow'
import { AuxxError, BadRequestError } from '../errors'
import { GlAccountSubtype } from '../resources/registry/enum-values'
import { parsePeriodKey } from './periods'
import { listChartAccounts } from './role-map'
import type { PostingDirection } from './types'

const logger = createScopedLogger('postings:duplicate-movements')

/** How many days apart two lines may post and still count as "the same event". */
const WINDOW_DAYS = 2
const MS_PER_DAY = 86_400_000

/** One posted line inside a finding - enough to open the posting from a click. */
export interface DuplicateMovementEntry {
  glPostingId: string
  docNumber: string
  /** `'payout'`, `'bank_transaction'` - the two shapes brief 18 §0.2 names. */
  sourceType: string
  /** `YYYY-MM-DD`, as posted. */
  txnDate: string
}

/**
 * Two or more posted lines that moved one bank account by the same amount, in
 * the same direction, from more than one `sourceType`, within
 * {@link WINDOW_DAYS} days of each other.
 *
 * Never resolved automatically (brief 18 §1: "a detector that resolves a
 * duplicate has guessed which one was real"). The remedy is a person choosing
 * to reverse one entry in auxx or delete one in QuickBooks.
 */
export interface DuplicateMovementFinding {
  glAccountId: string
  /** Snapshot of the chart as it reads NOW - a finding is a today question. */
  accountCode: string | null
  accountName: string
  amountMinor: number
  direction: PostingDirection
  /** Two or more, sorted oldest first. */
  entries: DuplicateMovementEntry[]
}

export interface FindDuplicateBankMovementsOptions {
  organizationId: string
  /**
   * `YYYY-MM`. Narrows the read to that month, widened by {@link WINDOW_DAYS}
   * days on each side so a cluster straddling a month boundary is not cut in
   * half. Absent scans every posted line ever written to a bank account.
   */
  month?: string
}

/** One candidate row, as the join returns it. */
interface CandidateLine {
  glPostingId: string
  docNumber: string
  txnDate: string
  glAccountId: string
  amountMinor: number
  direction: PostingDirection
  sourceType: string
}

/**
 * Find every cluster of posted lines that may be the same bank movement
 * recorded twice (plans/accounting/tasks/18-two-feeds-one-author.md §1).
 *
 * **One SQL grouping query, one small in-memory window pass.** The account,
 * amount and direction grouping - and the `status = 'posted'` filter that
 * excludes a reversed original - is done by the WHERE clause and read in one
 * shot; only the "within two days of each other" clustering happens in
 * TypeScript, because expressing a rolling two-day window as a `GROUP BY` would
 * need a self-join or a window function per candidate pair for a query this
 * module runs on close-console page loads, not a monthly close. At roughly
 * thirty postings a month per organization the candidate set this reads is
 * small enough that the in-memory pass costs nothing worth optimising away.
 *
 * Bank accounts are read from {@link listChartAccounts} rather than
 * hardcoded: `subtype: 'bank'` is the chart's own declaration of which
 * accounts a bank feed can land money on (task 15 §5, `13` §3), so an org that
 * has renamed or added a bank account is covered without this file changing.
 */
export async function findDuplicateBankMovements(
  db: Database,
  options: FindDuplicateBankMovementsOptions
): Promise<Result<DuplicateMovementFinding[], Error>> {
  const { organizationId, month } = options

  try {
    const chart = await listChartAccounts(db, organizationId)
    if (chart.isErr()) return err(chart.error)

    const bankAccounts = new Map(
      chart.value
        .filter((account) => account.subtype === GlAccountSubtype.BANK)
        .map((account) => [account.id, account] as const)
    )
    // No bank-typed account in this org's chart - nothing to find, and no
    // point building a query with an empty `IN ()`.
    if (bankAccounts.size === 0) return ok([])

    const conditions = [
      eq(schema.GlPosting.organizationId, organizationId),
      // Excludes a reversed ORIGINAL - see the file header on why that is the
      // whole of what excluding a reversal pair takes.
      eq(schema.GlPosting.status, 'posted'),
      inArray(schema.GlPostingLine.glAccountId, [...bankAccounts.keys()]),
    ]

    if (month) {
      const window = monthWindow(month)
      conditions.push(gte(schema.GlPosting.txnDate, window.from))
      conditions.push(lte(schema.GlPosting.txnDate, window.to))
    }

    const rows: CandidateLine[] = await db
      .select({
        glPostingId: schema.GlPosting.id,
        docNumber: schema.GlPosting.docNumber,
        txnDate: schema.GlPosting.txnDate,
        glAccountId: schema.GlPostingLine.glAccountId,
        amountMinor: schema.GlPostingLine.amountMinor,
        direction: schema.GlPostingLine.direction,
        sourceType: schema.GlPostingLine.sourceType,
      })
      .from(schema.GlPostingLine)
      .innerJoin(schema.GlPosting, eq(schema.GlPosting.id, schema.GlPostingLine.glPostingId))
      .where(and(...conditions))
      .orderBy(asc(schema.GlPosting.txnDate))

    const findings: DuplicateMovementFinding[] = []
    for (const group of groupByAccountAmountDirection(rows)) {
      for (const cluster of clusterByWindow(group)) {
        const sourceTypes = new Set(cluster.map((row) => row.sourceType))
        // The `sourceType` guard: two lines from the SAME door (two ordinary
        // same-day deposits from one connector) are not a duplicate, they are
        // two events that happen to be the same size.
        if (sourceTypes.size < 2) continue

        const first = cluster[0]
        if (!first) continue
        const account = bankAccounts.get(first.glAccountId)
        if (!account) continue

        findings.push({
          glAccountId: first.glAccountId,
          accountCode: account.code,
          accountName: account.name,
          amountMinor: first.amountMinor,
          direction: first.direction,
          entries: cluster.map((row) => ({
            glPostingId: row.glPostingId,
            docNumber: row.docNumber,
            sourceType: row.sourceType,
            txnDate: row.txnDate,
          })),
        })
      }
    }

    return ok(findings)
  } catch (error) {
    if (error instanceof AuxxError) return err(error)
    logger.error('Failed to find duplicate bank movements', { error, organizationId })
    return err(new AuxxError('Internal error'))
  }
}

/** Bucket rows sharing one (account, amount, direction) key. Order preserved. */
function groupByAccountAmountDirection(rows: CandidateLine[]): CandidateLine[][] {
  const groups = new Map<string, CandidateLine[]>()
  for (const row of rows) {
    const key = `${row.glAccountId} ${row.amountMinor} ${row.direction}`
    const bucket = groups.get(key)
    if (bucket) bucket.push(row)
    else groups.set(key, [row])
  }
  return [...groups.values()]
}

/**
 * Split one (account, amount, direction) group, already sorted by `txnDate`,
 * into runs where each row is within {@link WINDOW_DAYS} days of the row
 * before it.
 *
 * A chained window rather than an all-pairs comparison: three deposits nine
 * days apart each from the next are three separate events even though the
 * first and third are eighteen days apart, but two events four days apart with
 * one two days from each of them are plausibly one story told twice. Chaining
 * is the cheap approximation of that and matches every case brief 18 §1 names.
 */
function clusterByWindow(sorted: CandidateLine[]): CandidateLine[][] {
  const clusters: CandidateLine[][] = []
  let current: CandidateLine[] = []

  for (const row of sorted) {
    const prev = current.at(-1)
    if (prev && daysBetween(prev.txnDate, row.txnDate) > WINDOW_DAYS) {
      clusters.push(current)
      current = []
    }
    current.push(row)
  }
  if (current.length > 0) clusters.push(current)

  return clusters
}

function daysBetween(a: string, b: string): number {
  return Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / MS_PER_DAY
}

/** `'2026-08'` widened by {@link WINDOW_DAYS} days on each side, as date keys. */
function monthWindow(month: string): { from: string; to: string } {
  const parsed = parsePeriodKey(month)
  if (parsed.granularity !== 'month') {
    throw new BadRequestError(`Expected a YYYY-MM month, got "${month}"`, { month })
  }

  const start = new Date(Date.UTC(parsed.year, parsed.month - 1, 1))
  start.setUTCDate(start.getUTCDate() - WINDOW_DAYS)

  // Day 0 of the NEXT month index is the last day of this one.
  const end = new Date(Date.UTC(parsed.year, parsed.month, 0))
  end.setUTCDate(end.getUTCDate() + WINDOW_DAYS)

  return { from: toDateKey(start), to: toDateKey(end) }
}

function toDateKey(date: Date): string {
  return date.toISOString().slice(0, 10)
}
