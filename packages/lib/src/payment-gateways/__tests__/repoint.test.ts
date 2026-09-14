// packages/lib/src/payment-gateways/__tests__/repoint.test.ts
//
// `readClearingAccountBalance` - what the editor says a repoint is about to
// strand (`plans/accounting/tasks/26-a-clearing-account-per-rail.md` §9.1).
//
// The double cannot see the SQL, so what is pinned here is the arithmetic and
// the driver-shape tolerance: the sums arrive as STRINGS (a `bigint` column
// summed is a `numeric`, and the driver hands numerics back as strings), an
// account with no postings answers zeroes rather than throwing, and the balance
// is debits minus credits so a clearing account that has been over-settled
// reports negative rather than absolute.

import { describe, expect, it } from 'vitest'

/** One query stage: chainable and awaitable, resolving to `rows`. */
function stage(rows: unknown[]): unknown {
  const chain: Record<string, unknown> = {}
  for (const method of ['from', 'innerJoin', 'where', 'groupBy', 'limit']) {
    chain[method] = () => stage(rows)
  }
  return Object.assign(Promise.resolve(rows), chain)
}

function fakeDb(rows: unknown[]) {
  return { select: () => stage(rows) } as never
}

const { readClearingAccountBalance } = await import('../repoint')

const PARAMS = { organizationId: 'org_1', glAccountId: 'gl_1200' }

describe('readClearingAccountBalance', () => {
  it('nets the string-shaped sums into a signed asset balance', async () => {
    const result = await readClearingAccountBalance(
      fakeDb([
        {
          debitMinor: '540000',
          creditMinor: '125000',
          lineCount: 412,
          lastTxnDate: '2026-03-11',
        },
      ]),
      PARAMS
    )

    expect(result._unsafeUnwrap()).toEqual({
      glAccountId: 'gl_1200',
      debitMinor: 540_000,
      creditMinor: 125_000,
      balanceMinor: 415_000,
      lineCount: 412,
      lastTxnDate: '2026-03-11',
    })
  })

  it('reports a negative balance rather than an absolute one', async () => {
    // An over-settled clearing account is a real state and hiding its sign
    // would turn "you are about to strand a credit" into "a debit".
    const result = await readClearingAccountBalance(
      fakeDb([{ debitMinor: '100', creditMinor: '900', lineCount: 4, lastTxnDate: '2026-01-01' }]),
      PARAMS
    )

    expect(result._unsafeUnwrap().balanceMinor).toBe(-800)
  })

  it('answers zeroes for an account with no postings, never a refusal', async () => {
    // 🔑 This is the ordinary case for a rail that has never shipped, and it is
    // what tells the editor there is nothing to warn about.
    const result = await readClearingAccountBalance(
      fakeDb([{ debitMinor: '0', creditMinor: '0', lineCount: 0, lastTxnDate: null }]),
      PARAMS
    )

    expect(result._unsafeUnwrap()).toEqual({
      glAccountId: 'gl_1200',
      debitMinor: 0,
      creditMinor: 0,
      balanceMinor: 0,
      lineCount: 0,
      lastTxnDate: null,
    })
  })

  it('answers zeroes when the aggregate returns no row at all', async () => {
    const result = await readClearingAccountBalance(fakeDb([]), PARAMS)
    expect(result._unsafeUnwrap().lineCount).toBe(0)
    expect(result._unsafeUnwrap().balanceMinor).toBe(0)
  })

  it('a zero balance with lines is still history - the caller gates on lineCount', async () => {
    // An account that has taken hundreds of lines and happens to be square this
    // afternoon is exactly the one somebody repoints without thinking.
    const result = await readClearingAccountBalance(
      fakeDb([
        { debitMinor: '900000', creditMinor: '900000', lineCount: 883, lastTxnDate: '2026-09-01' },
      ]),
      PARAMS
    )

    expect(result._unsafeUnwrap().balanceMinor).toBe(0)
    expect(result._unsafeUnwrap().lineCount).toBe(883)
  })

  it('converts an unexpected throw into an internal-error Result, never a rejection', async () => {
    const db = {
      select: () => {
        throw new Error('connection reset')
      },
    } as never

    const result = await readClearingAccountBalance(db, PARAMS)
    expect(result.isErr()).toBe(true)
  })
})
