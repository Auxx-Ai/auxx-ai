// packages/lib/src/postings/reports/__tests__/account-lines.test.ts

import type { Database } from '@auxx/database'
import { ok } from 'neverthrow'
import { describe, expect, it, vi } from 'vitest'
import type { ChartAccountRow } from '../../types'

vi.mock('../../role-map', () => ({ listChartAccounts: vi.fn() }))

import { listChartAccounts } from '../../role-map'
import { readAccountLines } from '../account-lines'

const ORG = 'org_1'

/**
 * `readAccountLines` issues `db.select()` up to twice - the opening-balance
 * sum (only when `from` is given), then the line list. Each gets its own row
 * set, dispensed in call order.
 */
function sequentialDb(rowSets: unknown[][]): Database {
  let call = 0
  return {
    select: () => {
      const rows = rowSets[call] ?? []
      call += 1
      const chain: Record<string, unknown> = {}
      const passthrough = () => chain
      for (const method of ['from', 'innerJoin', 'where', 'orderBy']) chain[method] = passthrough
      // biome-ignore lint/suspicious/noThenProperty: the stub must be awaitable
      chain.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
        Promise.resolve(rows).then(resolve, reject)
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

function line(overrides: {
  glPostingId: string
  docNumber: string
  txnDate: string
  direction: 'debit' | 'credit'
  amountMinor: number
  memo?: string | null
  lineNumber?: number
}) {
  return { memo: null, lineNumber: 1, ...overrides }
}

describe('readAccountLines', () => {
  it('runs a natural-sign running balance through an asset account', async () => {
    vi.mocked(listChartAccounts).mockResolvedValue(
      ok([account({ code: '1000', name: 'Cash', accountType: 'asset' })])
    )

    const result = await readAccountLines(
      sequentialDb([
        [
          line({
            glPostingId: 'gl_1',
            docNumber: 'JNL-0001',
            txnDate: '2026-08-01',
            direction: 'debit',
            amountMinor: 10_000,
          }),
          line({
            glPostingId: 'gl_2',
            docNumber: 'JNL-0002',
            txnDate: '2026-08-05',
            direction: 'credit',
            amountMinor: 4_000,
          }),
        ],
      ]),
      { organizationId: ORG, glAccountId: 'id_1000' }
    )

    const lines = result._unsafeUnwrap()
    expect(lines.openingBalanceMinor).toBe(0)
    expect(lines.lines.map((l) => l.runningBalanceMinor)).toEqual([10_000, 6_000])
    expect(lines.endingBalanceMinor).toBe(6_000)
  })

  it('carries an opening balance from before `from`, then continues the running balance', async () => {
    vi.mocked(listChartAccounts).mockResolvedValue(
      ok([account({ code: '1000', accountType: 'asset' })])
    )

    const result = await readAccountLines(
      sequentialDb([
        // The opening-balance sum, for everything before `from`.
        [{ debitMinor: '50000', creditMinor: '0' }],
        // The lines within [from, to].
        [
          line({
            glPostingId: 'gl_3',
            docNumber: 'JNL-0003',
            txnDate: '2026-08-10',
            direction: 'debit',
            amountMinor: 5_000,
          }),
        ],
      ]),
      { organizationId: ORG, glAccountId: 'id_1000', from: '2026-08-01', to: '2026-08-31' }
    )

    const lines = result._unsafeUnwrap()
    expect(lines.openingBalanceMinor).toBe(50_000)
    expect(lines.lines[0]?.runningBalanceMinor).toBe(55_000)
    expect(lines.endingBalanceMinor).toBe(55_000)
  })

  it('signs the running balance credit-natural for a liability account', async () => {
    vi.mocked(listChartAccounts).mockResolvedValue(
      ok([account({ code: '2000', accountType: 'liability' })])
    )

    const result = await readAccountLines(
      sequentialDb([
        [
          line({
            glPostingId: 'gl_1',
            docNumber: 'JNL-0001',
            txnDate: '2026-08-01',
            direction: 'credit',
            amountMinor: 1_000,
          }),
        ],
      ]),
      { organizationId: ORG, glAccountId: 'id_2000' }
    )

    expect(result._unsafeUnwrap().lines[0]?.runningBalanceMinor).toBe(1_000)
  })

  it('reports accountType null and an empty name when the id is not in the chart', async () => {
    vi.mocked(listChartAccounts).mockResolvedValue(ok([]))

    const result = await readAccountLines(sequentialDb([[]]), {
      organizationId: ORG,
      glAccountId: 'id_9999',
    })
    const lines = result._unsafeUnwrap()

    expect(lines.accountType).toBeNull()
    expect(lines.accountName).toBe('')
  })

  // Task 15 §5: a live account with no code is a normal account, not an
  // orphan - the drill-down reads by `glAccountId` and renders the name, and
  // `accountCode` comes back null rather than the empty string a DELETED
  // account renders (see the test above).
  it('reads by id and reports a null accountCode for an account with no code', async () => {
    vi.mocked(listChartAccounts).mockResolvedValue(
      ok([
        account({ code: null, id: 'id_nocode', name: 'Imported Checking', accountType: 'asset' }),
      ])
    )

    const result = await readAccountLines(
      sequentialDb([
        [
          line({
            glPostingId: 'gl_1',
            docNumber: 'JNL-0001',
            txnDate: '2026-08-01',
            direction: 'debit',
            amountMinor: 2_500,
          }),
        ],
      ]),
      { organizationId: ORG, glAccountId: 'id_nocode' }
    )
    const lines = result._unsafeUnwrap()

    expect(lines.accountCode).toBeNull()
    expect(lines.accountName).toBe('Imported Checking')
    expect(lines.lines[0]?.runningBalanceMinor).toBe(2_500)
  })
})
