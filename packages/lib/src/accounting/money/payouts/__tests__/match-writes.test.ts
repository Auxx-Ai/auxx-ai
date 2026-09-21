// packages/lib/src/accounting/money/payouts/__tests__/match-writes.test.ts
import type { Database } from '@auxx/database'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ mark: vi.fn() }))
vi.mock('../payout-reconciler', () => ({
  PAYOUT_ASSESSMENT: 'money.payout-assessment',
  markPayoutForAssessment: state.mark,
}))

import { acceptMatch, matchEntry, unmatchEntry } from '../match-writes'

function database(results: unknown[][], frozen: unknown[] = [], movements: unknown[] = []) {
  const updates: Array<Record<string, unknown>> = []
  const chain = (rows: unknown[]) => {
    const link: Record<string, unknown> = {}
    for (const key of ['from', 'innerJoin', 'where', 'orderBy', 'limit']) link[key] = () => link
    // biome-ignore lint/suspicious/noThenProperty: Drizzle query builders are awaitable.
    link.then = (resolve: (value: unknown[]) => void) => Promise.resolve(rows).then(resolve)
    return link
  }
  // The linked-posting read is an ordinary `select` since R2, and every writer
  // here makes it straight after reading the entry.
  const queue = [results[0] ?? [], frozen, ...results.slice(1)]
  const db = {
    select: vi.fn(() => {
      const rows = queue.shift()
      if (!rows) throw new Error('Unexpected extra query')
      return chain(rows)
    }),
    query: { MoneyTransaction: { findMany: async () => movements } },
    update: vi.fn(() => ({
      set: (values: Record<string, unknown>) => {
        updates.push(values)
        return { where: () => Promise.resolve() }
      },
    })),
  }
  return { db: db as unknown as Database, updates, update: db.update }
}

const entry = (overrides: Record<string, unknown> = {}) => ({
  id: 'entry-1',
  organizationId: 'org',
  matchState: 'suggested',
  matchedMoneyTransactionId: 'mt-1',
  matchReason: 'amount_differs',
  matchedBy: null,
  ...overrides,
})

beforeEach(() => state.mark.mockReset())

describe('match writes', () => {
  it('accepts a suggestion, keeping the code and naming the person', async () => {
    const { db, updates } = database([[entry()]])
    const result = await acceptMatch(db, {
      organizationId: 'org',
      entryId: 'entry-1',
      userId: 'user-1',
    })
    expect(result._unsafeUnwrap()).toMatchObject({
      matchState: 'matched',
      matchReason: 'amount_differs',
      matchedBy: 'user-1',
    })
    expect(updates[0]).toMatchObject({ matchState: 'matched', matchedBy: 'user-1' })
    expect(state.mark).toHaveBeenCalledWith('org', 'user-1', 'entry-1')
  })

  it('refuses to accept an item with no suggestion', async () => {
    const { db, update } = database([
      [entry({ matchState: 'pending', matchedMoneyTransactionId: null })],
    ])
    const result = await acceptMatch(db, {
      organizationId: 'org',
      entryId: 'entry-1',
      userId: 'user-1',
    })
    expect(result._unsafeUnwrapErr().message).toMatch('no suggested receipt')
    expect(update).not.toHaveBeenCalled()
  })

  it('records a manual match against an item the matcher had no code for', async () => {
    const { db, updates } = database(
      [[entry({ matchState: 'pending', matchReason: null })]],
      [],
      [{ id: 'mt-9' }]
    )
    const result = await matchEntry(db, {
      organizationId: 'org',
      entryId: 'entry-1',
      moneyTransactionId: 'mt-9',
      userId: 'user-1',
    })
    expect(result._unsafeUnwrap()).toMatchObject({
      matchState: 'matched',
      matchedMoneyTransactionId: 'mt-9',
      matchReason: 'manual',
    })
    expect(updates[0]).toMatchObject({ matchedBy: 'user-1' })
  })

  it('refuses a manual match on an item a live posting names', async () => {
    const { db, update } = database([[entry()]], [{ sourceId: 'entry-1' }])
    const result = await matchEntry(db, {
      organizationId: 'org',
      entryId: 'entry-1',
      moneyTransactionId: 'mt-9',
      userId: 'user-1',
    })
    expect(result._unsafeUnwrapErr().message).toMatch('Reverse it to re-match')
    expect(update).not.toHaveBeenCalled()
    expect(state.mark).not.toHaveBeenCalled()
  })

  it('unmatches back to pending, clearing the person and the code', async () => {
    const { db, updates } = database([[entry({ matchState: 'matched' })]], [])
    const result = await unmatchEntry(db, {
      organizationId: 'org',
      entryId: 'entry-1',
      userId: 'user-1',
    })
    expect(result._unsafeUnwrap().matchState).toBe('pending')
    expect(updates[0]).toMatchObject({
      matchState: 'pending',
      matchedMoneyTransactionId: null,
      matchReason: null,
      matchedBy: null,
      matchedAt: null,
    })
  })

  it('refuses to unmatch an item a live posting names (§9.1)', async () => {
    const { db, update } = database([[entry({ matchState: 'matched' })]], [{ sourceId: 'entry-1' }])
    const result = await unmatchEntry(db, {
      organizationId: 'org',
      entryId: 'entry-1',
      userId: 'user-1',
    })
    expect(result._unsafeUnwrapErr().message).toMatch('Reverse it to unmatch')
    expect(update).not.toHaveBeenCalled()
  })

  it('reports a missing item rather than writing one', async () => {
    const { db, update } = database([[]])
    const result = await acceptMatch(db, {
      organizationId: 'org',
      entryId: 'nope',
      userId: 'user-1',
    })
    expect(result._unsafeUnwrapErr().message).toMatch('not found')
    expect(update).not.toHaveBeenCalled()
  })
})
