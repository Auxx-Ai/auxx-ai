// packages/lib/src/postings/reports/__tests__/general-ledger.test.ts
//
// `readGeneralLedger` composes the same two collaborators `readTrialBalance`
// and `readAccountLines` do - `listChartAccounts` (mocked; its own decode is
// covered by `role-map.test.ts`) and two grouped/ordered SQL reads, stubbed as
// a hand-written thenable chain for the same reason those files stub theirs:
// the interesting cases are about the SHAPE Postgres hands back (string
// aggregates) and about what this read does with it.
//
// The stub also CAPTURES the `where` condition and the `limit`, because two of
// the properties that matter here are not visible in the rows: that `to` is
// bound INCLUSIVELY, and that the size guard is applied in SQL rather than by
// slicing a result set the driver already materialised.

import type { Database } from '@auxx/database'
import { PgDialect } from 'drizzle-orm/pg-core'
import { ok } from 'neverthrow'
import { describe, expect, it, vi } from 'vitest'
import type { ChartAccountRow } from '../../types'

vi.mock('../../role-map', () => ({ listChartAccounts: vi.fn() }))

import { listChartAccounts } from '../../role-map'
import { toGeneralLedgerRows } from '../adapters'
import { GENERAL_LEDGER_MAX_LINES, readGeneralLedger } from '../general-ledger'

const ORG = 'org_1'

/** What `PgDialect.sqlToQuery` takes - a captured `where` condition, re-typed. */
type SqlCondition = Parameters<PgDialect['sqlToQuery']>[0]

interface Capture {
  /** The `where` condition of each `db.select()`, in call order. */
  where: unknown[]
  /** The `limit` argument of each `db.select()`, `undefined` where none was applied. */
  limit: Array<number | undefined>
}

/**
 * `readGeneralLedger` issues `db.select()` twice, always in this order: the
 * one-shot opening-balance aggregate, then the line list. Each gets its own
 * row set.
 */
function stubDb(rowSets: unknown[][], capture?: Capture): Database {
  let call = 0
  return {
    select: () => {
      const index = call
      call += 1
      capture?.limit.push(undefined)
      const chain: Record<string, unknown> = {}
      const passthrough = () => chain
      for (const method of ['from', 'innerJoin', 'groupBy', 'orderBy']) chain[method] = passthrough
      chain.where = (condition: unknown) => {
        capture?.where.push(condition)
        return chain
      }
      chain.limit = (value: number) => {
        if (capture) capture.limit[index] = value
        return chain
      }
      // biome-ignore lint/suspicious/noThenProperty: the stub must be awaitable
      chain.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
        Promise.resolve(rowSets[index] ?? []).then(resolve, reject)
      return chain
    },
  } as unknown as Database
}

function account(overrides: Partial<ChartAccountRow> & { code: string | null }): ChartAccountRow {
  return {
    id: `id_${overrides.code}`,
    name: '',
    accountType: 'asset',
    subtype: null,
    isActive: true,
    ...overrides,
  }
}

function opening(glAccountId: string, debit: number, credit: number) {
  return { glAccountId, debitMinor: String(debit), creditMinor: String(credit) }
}

function line(input: {
  glAccountId: string
  txnDate: string
  direction: 'debit' | 'credit'
  amountMinor: number
  docNumber?: string
  glPostingId?: string
  memo?: string | null
}) {
  return {
    glPostingId: input.glPostingId ?? `gl_${input.docNumber ?? input.txnDate}`,
    docNumber: input.docNumber ?? 'JNL-0001',
    memo: input.memo ?? null,
    ...input,
    amountMinor: String(input.amountMinor),
  }
}

const RANGE = { from: '2026-08-01', to: '2026-08-31' } as const

describe('readGeneralLedger', () => {
  it('groups by account IDENTITY, so a renumbered account is still ONE section', async () => {
    // The chart says this id is `1150` today. Whatever code its older lines
    // carried is never read - which is the whole point of task 15 §3, and the
    // reason this read cannot be written as `GROUP BY accountCode`.
    vi.mocked(listChartAccounts).mockResolvedValue(
      ok([
        account({ id: 'id_prepaid', code: '1150', name: 'Prepaid Expenses' }),
        account({ id: 'id_cash', code: '1000', name: 'Cash' }),
      ])
    )

    const result = await readGeneralLedger(
      stubDb([
        [],
        [
          // Posted while the account was still `1100`...
          line({
            glAccountId: 'id_prepaid',
            txnDate: '2026-08-02',
            direction: 'debit',
            amountMinor: 30_000,
            docNumber: 'JNL-0001',
          }),
          // ...and after it was renumbered to `1150`.
          line({
            glAccountId: 'id_prepaid',
            txnDate: '2026-08-20',
            direction: 'credit',
            amountMinor: 10_000,
            docNumber: 'JNL-0009',
          }),
          line({
            glAccountId: 'id_cash',
            txnDate: '2026-08-02',
            direction: 'credit',
            amountMinor: 30_000,
            docNumber: 'JNL-0001',
          }),
        ],
      ]),
      { organizationId: ORG, ...RANGE }
    )

    const gl = result._unsafeUnwrap()
    const prepaid = gl.accounts.filter((a) => a.glAccountId === 'id_prepaid')
    expect(prepaid).toHaveLength(1)
    expect(prepaid[0]?.accountCode).toBe('1150')
    expect(prepaid[0]?.lines).toHaveLength(2)
    expect(prepaid[0]?.endingBalanceMinor).toBe(20_000)
    // Two accounts, in the trial balance's own statement-then-code order.
    expect(gl.accounts.map((a) => a.accountCode)).toEqual(['1000', '1150'])
  })

  it('carries the opening balance into the FIRST line`s running balance', async () => {
    vi.mocked(listChartAccounts).mockResolvedValue(
      ok([account({ id: 'id_cash', code: '1000', name: 'Cash', accountType: 'asset' })])
    )

    const result = await readGeneralLedger(
      stubDb([
        [opening('id_cash', 50_000, 0)],
        [
          line({
            glAccountId: 'id_cash',
            txnDate: '2026-08-10',
            direction: 'debit',
            amountMinor: 5_000,
          }),
          line({
            glAccountId: 'id_cash',
            txnDate: '2026-08-12',
            direction: 'credit',
            amountMinor: 2_000,
            docNumber: 'JNL-0002',
          }),
        ],
      ]),
      { organizationId: ORG, ...RANGE }
    )

    const cash = result._unsafeUnwrap().accounts[0]
    expect(cash?.openingBalanceMinor).toBe(50_000)
    expect(cash?.lines.map((l) => l.runningBalanceMinor)).toEqual([55_000, 53_000])
    expect(cash?.endingBalanceMinor).toBe(53_000)
    expect(cash?.debitMinor).toBe(5_000)
    expect(cash?.creditMinor).toBe(2_000)
  })

  it('signs the opening balance credit-natural for a liability account', async () => {
    vi.mocked(listChartAccounts).mockResolvedValue(
      ok([account({ id: 'id_ap', code: '2000', name: 'A/P', accountType: 'liability' })])
    )

    const result = await readGeneralLedger(
      stubDb([
        [opening('id_ap', 0, 40_000)],
        [
          line({
            glAccountId: 'id_ap',
            txnDate: '2026-08-04',
            direction: 'debit',
            amountMinor: 15_000,
          }),
        ],
      ]),
      { organizationId: ORG, ...RANGE }
    )

    const ap = result._unsafeUnwrap().accounts[0]
    expect(ap?.openingBalanceMinor).toBe(40_000)
    expect(ap?.lines[0]?.runningBalanceMinor).toBe(25_000)
  })

  it('keeps an account that has an opening balance but NO lines in the range', async () => {
    // The account is quiet this month, not gone. Its brought-forward position
    // is what an accountant is reconciling against, so dropping it would make
    // the ledger disagree with the balance sheet for the same date.
    vi.mocked(listChartAccounts).mockResolvedValue(
      ok([
        account({ id: 'id_cash', code: '1000', name: 'Cash' }),
        account({ id: 'id_equip', code: '1500', name: 'Equipment' }),
      ])
    )

    const result = await readGeneralLedger(
      stubDb([
        [opening('id_equip', 250_000, 0)],
        [
          line({
            glAccountId: 'id_cash',
            txnDate: '2026-08-10',
            direction: 'debit',
            amountMinor: 1_000,
          }),
        ],
      ]),
      { organizationId: ORG, ...RANGE }
    )

    const equipment = result._unsafeUnwrap().accounts.find((a) => a.glAccountId === 'id_equip')
    expect(equipment).toBeDefined()
    expect(equipment?.lines).toEqual([])
    expect(equipment?.openingBalanceMinor).toBe(250_000)
    expect(equipment?.endingBalanceMinor).toBe(250_000)
    expect(equipment?.debitMinor).toBe(0)
  })

  it('omits an account that is both untouched in the range and flat before it', async () => {
    vi.mocked(listChartAccounts).mockResolvedValue(
      ok([account({ id: 'id_cash', code: '1000' }), account({ id: 'id_susp', code: '1999' })])
    )

    const result = await readGeneralLedger(
      stubDb([
        // A suspense account that has netted to zero: nothing to say about it.
        [opening('id_susp', 10_000, 10_000)],
        [
          line({
            glAccountId: 'id_cash',
            txnDate: '2026-08-10',
            direction: 'debit',
            amountMinor: 1_000,
          }),
        ],
      ]),
      { organizationId: ORG, ...RANGE }
    )

    expect(result._unsafeUnwrap().accounts.map((a) => a.glAccountId)).toEqual(['id_cash'])
  })

  it('is balanced over a real posted set, and says so when it is not', async () => {
    vi.mocked(listChartAccounts).mockResolvedValue(
      ok([
        account({ id: 'id_cash', code: '1000', name: 'Cash', accountType: 'asset' }),
        account({ id: 'id_rev', code: '4000', name: 'Sales', accountType: 'revenue' }),
      ])
    )

    const balancedLines = [
      line({
        glAccountId: 'id_cash',
        txnDate: '2026-08-03',
        direction: 'debit',
        amountMinor: 120_000,
      }),
      line({
        glAccountId: 'id_rev',
        txnDate: '2026-08-03',
        direction: 'credit',
        amountMinor: 120_000,
      }),
    ]

    const balanced = await readGeneralLedger(stubDb([[], balancedLines]), {
      organizationId: ORG,
      ...RANGE,
    })
    const gl = balanced._unsafeUnwrap()
    expect(gl.totalDebitMinor).toBe(120_000)
    expect(gl.totalCreditMinor).toBe(120_000)
    expect(gl.balanced).toBe(true)
    expect(gl.truncated).toBe(false)

    const lopsided = await readGeneralLedger(stubDb([[], [balancedLines[0]]]), {
      organizationId: ORG,
      ...RANGE,
    })
    expect(lopsided._unsafeUnwrap().balanced).toBe(false)
  })

  it('bounds the range INCLUSIVELY on `to`, so the last day of the month is in it', async () => {
    vi.mocked(listChartAccounts).mockResolvedValue(ok([account({ id: 'id_cash', code: '1000' })]))
    const capture: Capture = { where: [], limit: [] }

    await readGeneralLedger(stubDb([[], []], capture), { organizationId: ORG, ...RANGE })

    const dialect = new PgDialect()
    // The lines query is the second `select()`. Serialized, its bounds have to
    // read `>= from` and `<= to` - a `<` on `to` would silently drop every
    // entry posted on the closing day, which is the busiest day of a month.
    const lines = dialect.sqlToQuery(capture.where[1] as SqlCondition)
    expect(lines.params).toEqual([ORG, 'posted', 'reversed', RANGE.from, RANGE.to])
    expect(lines.sql).toContain('>= $4')
    expect(lines.sql).toContain('<= $5')
    expect(lines.sql).not.toContain('< $5')

    // And the opening aggregate stops the day BEFORE `from`, so no line is
    // counted on both sides of the boundary.
    const openingQuery = dialect.sqlToQuery(capture.where[0] as SqlCondition)
    expect(openingQuery.params).toEqual([ORG, 'posted', 'reversed', '2026-07-31'])
    expect(openingQuery.sql).toContain('<= $4')
  })

  it('sets `truncated` and stops at `maxLines`, applying the cap in SQL', async () => {
    vi.mocked(listChartAccounts).mockResolvedValue(ok([account({ id: 'id_cash', code: '1000' })]))
    const capture: Capture = { where: [], limit: [] }

    const four = [1, 2, 3, 4].map((n) =>
      line({
        glAccountId: 'id_cash',
        txnDate: `2026-08-0${n}`,
        direction: 'debit',
        amountMinor: 1_000,
        docNumber: `JNL-000${n}`,
      })
    )

    const result = await readGeneralLedger(stubDb([[], four], capture), {
      organizationId: ORG,
      ...RANGE,
      maxLines: 3,
    })

    const gl = result._unsafeUnwrap()
    expect(gl.truncated).toBe(true)
    expect(gl.accounts[0]?.lines).toHaveLength(3)
    // 🛑 `maxLines + 1` in SQL: the extra row is what distinguishes "there was
    // more" from "that was exactly all of it", and a `LIMIT` is what keeps the
    // guard a guard rather than a post-hoc slice of rows already in memory.
    expect(capture.limit[1]).toBe(4)
  })

  it('does NOT set `truncated` when the range ends exactly at `maxLines`', async () => {
    vi.mocked(listChartAccounts).mockResolvedValue(ok([account({ id: 'id_cash', code: '1000' })]))

    const three = [1, 2, 3].map((n) =>
      line({
        glAccountId: 'id_cash',
        txnDate: `2026-08-0${n}`,
        direction: 'debit',
        amountMinor: 1_000,
        docNumber: `JNL-000${n}`,
      })
    )

    const result = await readGeneralLedger(stubDb([[], three]), {
      organizationId: ORG,
      ...RANGE,
      maxLines: 3,
    })

    expect(result._unsafeUnwrap().truncated).toBe(false)
    expect(result._unsafeUnwrap().accounts[0]?.lines).toHaveLength(3)
  })

  it('applies no LIMIT at all when `maxLines` is omitted', async () => {
    vi.mocked(listChartAccounts).mockResolvedValue(ok([account({ id: 'id_cash', code: '1000' })]))
    const capture: Capture = { where: [], limit: [] }

    await readGeneralLedger(stubDb([[], []], capture), { organizationId: ORG, ...RANGE })

    expect(capture.limit[1]).toBeUndefined()
  })

  it('still shows an account that has been DELETED from the chart, unsigned', async () => {
    // Decision P2: a line stores an account id with no foreign key, so the
    // ledger outlives the chart. Dropping the section would lose posted
    // history and break the tie-out with the trial balance, which keeps it.
    vi.mocked(listChartAccounts).mockResolvedValue(ok([]))

    const result = await readGeneralLedger(
      stubDb([
        [opening('id_gone', 7_000, 0)],
        [
          line({
            glAccountId: 'id_gone',
            txnDate: '2026-08-09',
            direction: 'credit',
            amountMinor: 2_000,
          }),
        ],
      ]),
      { organizationId: ORG, ...RANGE }
    )

    const gone = result._unsafeUnwrap().accounts[0]
    expect(gone?.glAccountId).toBe('id_gone')
    expect(gone?.accountType).toBeNull()
    expect(gone?.accountName).toBe('')
    expect(gone?.accountCode).toBeNull()
    // Unsigned: debit minus credit, because there is no natural side left.
    expect(gone?.openingBalanceMinor).toBe(7_000)
    expect(gone?.lines[0]?.runningBalanceMinor).toBe(5_000)
  })

  it('refuses a range whose `to` is before its `from`', async () => {
    vi.mocked(listChartAccounts).mockResolvedValue(ok([]))

    const result = await readGeneralLedger(stubDb([[], []]), {
      organizationId: ORG,
      from: '2026-08-31',
      to: '2026-08-01',
    })

    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr().message).toContain('before')
  })

  it('the cap is a real number, and generous enough that a small company never meets it', () => {
    expect(GENERAL_LEDGER_MAX_LINES).toBeGreaterThanOrEqual(10_000)
  })
})

describe('toGeneralLedgerRows', () => {
  const gl = {
    organizationId: ORG,
    from: RANGE.from,
    to: RANGE.to,
    accounts: [
      {
        glAccountId: 'id_cash',
        accountCode: '1000',
        accountName: 'Cash',
        accountType: 'asset' as const,
        openingBalanceMinor: 50_000,
        lines: [
          {
            glPostingId: 'gl_1',
            docNumber: 'JNL-0001',
            txnDate: '2026-08-10',
            memo: 'Deposit',
            direction: 'debit' as const,
            amountMinor: 5_000,
            runningBalanceMinor: 55_000,
          },
          {
            glPostingId: 'gl_2',
            docNumber: 'JNL-0002',
            txnDate: '2026-08-12',
            memo: null,
            direction: 'credit' as const,
            amountMinor: 2_000,
            runningBalanceMinor: 53_000,
          },
        ],
        endingBalanceMinor: 53_000,
        debitMinor: 5_000,
        creditMinor: 2_000,
      },
    ],
    totalDebitMinor: 5_000,
    totalCreditMinor: 2_000,
    balanced: false,
    truncated: false,
  }

  it('renders one section per account, opening first and ending last', () => {
    const rows = toGeneralLedgerRows(gl)
    expect(rows.map((r) => r.id)).toEqual(['id_cash', 'total'])

    const section = rows[0]
    expect(section?.kind).toBe('section')
    expect(section?.label).toBe('1000 Cash')
    expect(section?.children?.map((c) => c.label)).toEqual([
      'Opening balance',
      '2026-08-10  JNL-0001',
      '2026-08-12  JNL-0002',
      'Ending balance',
    ])
    // The memo has no column of its own (see `GENERAL_LEDGER_COLUMNS`), so it
    // rides the row as its description.
    expect(section?.children?.[1]?.meta?.note).toBe('Deposit')
    // Debit and credit in their own columns, the running balance in the third.
    expect(section?.children?.[1]?.values).toEqual([5_000, null, 55_000])
    expect(section?.children?.[2]?.values).toEqual([null, 2_000, 53_000])
  })

  it('never SUMS the running-balance column - the section and its closing row carry the ENDING balance', () => {
    // `statementSection` sums every column, which is right for debit and credit
    // and nonsense for a balance: 55,000 + 53,000 is not a position.
    const rows = toGeneralLedgerRows(gl)
    const section = rows[0]
    expect(section?.values).toEqual([5_000, 2_000, 53_000])
    const closing = section?.children?.at(-1)
    expect(closing?.values).toEqual([5_000, 2_000, 53_000])
  })

  it('prints an INCOMPLETE banner as the FIRST row when the ledger is truncated', () => {
    // 🛑 A `truncated: true` field on a JSON response never reaches the person
    // reading the CSV or the PDF. A row does.
    const rows = toGeneralLedgerRows({ ...gl, truncated: true })
    expect(rows[0]?.id).toBe('truncated')
    expect(rows[0]?.label).toContain('INCOMPLETE')
    expect(rows[0]?.label).toContain('2 lines')
    expect(rows[0]?.label).toContain('does not tie')
    expect(rows.map((r) => r.id)).toEqual(['truncated', 'id_cash', 'total'])
  })

  it('labels a deleted account by its id, and flags it', () => {
    const rows = toGeneralLedgerRows({
      ...gl,
      accounts: [
        {
          ...gl.accounts[0]!,
          glAccountId: 'id_gone',
          accountCode: null,
          accountName: '',
          accountType: null,
        },
      ],
    })
    expect(rows[0]?.label).toBe('id_gone')
    expect(rows[0]?.meta?.note).toContain('deleted from the current chart')
  })
})
