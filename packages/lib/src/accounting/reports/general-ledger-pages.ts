// packages/lib/src/accounting/reports/general-ledger-pages.ts
//
// The general ledger as the screen reads it: one summary row per account, then
// one account's lines a page at a time. `readGeneralLedger` stays the one-shot
// read the PDF renders from. See plans/accounting/tasks/108-reports-that-scale.md §3.2.

import { type Database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { toMinor } from '@auxx/utils/currency'
import { and, asc, eq, type SQL, sql } from 'drizzle-orm'
import { err, ok, type Result } from 'neverthrow'
import { AuxxError, UnprocessableEntityError } from '../../errors'
import { accountLabel, compareAccountsByCodeThenName } from '../ledger/chart/account-label'
import { accountPath, accountPathLabel } from '../ledger/chart/account-tree'
import { GL_ACCOUNT_TYPES, type GlAccountTypeValue } from '../ledger/chart/default-chart'
import { standingLineFilter } from '../ledger/reads/standing-lines'
import { listChartAccounts } from '../ledger/roles/role-map'
import type { ChartAccountRow, PostingDirection } from '../ledger/types'
import { readOpeningPositions } from './general-ledger'
import { NATURAL_BALANCE_DIRECTION, signedBalance } from './statement-math'

const logger = createScopedLogger('postings:reports:general-ledger-pages')

const STATEMENT_ORDER = new Map(GL_ACCOUNT_TYPES.map((type, index) => [type, index]))
const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/

/** One record's postings on `GlPostingSource`, any link role. */
export interface GeneralLedgerSource {
  sourceKind: string
  sourceId: string
}

export interface GeneralLedgerSummaryAccount {
  glAccountId: string
  accountCode: string | null
  /** `''` when the account has been deleted from the chart. */
  accountName: string
  accountType: GlAccountTypeValue | null
  /** The section label: the path for a sub-account, code and name otherwise, the id for a deleted account. */
  label: string
  /** A sub-account, labelled by its path rather than `AccountLabel`'s code/name split. */
  nested: boolean
  openingBalanceMinor: number
  /** Over every line in the range, whether or not it matches `search`. */
  debitMinor: number
  creditMinor: number
  endingBalanceMinor: number
  /** Lines the lines read returns for this account: all of them, or the matches under `search`. */
  lineCount: number
}

export interface GeneralLedgerSummary {
  from: string
  to: string
  accounts: GeneralLedgerSummaryAccount[]
  totalDebitMinor: number
  totalCreditMinor: number
  balanced: boolean
}

export interface ReadGeneralLedgerSummaryOptions {
  organizationId: string
  from: string
  to: string
  glAccountId?: string
  /** Skips opening balances: a record's entries are not a running account. */
  source?: GeneralLedgerSource
  /** Memo, document number or counterparty name. Narrows the accounts, not their totals. */
  search?: string
}

/**
 * One row per account with a line in `[from, to]` or a non-zero opening
 * balance, in the trial balance's order. Two aggregates, however many lines.
 */
export async function readGeneralLedgerSummary(
  db: Database,
  options: ReadGeneralLedgerSummaryOptions
): Promise<Result<GeneralLedgerSummary, Error>> {
  const { organizationId, from, to, glAccountId, source } = options
  const search = options.search?.trim() || undefined

  try {
    assertRange(from, to)
    const chartResult = await listChartAccounts(db, organizationId)
    if (chartResult.isErr()) return err(chartResult.error)
    const chart = chartResult.value
    const chartById = new Map(chart.map((account) => [account.id, account]))

    const opening = source
      ? new Map<string, { debitMinor: number; creditMinor: number }>()
      : await readOpeningPositions(db, organizationId, from, chartById, glAccountId)

    const match = search
      ? searchPredicate(
          {
            postingId: schema.GlPosting.id,
            docNumber: schema.GlPosting.docNumber,
            memo: schema.GlPostingLine.memo,
          },
          search
        )
      : undefined

    const rows = await db
      .select({
        glAccountId: schema.GlPostingLine.glAccountId,
        debitMinor: sql<string>`coalesce(sum(${schema.GlPostingLine.amountMinor}) filter (where ${schema.GlPostingLine.direction} = 'debit'), 0)`,
        creditMinor: sql<string>`coalesce(sum(${schema.GlPostingLine.amountMinor}) filter (where ${schema.GlPostingLine.direction} = 'credit'), 0)`,
        lineCount: match ? sql<string>`count(*) filter (where ${match})` : sql<string>`count(*)`,
      })
      .from(schema.GlPostingLine)
      .innerJoin(schema.GlPosting, eq(schema.GlPosting.id, schema.GlPostingLine.glPostingId))
      .where(
        and(
          standingLineFilter(organizationId, {
            from,
            to,
            glAccountIds: glAccountId ? [glAccountId] : undefined,
          }),
          source ? sourcePredicate(organizationId, source) : undefined
        )
      )
      .groupBy(schema.GlPostingLine.glAccountId)

    const inRange = new Map(
      rows.map((row) => [
        row.glAccountId,
        {
          debitMinor: toMinor(row.debitMinor),
          creditMinor: toMinor(row.creditMinor),
          lineCount: Number(row.lineCount),
        },
      ])
    )

    const ids = new Set<string>()
    for (const [id, sums] of inRange) {
      if (!search || sums.lineCount > 0) ids.add(id)
    }
    // An account that only carries a brought-forward figure still shows where it stands.
    if (!search) {
      for (const [id, sums] of opening) {
        if (sums.debitMinor !== sums.creditMinor) ids.add(id)
      }
    }

    const accounts = [...ids].map((id) =>
      summarizeAccount(chart, id, chartById.get(id), opening.get(id), inRange.get(id))
    )
    accounts.sort(compareSections)

    const totalDebitMinor = accounts.reduce((sum, account) => sum + account.debitMinor, 0)
    const totalCreditMinor = accounts.reduce((sum, account) => sum + account.creditMinor, 0)
    return ok({
      from,
      to,
      accounts,
      totalDebitMinor,
      totalCreditMinor,
      balanced: totalDebitMinor === totalCreditMinor,
    })
  } catch (error) {
    if (error instanceof AuxxError) return err(error)
    logger.error('Failed to read the general ledger summary', { error, organizationId, from, to })
    return err(new AuxxError('Internal error'))
  }
}

export interface GeneralLedgerLine {
  lineId: string
  glPostingId: string
  /** `YYYY-MM-DD`. */
  txnDate: string
  docNumber: string
  postingType: string
  memo: string | null
  /** The posting's customer or vendor, from its first receivable/payable line. */
  counterpartyName: string | null
  /** The other account in the posting, `'Multiple'` past one, `null` when there is none. */
  splitLabel: string | null
  direction: PostingDirection
  amountMinor: number
  /** Natural-sign balance through this line, over every line in the range (not only matches). */
  runningBalanceMinor: number
}

export interface ReadGeneralLedgerLinesOptions {
  organizationId: string
  glAccountId: string
  from: string
  to: string
  source?: GeneralLedgerSource
  search?: string
  /** Index of the first line to return, in the account's `(txnDate, docNumber, lineNumber, id)` order. */
  offset: number
  /** Omit for every line from `offset` on (the CSV). */
  limit?: number
}

/**
 * One account's lines in `[from, to]`, a page at a time, each with its running
 * balance. The balance is a window sum over the whole range, so a page deep in
 * the account (or a search match) carries the same figure it would unpaged.
 */
export async function readGeneralLedgerLines(
  db: Database,
  options: ReadGeneralLedgerLinesOptions
): Promise<Result<GeneralLedgerLine[], Error>> {
  const { organizationId, glAccountId, from, to, source, offset, limit } = options
  const search = options.search?.trim() || undefined

  try {
    assertRange(from, to)
    if (!Number.isInteger(offset) || offset < 0) {
      throw new UnprocessableEntityError(`offset must be a non-negative integer, got ${offset}`)
    }

    const chartResult = await listChartAccounts(db, organizationId)
    if (chartResult.isErr()) return err(chartResult.error)
    const chartById = new Map(chartResult.value.map((account) => [account.id, account]))
    const account = chartById.get(glAccountId)

    let openingBalanceMinor = 0
    if (!source) {
      const opening = await readOpeningPositions(db, organizationId, from, chartById, glAccountId)
      const sums = opening.get(glAccountId)
      if (sums) {
        openingBalanceMinor = account
          ? signedBalance(sums.debitMinor, sums.creditMinor, account.accountType)
          : sums.debitMinor - sums.creditMinor
      }
    }

    // A deleted account has no natural side left, so it runs debit-minus-credit.
    const natural = account ? NATURAL_BALANCE_DIRECTION[account.accountType] : 'debit'
    const L = schema.GlPostingLine
    const P = schema.GlPosting

    const ordered = db
      .select({
        lineId: sql<string>`${L.id}`.as('lineId'),
        glPostingId: sql<string>`${P.id}`.as('glPostingId'),
        txnDate: sql<string>`${P.txnDate}`.as('txnDate'),
        docNumber: sql<string | null>`${P.docNumber}`.as('docNumber'),
        postingType: sql<string>`${P.postingType}`.as('postingType'),
        memo: sql<string | null>`${L.memo}`.as('memo'),
        direction: sql<string>`${L.direction}`.as('direction'),
        amountMinor: sql<string>`${L.amountMinor}`.as('amountMinor'),
        lineNumber: sql<number>`${L.lineNumber}`.as('lineNumber'),
        runningMinor:
          sql<string>`sum(case when ${L.direction} = ${sql.raw(`'${natural}'`)} then ${L.amountMinor} else -${L.amountMinor} end) over (order by ${P.txnDate}, ${P.docNumber}, ${L.lineNumber}, ${L.id} rows between unbounded preceding and current row)`.as(
            'runningMinor'
          ),
      })
      .from(L)
      .innerJoin(P, eq(P.id, L.glPostingId))
      .where(
        and(
          standingLineFilter(organizationId, { from, to, glAccountIds: [glAccountId] }),
          source ? sourcePredicate(organizationId, source) : undefined
        )
      )
      .as('gl')

    const page = db
      .select({
        lineId: ordered.lineId,
        glPostingId: ordered.glPostingId,
        txnDate: ordered.txnDate,
        docNumber: ordered.docNumber,
        postingType: ordered.postingType,
        memo: ordered.memo,
        direction: ordered.direction,
        amountMinor: ordered.amountMinor,
        runningMinor: ordered.runningMinor,
        counterpartyName: sql<string | null>`(select ei."displayName" from ${L} cp
          join ${schema.EntityInstance} ei on ei.id = cp."counterpartyId"
          where cp."glPostingId" = ${glColumn('glPostingId')} and cp."counterpartyId" is not null
          order by cp."lineNumber" limit 1)`,
        splitIds: sql<string[] | null>`(select array_agg(distinct o."glAccountId") from ${L} o
          where o."glPostingId" = ${glColumn('glPostingId')} and o."glAccountId" <> ${glAccountId})`,
      })
      .from(ordered)
      .where(
        search
          ? searchPredicate(
              {
                postingId: glColumn('glPostingId'),
                docNumber: glColumn('docNumber'),
                memo: glColumn('memo'),
              },
              search
            )
          : undefined
      )
      .orderBy(
        asc(ordered.txnDate),
        asc(ordered.docNumber),
        asc(ordered.lineNumber),
        asc(ordered.lineId)
      )
      .offset(offset)

    const rows = await (limit === undefined ? page : page.limit(limit))

    return ok(
      rows.map((row) => ({
        lineId: row.lineId,
        glPostingId: row.glPostingId,
        txnDate: row.txnDate,
        docNumber: row.docNumber ?? '',
        postingType: row.postingType,
        memo: row.memo,
        counterpartyName: row.counterpartyName || null,
        splitLabel: splitLabel(row.splitIds, chartById),
        direction: row.direction as PostingDirection,
        amountMinor: toMinor(row.amountMinor),
        runningBalanceMinor: openingBalanceMinor + toMinor(row.runningMinor),
      }))
    )
  } catch (error) {
    if (error instanceof AuxxError) return err(error)
    logger.error('Failed to read general ledger lines', {
      error,
      organizationId,
      glAccountId,
      from,
      to,
    })
    return err(new AuxxError('Internal error'))
  }
}

function summarizeAccount(
  chart: readonly ChartAccountRow[],
  glAccountId: string,
  account: ChartAccountRow | undefined,
  opening: { debitMinor: number; creditMinor: number } | undefined,
  inRange: { debitMinor: number; creditMinor: number; lineCount: number } | undefined
): GeneralLedgerSummaryAccount {
  const openingDebit = opening?.debitMinor ?? 0
  const openingCredit = opening?.creditMinor ?? 0
  const debitMinor = inRange?.debitMinor ?? 0
  const creditMinor = inRange?.creditMinor ?? 0
  const signed = (debit: number, credit: number) =>
    account ? signedBalance(debit, credit, account.accountType) : debit - credit

  const nested = !!account && accountPath(chart, glAccountId).length > 1
  const label = account
    ? accountPathLabel(chart, glAccountId) || accountLabel(account)
    : glAccountId

  return {
    glAccountId,
    accountCode: account ? account.code : null,
    accountName: account?.name ?? '',
    accountType: account?.accountType ?? null,
    label,
    nested,
    openingBalanceMinor: signed(openingDebit, openingCredit),
    debitMinor,
    creditMinor,
    endingBalanceMinor: signed(openingDebit + debitMinor, openingCredit + creditMinor),
    lineCount: inRange?.lineCount ?? 0,
  }
}

function splitLabel(
  ids: readonly string[] | null,
  chartById: ReadonlyMap<string, ChartAccountRow>
): string | null {
  if (!ids || ids.length === 0) return null
  if (ids.length > 1) return 'Multiple'
  const id = ids[0] as string
  const account = chartById.get(id)
  return account ? accountLabel(account) : id
}

/**
 * A column of the `gl` subquery, qualified. Drizzle renders a subquery field by its
 * bare alias, which inside a correlated subquery resolves to the inner table instead.
 */
function glColumn(name: string): SQL {
  return sql`${sql.identifier('gl')}.${sql.identifier(name)}`
}

/** Postings linked to one record on `GlPostingSource`. */
function sourcePredicate(organizationId: string, source: GeneralLedgerSource): SQL {
  return sql`EXISTS (SELECT 1 FROM ${schema.GlPostingSource} link
    WHERE link."glPostingId" = ${schema.GlPosting.id}
    AND link."organizationId" = ${organizationId}
    AND link."sourceKind" = ${source.sourceKind}
    AND link."sourceId" = ${source.sourceId})`
}

/** Memo, document number, or the posting's counterparty name, case-insensitive. */
function searchPredicate(
  columns: { postingId: unknown; docNumber: unknown; memo: unknown },
  search: string
): SQL {
  const pattern = `%${search.replace(/[\\%_]/g, (char) => `\\${char}`)}%`
  return sql`(${columns.docNumber} ilike ${pattern} or ${columns.memo} ilike ${pattern}
    or exists (select 1 from ${schema.GlPostingLine} cp
      join ${schema.EntityInstance} ei on ei.id = cp."counterpartyId"
      where cp."glPostingId" = ${columns.postingId} and ei."displayName" ilike ${pattern}))`
}

function compareSections(a: GeneralLedgerSummaryAccount, b: GeneralLedgerSummaryAccount): number {
  const orderA = a.accountType ? (STATEMENT_ORDER.get(a.accountType) ?? 0) : STATEMENT_ORDER.size
  const orderB = b.accountType ? (STATEMENT_ORDER.get(b.accountType) ?? 0) : STATEMENT_ORDER.size
  if (orderA !== orderB) return orderA - orderB
  return compareAccountsByCodeThenName(
    { code: a.accountCode, name: a.accountName },
    { code: b.accountCode, name: b.accountName }
  )
}

function assertRange(from: string, to: string): void {
  if (!DAY_PATTERN.test(from)) {
    throw new UnprocessableEntityError(`from must be YYYY-MM-DD, got "${from}"`, { date: from })
  }
  if (!DAY_PATTERN.test(to)) {
    throw new UnprocessableEntityError(`to must be YYYY-MM-DD, got "${to}"`, { date: to })
  }
  if (to < from) {
    throw new UnprocessableEntityError(`"to" (${to}) is before "from" (${from})`, { from, to })
  }
}
