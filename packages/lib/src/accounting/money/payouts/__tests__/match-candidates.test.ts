// packages/lib/src/accounting/money/payouts/__tests__/match-candidates.test.ts
import type { Database } from '@auxx/database'
import { describe, expect, it, vi } from 'vitest'
import { listMatchCandidates } from '../match-candidates'

/** Whether a value appears anywhere in a drizzle condition tree. */
function mentions(value: unknown, needle: string): boolean {
  if (value === needle) return true
  if (Array.isArray(value)) return value.some((item) => mentions(item, needle))
  if (value && typeof value === 'object')
    return Object.values(value).some((item) => mentions(item, needle))
  return false
}

function database(results: unknown[][], applications: unknown[] = []) {
  const wheres: unknown[] = []
  const chain = (rows: unknown[]) => {
    const link: Record<string, unknown> = {}
    for (const key of ['from', 'innerJoin', 'leftJoin', 'orderBy', 'limit']) link[key] = () => link
    link.where = (condition: unknown) => {
      wheres.push(condition)
      return link
    }
    // biome-ignore lint/suspicious/noThenProperty: Drizzle query builders are awaitable.
    link.then = (resolve: (value: unknown[]) => void) => Promise.resolve(rows).then(resolve)
    return link
  }
  const db = {
    select: vi.fn(() => {
      const rows = results.shift()
      if (!rows) throw new Error('Unexpected extra query')
      return chain(rows)
    }),
    query: { MoneyApplication: { findMany: async () => applications } },
  }
  return { db: db as unknown as Database, wheres }
}

const entry = (paymentGatewayId: string | null) => [
  {
    entry: {
      id: 'entry-1',
      type: 'charge',
      grossMinor: 10000n,
      currency: 'USD',
      currencyExponent: 2,
    },
    paymentGatewayId,
  },
]
const money = {
  id: 'mt-1',
  amountMinor: 9500n,
  currency: 'USD',
  currencyExponent: 2,
  occurredAt: null,
  occurredOn: '2026-09-15',
  reference: 'pi_1',
}

describe('listMatchCandidates', () => {
  it('pins candidates to the item rail when the feed has one', async () => {
    const { db, wheres } = database([
      entry('rail-sp'),
      [{ money, paymentGatewayId: 'rail-sp', differenceMinor: '-500' }],
      [],
    ])
    const result = await listMatchCandidates(db, { organizationId: 'org', entryId: 'entry-1' })
    expect(result._unsafeUnwrap()[0]).toMatchObject({
      moneyTransactionId: 'mt-1',
      differenceMinor: '-500',
      paymentGatewayId: 'rail-sp',
      documents: [],
    })
    expect(mentions(wheres[1], 'rail-sp')).toBe(true)
  })

  it('drops the rail filter for a feed that has no rail at all', async () => {
    const { db, wheres } = database([
      entry(null),
      [{ money, paymentGatewayId: null, differenceMinor: '-500' }],
      [],
    ])
    await listMatchCandidates(db, { organizationId: 'org', entryId: 'entry-1' })
    expect(mentions(wheres[1], 'rail-sp')).toBe(false)
  })

  it('reports a missing item rather than an empty list', async () => {
    const { db } = database([[]])
    const result = await listMatchCandidates(db, { organizationId: 'org', entryId: 'nope' })
    expect(result._unsafeUnwrapErr().message).toMatch('not found')
  })
})
