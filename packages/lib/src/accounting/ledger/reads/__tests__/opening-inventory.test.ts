// packages/lib/src/accounting/ledger/reads/__tests__/opening-inventory.test.ts
//
// The ledger's side of the opening inventory difference: the opening entry plus every
// difference entry, all occurrences summed, and how many stand posted (111 Q23).

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  counted: [] as Array<{ entries: string }>,
  grouped: [] as Array<{ glAccountId: string; sourceType: string | null; netMinor: string }>,
  queries: 0,
}))

import { readOpeningInventoryLedger } from '../opening-inventory'

/** Told apart by shape: the count has no `groupBy`. */
const db = { select: () => chain() } as never

function chain() {
  h.queries += 1
  const state = { grouped: false }
  const link: Record<string, unknown> = {}
  for (const step of ['from', 'innerJoin', 'where']) link[step] = () => link
  link.groupBy = () => {
    state.grouped = true
    return link
  }
  // biome-ignore lint/suspicious/noThenProperty: the double stands in for a drizzle query builder, which IS awaitable
  link.then = (resolve: (rows: unknown[]) => unknown, reject: (error: unknown) => unknown) =>
    Promise.resolve((state.grouped ? h.grouped : h.counted) as unknown[]).then(resolve, reject)
  return link
}

beforeEach(() => {
  h.counted = [{ entries: '0' }]
  h.grouped = []
  h.queries = 0
})

describe('readOpeningInventoryLedger', () => {
  it('splits the opening entry from the difference entries, per account, and sums every occurrence', async () => {
    h.counted = [{ entries: '2' }]
    h.grouped = [
      { glAccountId: 'inv', sourceType: null, netMinor: '120000' },
      { glAccountId: 'inv', sourceType: 'opening_inventory_adjustment', netMinor: '-15000' },
      { glAccountId: 'fg', sourceType: 'fulfillment_line', netMinor: '300' },
    ]
    const ledger = await readOpeningInventoryLedger(db, 'org_1', ['inv', 'fg'])

    expect(ledger.openingByAccount).toEqual(
      new Map([
        ['inv', 120_000],
        ['fg', 300],
      ])
    )
    expect(ledger.adjustmentByAccount).toEqual(new Map([['inv', -15_000]]))
    expect(ledger.differenceEntries).toBe(2)
  })

  it('still counts the posted difference entries when there is no inventory account to read', async () => {
    h.counted = [{ entries: '1' }]
    const ledger = await readOpeningInventoryLedger(db, 'org_1', [])
    expect(ledger.differenceEntries).toBe(1)
    expect(ledger.openingByAccount.size).toBe(0)
    expect(h.queries).toBe(1)
  })
})
