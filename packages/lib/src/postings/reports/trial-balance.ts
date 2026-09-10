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
  /**
   * The `gl_account` `EntityInstance` id this row groups on. The IDENTITY
   * (task 15) - what makes one account read as one row no matter how many
   * times it has been renumbered since something posted to it.
   */
  glAccountId: string
  /**
   * The account's CURRENT code, read from the live chart by `glAccountId` -
   * never the snapshot a line happened to carry. Renumbering `1100` to `1150`
   * no longer splits its history into two rows; this is simply `1150` for
   * every line ever posted to that account. Falls back to the most recent
   * snapshot on the lines themselves only when `inChart` is `false` (the
   * account has been deleted), so a dropped account is still identifiable.
   */
  accountCode: string
  /** `''` when the account is not in the org's current chart - see `inChart`. */
  accountName: string
  /** `null` when the account is not in the org's current chart - there is no natural side to sign against. */
  accountType: GlAccountTypeValue | null
  debitMinor: number
  creditMinor: number
  /** Natural-sign balance via `signedBalance`. `0` when `accountType` is `null`. */
  balanceMinor: number
  /**
   * `false` when `glAccountId` names no account the org's chart currently
   * holds live - the account was DELETED (archived or removed) after
   * something posted to it (decision P2: a line stores an id with no foreign
   * key, deliberately, so the ledger outlives the chart). Renumbering no
   * longer produces `false` here - see the note on `accountCode`. The row
   * still appears, flagged, rather than being silently dropped.
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
 * `glAccountId`, over posted `GlPostingLine`s in `[from, to]` - `verifyBooksBalance`'s
 * own query with `GROUP BY glAccountId` in place of `GROUP BY postingId`.
 *
 * Joined to the org's live chart (`listChartAccounts`, the same read
 * `resolveRoles` and the role map share) BY ID for name, `accountType` and the
 * CURRENT code - task 15 §3. An id with posted lines but no live chart row
 * still appears, with `inChart: false`, `accountType: null`, and `accountCode`
 * falling back to the most recent snapshot on its own lines - see
 * {@link TrialBalanceRow}.
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
    const chartById = new Map(chart.map((account) => [account.id, account]))

    const bounds = [
      eq(schema.GlPosting.organizationId, organizationId),
      inArray(schema.GlPosting.status, [...POSTED_STATUSES]),
      lte(schema.GlPosting.txnDate, to),
    ]
    if (from) bounds.push(gte(schema.GlPosting.txnDate, from))

    const grouped = await db
      .select({
        glAccountId: schema.GlPostingLine.glAccountId,
        // The most recent snapshot on the group's own lines - used only as the
        // `inChart: false` fallback below, never when the id still resolves.
        accountCode: sql<string>`max(${schema.GlPostingLine.accountCode})`,
        debitMinor: sql<string>`coalesce(sum(${schema.GlPostingLine.amountMinor}) filter (where ${schema.GlPostingLine.direction} = 'debit'), 0)`,
        creditMinor: sql<string>`coalesce(sum(${schema.GlPostingLine.amountMinor}) filter (where ${schema.GlPostingLine.direction} = 'credit'), 0)`,
      })
      .from(schema.GlPostingLine)
      .innerJoin(schema.GlPosting, eq(schema.GlPosting.id, schema.GlPostingLine.glPostingId))
      .where(and(...bounds))
      .groupBy(schema.GlPostingLine.glAccountId)

    const rows: TrialBalanceRow[] = grouped
      .map((row) => {
        const account = chartById.get(row.glAccountId)
        const debitMinor = toMinor(row.debitMinor)
        const creditMinor = toMinor(row.creditMinor)
        return {
          glAccountId: row.glAccountId,
          // The CURRENT code and name when the account is still live - a
          // statement reads the chart, not the snapshot (§3's rule). Falls back
          // to the snapshot only for a deleted account, so it stays identifiable.
          accountCode: account?.code ?? row.accountCode,
          accountName: account?.name ?? '',
          accountType: account?.accountType ?? null,
          debitMinor,
          creditMinor,
          balanceMinor: account ? signedBalance(debitMinor, creditMinor, account.accountType) : 0,
          inChart: Boolean(account),
        }
      })
      // Null-safe ahead of task 15 §5, where `accountCode` becomes optional.
      .sort((a, b) => (a.accountCode ?? '').localeCompare(b.accountCode ?? ''))

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
