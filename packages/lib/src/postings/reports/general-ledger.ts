// packages/lib/src/postings/reports/general-ledger.ts
//
// Every posted line in a date range, grouped by account. The sixth statement.
//
// ## Why this exists, when `account-lines.ts` already reads one account
//
// Because a filing accountant asks for the general ledger FIRST, and today it
// is the one report that exists in no form at all. `readAccountLines` answers
// "show me this account" from a drill-down dialog; producing a general ledger
// out of it means opening that dialog once per account and copying each one
// out of the browser by hand.
//
// This is the same query without the `glAccountId` filter, grouped. The shapes
// below deliberately mirror `AccountLines` / `AccountLineRow` so that the two
// stay recognisably the same report at two zoom levels.
//
// ## 🛑 The one way this report is unlike the other five
//
// Every other statement is bounded by the CHART: a trial balance has as many
// rows as the org has accounts. **A general ledger is bounded by TRANSACTION
// VOLUME**, and a year of a real company's is tens of thousands of lines.
// `toCsvRows` (`reports/rows.ts`) materialises the whole array and the PDF path
// is worse.
//
// `listPostings` hit this same wall and answered it with a hard cap of 200
// (`list-postings.ts:47`). **That is exactly the wrong answer here**: a
// truncated general ledger does not tie to the trial balance, and the
// accountant reading it has no way to know why. Chunk the range or stream;
// never silently cap. {@link GeneralLedger.truncated} is how a caller that
// cannot finish says so out loud.
//
// @see plans/accounting/tasks/21-the-books-stand-alone.md §5

import { type Database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, asc, eq, gte, inArray, lte, sql } from 'drizzle-orm'
import { err, ok, type Result } from 'neverthrow'
import { AuxxError, UnprocessableEntityError } from '../../errors'
import { compareAccountsByCodeThenName } from '../account-label'
import { GL_ACCOUNT_TYPES, type GlAccountTypeValue } from '../default-chart'
import { listChartAccounts } from '../role-map'
import type { ChartAccountRow, PostingDirection } from '../types'
import type { AccountLineRow } from './account-lines'
import { previousCalendarDay } from './fiscal-year'
import { NATURAL_BALANCE_DIRECTION, signedBalance } from './statement-math'

const logger = createScopedLogger('postings:reports:general-ledger')

/** Only a posted entry counts - `verify-balance.ts` says why `pending`/`failed` do not. */
const POSTED_STATUSES = ['posted', 'reversed'] as const

/**
 * Statement order (asset, liability, equity, revenue, expense) as a rank map -
 * the trial balance's own 15.2 sort, so the two reports list the same accounts
 * in the same order and an accountant can read them side by side.
 */
const STATEMENT_ORDER = new Map(GL_ACCOUNT_TYPES.map((type, index) => [type, index]))

const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/

/**
 * 🛑 The router's size guard, and the number the PDF render uses too, so the
 * page, the CSV and the PDF can never stop at three different places.
 *
 * ~25,000 lines is roughly 6,000 postings at four lines each: a company
 * posting 500 entries a month reads a FULL YEAR under it and never sees the
 * flag, while a busy shop asking for a year gets a ledger that stops - loudly -
 * instead of a request that eats the process. It is a safety valve on the
 * server, deliberately NOT a client input: a cap a caller can raise is not a
 * cap.
 */
export const GENERAL_LEDGER_MAX_LINES = 25_000

/**
 * One account's section of the ledger: the account, where it started, every
 * posted line in the range, and where it ended.
 *
 * `lines` reuses {@link AccountLineRow} unchanged - same fields, same
 * natural-sign `runningBalanceMinor` applied line by line - so a reader who
 * knows the drill-down knows this.
 */
export interface GeneralLedgerAccount {
  /** The `gl_account` `EntityInstance` id. The IDENTITY (task 15), never a code. */
  glAccountId: string
  /** The account's CURRENT code, read from the live chart by id. `null` when deleted or code-less. */
  accountCode: string | null
  /** `''` when the account has been deleted from this org's chart. */
  accountName: string
  /** `null` when the account has been deleted - the running balance is then unsigned. */
  accountType: GlAccountTypeValue | null
  /** The natural-sign balance immediately before `from`, carried into `lines[0].runningBalanceMinor`. */
  openingBalanceMinor: number
  /** Oldest first. */
  lines: AccountLineRow[]
  /** The last line's `runningBalanceMinor`, or `openingBalanceMinor` when there are no lines. */
  endingBalanceMinor: number
  debitMinor: number
  creditMinor: number
}

export interface GeneralLedger {
  organizationId: string
  /** `YYYY-MM-DD`. */
  from: string
  /** `YYYY-MM-DD`, inclusive. */
  to: string
  /**
   * Accounts with at least one line in the range, or a non-zero opening
   * balance. An account that was untouched and started at zero is omitted:
   * a general ledger listing every empty account is unreadable, and the trial
   * balance is where "every account" belongs.
   */
  accounts: GeneralLedgerAccount[]
  totalDebitMinor: number
  totalCreditMinor: number
  /** `totalDebitMinor === totalCreditMinor`. Ties to the trial balance for the same range. */
  balanced: boolean
  /**
   * 🛑 `true` when {@link ReadGeneralLedgerOptions.maxLines} was reached and
   * the ledger below is INCOMPLETE.
   *
   * A caller must never render a truncated ledger as a finished one: it will
   * not tie, and the person reading it is reconciling against something else.
   * Say so on the screen and in the export, or narrow the range.
   */
  truncated: boolean
}

export interface ReadGeneralLedgerOptions {
  organizationId: string
  /** `YYYY-MM-DD`. Required - a general ledger is always a range, never cumulative. */
  from: string
  /** `YYYY-MM-DD`, inclusive. */
  to: string
  /**
   * Stop after this many LINES and set {@link GeneralLedger.truncated}.
   *
   * A safety valve, not a page size: the intended use is a range small enough
   * that it never fires. Omit for no limit.
   */
  maxLines?: number
}

/**
 * Every posted line in `[from, to]`, grouped by account, oldest first within
 * each account, with a running natural-sign balance per account.
 *
 * Filtered to `POSTED_STATUSES` like every other statement, and grouped by
 * `glAccountId` - the identity - so renumbering an account never splits its
 * history across two sections.
 *
 * Opening balances are computed by summing every posted line before `from`,
 * so each account's running balance starts from its true position rather than
 * from zero. That is one extra aggregate over the same table, not one query
 * per account.
 */
export async function readGeneralLedger(
  db: Database,
  options: ReadGeneralLedgerOptions
): Promise<Result<GeneralLedger, Error>> {
  const { organizationId, from, to, maxLines } = options

  try {
    assertDayFormat(from, 'from')
    assertDayFormat(to, 'to')
    if (to < from) {
      throw new UnprocessableEntityError(`"to" (${to}) is before "from" (${from})`, { from, to })
    }

    const chartResult = await listChartAccounts(db, organizationId)
    if (chartResult.isErr()) return err(chartResult.error)
    const chartById = new Map(chartResult.value.map((account) => [account.id, account]))

    const opening = await readOpeningBalances(db, organizationId, previousCalendarDay(from))

    // 🛑 `limit` is applied in SQL, not after the fact. The guard exists to
    // protect the PROCESS, and a JS `.slice()` over a result set the driver
    // already materialised protects nothing. `maxLines + 1` is what makes
    // "there was more" distinguishable from "that was exactly all of it".
    const linesQuery = db
      .select({
        glAccountId: schema.GlPostingLine.glAccountId,
        glPostingId: schema.GlPosting.id,
        docNumber: schema.GlPosting.docNumber,
        txnDate: schema.GlPosting.txnDate,
        memo: schema.GlPostingLine.memo,
        direction: schema.GlPostingLine.direction,
        amountMinor: schema.GlPostingLine.amountMinor,
      })
      .from(schema.GlPostingLine)
      .innerJoin(schema.GlPosting, eq(schema.GlPosting.id, schema.GlPostingLine.glPostingId))
      .where(
        and(
          eq(schema.GlPosting.organizationId, organizationId),
          inArray(schema.GlPosting.status, [...POSTED_STATUSES]),
          gte(schema.GlPosting.txnDate, from),
          lte(schema.GlPosting.txnDate, to)
        )
      )
      // Account first, then chronological within the account: the cut, when it
      // comes, lands at an account boundary far more often than it lands mid
      // account, and every account BEFORE it is whole.
      .orderBy(
        asc(schema.GlPostingLine.glAccountId),
        asc(schema.GlPosting.txnDate),
        asc(schema.GlPosting.docNumber),
        asc(schema.GlPostingLine.lineNumber)
      )

    const rawLines = await (maxLines === undefined ? linesQuery : linesQuery.limit(maxLines + 1))

    const truncated = maxLines !== undefined && rawLines.length > maxLines
    const usableLines = truncated ? rawLines.slice(0, maxLines) : rawLines

    const byAccount = new Map<string, typeof usableLines>()
    for (const line of usableLines) {
      const bucket = byAccount.get(line.glAccountId)
      if (bucket) bucket.push(line)
      else byAccount.set(line.glAccountId, [line])
    }

    // "Accounts with at least one line in the range, OR a non-zero opening
    // balance" - the union, so an account that only carries a brought-forward
    // figure still shows the reader where it stands.
    const glAccountIds = new Set<string>(byAccount.keys())
    for (const [glAccountId, sums] of opening) {
      if (sums.debitMinor !== sums.creditMinor) glAccountIds.add(glAccountId)
    }

    const accounts: GeneralLedgerAccount[] = []
    for (const glAccountId of glAccountIds) {
      accounts.push(
        buildAccount(glAccountId, chartById.get(glAccountId), opening.get(glAccountId), [
          ...(byAccount.get(glAccountId) ?? []),
        ])
      )
    }
    accounts.sort(compareSections)

    const totalDebitMinor = accounts.reduce((sum, account) => sum + account.debitMinor, 0)
    const totalCreditMinor = accounts.reduce((sum, account) => sum + account.creditMinor, 0)

    return ok({
      organizationId,
      from,
      to,
      accounts,
      totalDebitMinor,
      totalCreditMinor,
      // The literal definition this interface documents. ⚠️ It is only a
      // TIE-OUT when `truncated` is false - a partial ledger's two sides can
      // agree by luck - so a caller reads `truncated` FIRST.
      balanced: totalDebitMinor === totalCreditMinor,
      truncated,
    })
  } catch (error) {
    if (error instanceof AuxxError) return err(error)
    logger.error('Failed to read the general ledger', { error, organizationId, from, to })
    return err(new AuxxError('Internal error'))
  }
}

/** One raw joined line, before it becomes an {@link AccountLineRow}. */
interface RawLedgerLine {
  glAccountId: string
  glPostingId: string
  docNumber: string
  txnDate: string
  memo: string | null
  direction: string
  amountMinor: string | number
}

/**
 * One account's section: the running natural-sign balance walked line by line
 * from its opening position, exactly as `readAccountLines` walks one account -
 * the two reports are the same report at two zoom levels and must agree line
 * for line.
 */
function buildAccount(
  glAccountId: string,
  account: ChartAccountRow | undefined,
  openingSums: { debitMinor: number; creditMinor: number } | undefined,
  rawLines: readonly RawLedgerLine[]
): GeneralLedgerAccount {
  const openingDebit = openingSums?.debitMinor ?? 0
  const openingCredit = openingSums?.creditMinor ?? 0
  // A deleted account has no natural side left to sign against, so its balance
  // is the unsigned debit-minus-credit `readAccountLines` falls back to.
  const openingBalanceMinor = account
    ? signedBalance(openingDebit, openingCredit, account.accountType)
    : openingDebit - openingCredit
  const naturalDirection = account ? NATURAL_BALANCE_DIRECTION[account.accountType] : 'debit'

  let running = openingBalanceMinor
  let debitMinor = 0
  let creditMinor = 0
  const lines: AccountLineRow[] = rawLines.map((line) => {
    const amountMinor = toMinor(line.amountMinor)
    const direction = line.direction as PostingDirection
    if (direction === 'debit') debitMinor += amountMinor
    else creditMinor += amountMinor
    running += direction === naturalDirection ? amountMinor : -amountMinor
    return {
      glPostingId: line.glPostingId,
      docNumber: line.docNumber,
      txnDate: line.txnDate,
      memo: line.memo,
      direction,
      amountMinor,
      runningBalanceMinor: running,
    }
  })

  return {
    glAccountId,
    // The CURRENT code, or null - never the snapshot a line happened to carry.
    // A DELETED account is identified by its id in the section label instead,
    // which is what an empty `accountName` tells the adapter to do.
    accountCode: account ? account.code : null,
    accountName: account?.name ?? '',
    accountType: account?.accountType ?? null,
    openingBalanceMinor,
    lines,
    endingBalanceMinor: lines.length > 0 ? running : openingBalanceMinor,
    debitMinor,
    creditMinor,
  }
}

/**
 * Every account's `SUM(debit)`/`SUM(credit)` through `through`, in ONE
 * aggregate.
 *
 * 🛑 One query, not one per account. `readAccountLines` can afford a
 * per-account opening sum because it reads one account; a general ledger over
 * a full chart would turn that into a hundred round trips for a figure a
 * single `GROUP BY` already has.
 */
async function readOpeningBalances(
  db: Database,
  organizationId: string,
  through: string
): Promise<Map<string, { debitMinor: number; creditMinor: number }>> {
  const rows = await db
    .select({
      glAccountId: schema.GlPostingLine.glAccountId,
      debitMinor: sql<string>`coalesce(sum(${schema.GlPostingLine.amountMinor}) filter (where ${schema.GlPostingLine.direction} = 'debit'), 0)`,
      creditMinor: sql<string>`coalesce(sum(${schema.GlPostingLine.amountMinor}) filter (where ${schema.GlPostingLine.direction} = 'credit'), 0)`,
    })
    .from(schema.GlPostingLine)
    .innerJoin(schema.GlPosting, eq(schema.GlPosting.id, schema.GlPostingLine.glPostingId))
    .where(
      and(
        eq(schema.GlPosting.organizationId, organizationId),
        inArray(schema.GlPosting.status, [...POSTED_STATUSES]),
        lte(schema.GlPosting.txnDate, through)
      )
    )
    .groupBy(schema.GlPostingLine.glAccountId)

  return new Map(
    rows.map((row) => [
      row.glAccountId,
      { debitMinor: toMinor(row.debitMinor), creditMinor: toMinor(row.creditMinor) },
    ])
  )
}

/** The trial balance's 15.2 order: statement type first, then code, then name. */
function compareSections(a: GeneralLedgerAccount, b: GeneralLedgerAccount): number {
  const orderA = a.accountType ? (STATEMENT_ORDER.get(a.accountType) ?? 0) : STATEMENT_ORDER.size
  const orderB = b.accountType ? (STATEMENT_ORDER.get(b.accountType) ?? 0) : STATEMENT_ORDER.size
  if (orderA !== orderB) return orderA - orderB
  return compareAccountsByCodeThenName(
    { code: a.accountCode, name: a.accountName },
    { code: b.accountCode, name: b.accountName }
  )
}

function assertDayFormat(date: string, label: string): void {
  if (!DAY_PATTERN.test(date)) {
    throw new UnprocessableEntityError(`${label} must be YYYY-MM-DD, got "${date}"`, { date })
  }
}

/** `SUM(bigint)` arrives as a `numeric` string - coerce once here, as every other statement does. */
function toMinor(value: string | number): number {
  return typeof value === 'number' ? value : Number(value)
}
