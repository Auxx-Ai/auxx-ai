// packages/lib/src/postings/reports/trial-balance.ts
//
// The trial balance: `verifyBooksBalance`'s own sweep, `GROUP BY accountCode`
// instead of `GROUP BY postingId`. It is the debugging tool for the balance
// sheet and the P&L below - both are presentations of this read - and it is the
// report a CPA actually asks for.
//
// PERIOD BOUNDARIES. `to` (and `from`, when given) are `YYYY-MM-DD` strings
// compared directly against `GlPosting.txnDate`, which is a Postgres `date`
// column already stored in the org's `accounting.bookTimeZone` terms (decision
// in `periods.ts`: a `periodKey`/`txnDate` is derived once, at the wall-clock
// boundary of the book timezone, and stored as a calendar date with no
// instant/UTC component left in it). So this file does no timezone conversion
// of its own - comparing `txnDate <= to` as a STRING/DATE comparison is already
// correct, and re-deriving a boundary from a `Date` object here would be the
// bug `04-reporting.md` §3 warns about, re-introduced one level up.
//
// No permission checks here. The router asserts (`docs/lib-module-guide.md` §6).

import { type Database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, eq, gte, inArray, lte, sql } from 'drizzle-orm'
import { err, ok, type Result } from 'neverthrow'
import { AuxxError } from '../../errors'
import type { GlAccountTypeValue } from '../default-chart'
import { listChartAccounts } from '../role-map'
import type { ChartAccountRow } from '../types'
import { signedBalance } from './statement-math'

const logger = createScopedLogger('postings:reports:trial-balance')

/** Only a posted entry counts - see `verify-balance.ts` for why `pending`/`failed` do not. */
const POSTED_STATUSES = ['posted', 'reversed'] as const

/** One account's balance over the requested range. */
export interface TrialBalanceRow {
  accountCode: string
  /** `''` when the code names no live account in this org's chart - see `inChart`. */
  accountName: string
  /** `null` when the code names no live account - there is no natural side to sign against. */
  accountType: GlAccountTypeValue | null
  debitMinor: number
  creditMinor: number
  /** Natural-sign balance via `signedBalance`. `0` when `accountType` is `null`. */
  balanceMinor: number
  /**
   * `false` when posted lines name a code the org's chart does not currently
   * hold live - the account was renumbered, archived, or deleted after
   * something posted to it (decision P2: a line stores a code with no foreign
   * key, deliberately, so the ledger outlives the chart). The row still
   * appears, flagged, rather than being silently dropped.
   */
  inChart: boolean
}

export interface TrialBalance {
  organizationId: string
  /** `null` when the read is cumulative from the beginning of time. */
  from: string | null
  to: string
  rows: TrialBalanceRow[]
  totalDebitMinor: number
  totalCreditMinor: number
  /** `totalDebitMinor === totalCreditMinor`. Ties to `verifyBooksBalance` for the same range. */
  balanced: boolean
}

export interface ReadTrialBalanceOptions {
  organizationId: string
  /** `YYYY-MM-DD`. Omit for a cumulative-from-the-beginning read (what a balance sheet wants). */
  from?: string
  /** `YYYY-MM-DD`, inclusive. */
  to: string
  /**
   * The org's live chart, already read.
   *
   * Every read here needs the whole chart for name and `accountType`, and a
   * balance sheet makes three of these reads (six when comparing) over one
   * unchanging chart - which was three to six runs of `listChartAccounts`, two
   * queries each. Pass it when a caller already holds it; omit it and this
   * reads its own.
   */
  chart?: readonly ChartAccountRow[]
}

/**
 * `SUM(amountMinor) FILTER (WHERE direction = 'debit')` / `'credit'`, grouped by
 * `accountCode`, over posted `GlPostingLine`s in `[from, to]` - `verifyBooksBalance`'s
 * own query with `GROUP BY accountCode` in place of `GROUP BY postingId`.
 *
 * Joined to the org's live chart (`listChartAccounts`, the same read
 * `resolveRoles` and the role map share) for name and `accountType`. A code
 * with posted lines but no live chart row still appears, with `inChart: false`
 * and `accountType: null` - see {@link TrialBalanceRow}.
 */
export async function readTrialBalance(
  db: Database,
  options: ReadTrialBalanceOptions
): Promise<Result<TrialBalance, Error>> {
  const { organizationId, from, to } = options

  try {
    let chart = options.chart
    if (!chart) {
      const chartResult = await listChartAccounts(db, organizationId)
      if (chartResult.isErr()) return err(chartResult.error)
      chart = chartResult.value
    }
    const chartByCode = new Map(chart.map((account) => [account.code, account]))

    const bounds = [
      eq(schema.GlPosting.organizationId, organizationId),
      inArray(schema.GlPosting.status, [...POSTED_STATUSES]),
      lte(schema.GlPosting.txnDate, to),
    ]
    if (from) bounds.push(gte(schema.GlPosting.txnDate, from))

    const grouped = await db
      .select({
        accountCode: schema.GlPostingLine.accountCode,
        debitMinor: sql<string>`coalesce(sum(${schema.GlPostingLine.amountMinor}) filter (where ${schema.GlPostingLine.direction} = 'debit'), 0)`,
        creditMinor: sql<string>`coalesce(sum(${schema.GlPostingLine.amountMinor}) filter (where ${schema.GlPostingLine.direction} = 'credit'), 0)`,
      })
      .from(schema.GlPostingLine)
      .innerJoin(schema.GlPosting, eq(schema.GlPosting.id, schema.GlPostingLine.glPostingId))
      .where(and(...bounds))
      .groupBy(schema.GlPostingLine.accountCode)

    const rows: TrialBalanceRow[] = grouped
      .map((row) => {
        const account = chartByCode.get(row.accountCode)
        const debitMinor = toMinor(row.debitMinor)
        const creditMinor = toMinor(row.creditMinor)
        return {
          accountCode: row.accountCode,
          accountName: account?.name ?? '',
          accountType: account?.accountType ?? null,
          debitMinor,
          creditMinor,
          balanceMinor: account ? signedBalance(debitMinor, creditMinor, account.accountType) : 0,
          inChart: Boolean(account),
        }
      })
      .sort((a, b) => a.accountCode.localeCompare(b.accountCode))

    const totalDebitMinor = rows.reduce((sum, row) => sum + row.debitMinor, 0)
    const totalCreditMinor = rows.reduce((sum, row) => sum + row.creditMinor, 0)

    return ok({
      organizationId,
      from: from ?? null,
      to,
      rows,
      totalDebitMinor,
      totalCreditMinor,
      balanced: totalDebitMinor === totalCreditMinor,
    })
  } catch (error) {
    if (error instanceof AuxxError) return err(error)
    logger.error('Failed to read the trial balance', { error, organizationId, from, to })
    return err(new AuxxError('Internal error'))
  }
}

/**
 * Coerce a `SUM(bigint)` aggregate (`numeric`, arrives as a string) to a JS
 * number. Same reasoning as `verify-balance.ts`'s `toMinor` - do it once here
 * rather than trusting the driver at every call site.
 */
function toMinor(value: string | number): number {
  return typeof value === 'number' ? value : Number(value)
}
