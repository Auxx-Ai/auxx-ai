// packages/lib/src/postings/reports/account-lines.ts
//
// The drill-down behind one account code: every posted line, in date order,
// with a running natural-sign balance. What a click on a trial-balance,
// balance-sheet or P&L row opens.
//
// No permission checks here. The router asserts (`docs/lib-module-guide.md` §6).

import { type Database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, asc, eq, gte, inArray, lte, sql } from 'drizzle-orm'
import { err, ok, type Result } from 'neverthrow'
import { AuxxError } from '../../errors'
import type { GlAccountTypeValue } from '../default-chart'
import { listChartAccounts } from '../role-map'
import type { PostingDirection } from '../types'
import { previousCalendarDay } from './fiscal-year'
import { NATURAL_BALANCE_DIRECTION, signedBalance } from './statement-math'

const logger = createScopedLogger('postings:reports:account-lines')

const POSTED_STATUSES = ['posted', 'reversed'] as const

/** One posted line against the requested account, with its running balance. */
export interface AccountLineRow {
  glPostingId: string
  docNumber: string
  /** `YYYY-MM-DD`. */
  txnDate: string
  memo: string | null
  direction: PostingDirection
  amountMinor: number
  /** Natural-sign balance through and including this line. */
  runningBalanceMinor: number
}

export interface AccountLines {
  organizationId: string
  accountCode: string
  /** `''` when the code names no live account in this org's chart. */
  accountName: string
  /** `null` when the code names no live account - the running balance is then unsigned (raw debit). */
  accountType: GlAccountTypeValue | null
  /** `null` when the read is unbounded on the start - the balance sheet's own cumulative range. */
  from: string | null
  to: string | null
  /** The natural-sign balance immediately before `from`, carried into `lines[0].runningBalanceMinor`. */
  openingBalanceMinor: number
  lines: AccountLineRow[]
  /** Equal to the last line's `runningBalanceMinor`, or `openingBalanceMinor` when there are no lines. */
  endingBalanceMinor: number
}

export interface ReadAccountLinesOptions {
  organizationId: string
  accountCode: string
  /** `YYYY-MM-DD`. Omit for a cumulative-from-the-beginning read. */
  from?: string
  /** `YYYY-MM-DD`, inclusive. Omit for open-ended. */
  to?: string
}

/**
 * Every posted line against `accountCode`, oldest first, with a running
 * natural-sign balance - `signedBalance` applied line by line rather than
 * once over a sum, so a reader can see the balance AT any line, not just at
 * the end.
 *
 * When `from` is given, `openingBalanceMinor` is computed by summing every
 * posted line before `from` first, so the running balance in the visible
 * range starts from the account's true position rather than from zero.
 */
export async function readAccountLines(
  db: Database,
  options: ReadAccountLinesOptions
): Promise<Result<AccountLines, Error>> {
  const { organizationId, accountCode, from, to } = options

  try {
    const chartResult = await listChartAccounts(db, organizationId)
    if (chartResult.isErr()) return err(chartResult.error)
    const account = chartResult.value.find((row) => row.code === accountCode) ?? null
    const naturalDirection = account ? NATURAL_BALANCE_DIRECTION[account.accountType] : 'debit'

    let openingBalanceMinor = 0
    if (from) {
      const before = await sumDebitCredit(db, organizationId, accountCode, {
        to: previousCalendarDay(from),
      })
      openingBalanceMinor = account
        ? signedBalance(before.debitMinor, before.creditMinor, account.accountType)
        : before.debitMinor - before.creditMinor
    }

    const bounds = [
      eq(schema.GlPosting.organizationId, organizationId),
      inArray(schema.GlPosting.status, [...POSTED_STATUSES]),
      eq(schema.GlPostingLine.accountCode, accountCode),
    ]
    if (from) bounds.push(gte(schema.GlPosting.txnDate, from))
    if (to) bounds.push(lte(schema.GlPosting.txnDate, to))

    const rawLines = await db
      .select({
        glPostingId: schema.GlPosting.id,
        docNumber: schema.GlPosting.docNumber,
        txnDate: schema.GlPosting.txnDate,
        memo: schema.GlPostingLine.memo,
        direction: schema.GlPostingLine.direction,
        amountMinor: schema.GlPostingLine.amountMinor,
        lineNumber: schema.GlPostingLine.lineNumber,
      })
      .from(schema.GlPostingLine)
      .innerJoin(schema.GlPosting, eq(schema.GlPosting.id, schema.GlPostingLine.glPostingId))
      .where(and(...bounds))
      .orderBy(
        asc(schema.GlPosting.txnDate),
        asc(schema.GlPosting.docNumber),
        asc(schema.GlPostingLine.lineNumber)
      )

    let running = openingBalanceMinor
    const lines: AccountLineRow[] = rawLines.map((line) => {
      const amountMinor = toMinor(line.amountMinor)
      const delta = line.direction === naturalDirection ? amountMinor : -amountMinor
      running += delta
      return {
        glPostingId: line.glPostingId,
        docNumber: line.docNumber,
        txnDate: line.txnDate,
        memo: line.memo,
        direction: line.direction as PostingDirection,
        amountMinor,
        runningBalanceMinor: running,
      }
    })

    return ok({
      organizationId,
      accountCode,
      accountName: account?.name ?? '',
      accountType: account?.accountType ?? null,
      from: from ?? null,
      to: to ?? null,
      openingBalanceMinor,
      lines,
      endingBalanceMinor:
        lines.length > 0
          ? (lines[lines.length - 1]?.runningBalanceMinor ?? running)
          : openingBalanceMinor,
    })
  } catch (error) {
    if (error instanceof AuxxError) return err(error)
    logger.error('Failed to read account lines', { error, organizationId, accountCode, from, to })
    return err(new AuxxError('Internal error'))
  }
}

/** `SUM(debit)` / `SUM(credit)` for one account code, bounded only by `to` - the opening-balance query. */
async function sumDebitCredit(
  db: Database,
  organizationId: string,
  accountCode: string,
  bounds: { to: string }
): Promise<{ debitMinor: number; creditMinor: number }> {
  const [row] = await db
    .select({
      debitMinor: sql<string>`coalesce(sum(${schema.GlPostingLine.amountMinor}) filter (where ${schema.GlPostingLine.direction} = 'debit'), 0)`,
      creditMinor: sql<string>`coalesce(sum(${schema.GlPostingLine.amountMinor}) filter (where ${schema.GlPostingLine.direction} = 'credit'), 0)`,
    })
    .from(schema.GlPostingLine)
    .innerJoin(schema.GlPosting, eq(schema.GlPosting.id, schema.GlPostingLine.glPostingId))
    .where(
      and(
        eq(schema.GlPosting.organizationId, organizationId),
        inArray(schema.GlPosting.status, [...POSTED_STATUSES]),
        eq(schema.GlPostingLine.accountCode, accountCode),
        lte(schema.GlPosting.txnDate, bounds.to)
      )
    )

  return { debitMinor: toMinor(row?.debitMinor ?? 0), creditMinor: toMinor(row?.creditMinor ?? 0) }
}

function toMinor(value: string | number): number {
  return typeof value === 'number' ? value : Number(value)
}
