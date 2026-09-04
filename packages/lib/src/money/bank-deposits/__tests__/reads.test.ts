// packages/lib/src/money/bank-deposits/__tests__/reads.test.ts
//
// Two properties, and both of them fail SILENTLY in production:
//
//  1. **A date read back out of `FieldValue` is a TIMESTAMP, not a day.**
//     `valueDate` is `timestamp(3) with time zone` in `mode: 'string'`, so
//     `'2026-09-03'` written comes back `'2026-09-03 00:00:00+00'`. Every
//     consumer of `depositDate` and payment `date` is typed and compared as
//     `YYYY-MM-DD`: `updateBankDeposit` compares the caller's date against the
//     stored one to decide whether the date actually changed, so the comparison
//     ALWAYS differed and an edit that only touched the reference came back as a
//     ConflictError about a date nobody had entered.
//
//  2. **The undeposited list and `createBankDeposit` must resolve the same
//     payment the same way.** The list narrowed on `payment_method` with an
//     INNER join, so a payment with no method never appeared - while
//     `resolvePaymentRoute(null, settings)` falls through to the `other` row and
//     `postPaymentTransaction` had already put that payment's money in 1050. The
//     money sat in undeposited funds with no door that could bank it.
//
// The database is a scripted stub: each awaited query takes the next queued
// result, and the join methods are COUNTED so the INNER-vs-LEFT decision is
// assertable without a real planner. Counted rather than named, because the
// query already carries a second LEFT join - the "in no deposit" half - and the
// stub cannot see which field a join predicate names.

import type { Database } from '@auxx/database'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  settings: {} as Record<string, unknown>,
  /** One array per awaited query, consumed in order. */
  results: [] as unknown[][],
  /** Every chained builder method, in order - `innerJoin` / `leftJoin` included. */
  calls: [] as string[],
}))

vi.mock('../../../cache', () => ({
  getCachedEntityDefId: async (_org: string, slug: string) => `def_${slug}`,
  getOrgCache: () => ({
    get: async () => h.settings,
    from: () => ({
      bySystemAttributes: async (attributes: string[]) =>
        Object.fromEntries(attributes.map((attribute) => [attribute, { id: `fld_${attribute}` }])),
    }),
  }),
}))

const { listUndepositedPayments, readBankDepositDetail } = await import('../reads')

/** How many times a builder method was called across every query. */
function count(method: string): number {
  return h.calls.filter((call) => call === method).length
}

const ORG = 'org_1'

function stubDb(): Database {
  let index = 0
  const chain = (): Record<string, unknown> => {
    const self: Record<string, unknown> = {}
    for (const method of [
      'from',
      '$dynamic',
      'innerJoin',
      'leftJoin',
      'where',
      'orderBy',
      'limit',
      'offset',
    ]) {
      self[method] = () => {
        h.calls.push(method)
        return self
      }
    }
    // biome-ignore lint/suspicious/noThenProperty: chainable drizzle query-builder stub
    self.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
      Promise.resolve(h.results[index++] ?? []).then(resolve, reject)
    return self
  }
  return { select: () => chain() } as unknown as Database
}

/** One `FieldValue` row as the reads select it. */
function value(entityId: string, attribute: string, columns: Record<string, unknown>) {
  return {
    entityId,
    fieldId: `fld_${attribute}`,
    valueText: null,
    valueNumber: null,
    valueDate: null,
    optionId: null,
    relatedEntityId: null,
    ...columns,
  }
}

beforeEach(() => {
  h.settings = {}
  h.results = []
  h.calls = []
})

describe('a stored date reads back as a day, not an instant', () => {
  it('slices the deposit date to YYYY-MM-DD', async () => {
    h.results = [
      // the deposit instance
      [{ id: 'dep_1', createdAt: new Date('2026-09-03T00:00:00Z') }],
      // its field values - what postgres actually hands back for a DATE field
      [
        value('dep_1', 'bank_deposit_date', { valueDate: '2026-09-03 00:00:00+00' }),
        value('dep_1', 'bank_deposit_number', { valueText: 'DEP-0001' }),
        value('dep_1', 'bank_deposit_total', { valueNumber: 350_00 }),
      ],
      // readDepositPayments: no payments
      [],
    ]

    const deposit = await readBankDepositDetail(stubDb(), ORG, 'dep_1')
    // 🛑 Not `'2026-09-03 00:00:00+00'`. `updateBankDeposit` compares this
    // against a caller's `'2026-09-03'` to decide whether the date moved.
    expect(deposit?.depositDate).toBe('2026-09-03')
  })

  it('leaves an unset deposit date null rather than inventing today', async () => {
    h.results = [[{ id: 'dep_1', createdAt: new Date() }], [], []]
    const deposit = await readBankDepositDetail(stubDb(), ORG, 'dep_1')
    expect(deposit?.depositDate).toBeNull()
  })

  it('slices the payment date the same way, so groupByDay keys on one day', async () => {
    h.results = [
      [{ id: 'pay_1', createdAt: new Date('2026-09-01T00:00:00Z') }],
      [
        value('pay_1', 'payment_date', { valueDate: '2026-09-01 00:00:00+00' }),
        value('pay_1', 'payment_amount', { valueNumber: 100_00 }),
        value('pay_1', 'payment_method', { optionId: 'check' }),
      ],
    ]

    const rows = await listUndepositedPayments(stubDb(), { organizationId: ORG })
    expect(rows._unsafeUnwrap()[0]?.date).toBe('2026-09-01')
  })
})

describe('a payment with no method is listed when `other` routes to undeposited funds', () => {
  it('LEFT joins the method so a payment with no method value survives', async () => {
    h.results = [[], []]
    await listUndepositedPayments(stubDb(), { organizationId: ORG })
    // `other` defaults to `undeposited_funds`, so a method-less payment's money
    // IS in 1050 and it has to be bankable. Two LEFT joins: the method and the
    // deposit link. No INNER join at all - that was the one that dropped it.
    expect(count('leftJoin')).toBe(2)
    expect(count('innerJoin')).toBe(0)
  })

  it('returns the method-less row with method null rather than dropping it', async () => {
    h.results = [
      [{ id: 'pay_1', createdAt: new Date('2026-09-01T00:00:00Z') }],
      [value('pay_1', 'payment_amount', { valueNumber: 100_00 })],
    ]
    const rows = await listUndepositedPayments(stubDb(), { organizationId: ORG })
    expect(rows._unsafeUnwrap()).toHaveLength(1)
    expect(rows._unsafeUnwrap()[0]).toMatchObject({ paymentId: 'pay_1', method: null })
  })

  it('INNER joins again once `other` routes somewhere else', async () => {
    // With `other` pointed at cash, a method-less payment's money is NOT in
    // undeposited funds, so listing it would offer a deposit the bank never
    // showed as one line.
    h.settings = { 'accounting.paymentRoute.other': 'cash' }
    h.results = [[], []]
    await listUndepositedPayments(stubDb(), { organizationId: ORG })
    expect(count('innerJoin')).toBe(1)
    // Only the deposit-link join stays LEFT.
    expect(count('leftJoin')).toBe(1)
  })

  it('INNER joins for an explicit method filter, so "show me the cheques" stays literal', async () => {
    h.results = [[], []]
    await listUndepositedPayments(stubDb(), { organizationId: ORG, method: 'check' })
    expect(count('innerJoin')).toBe(1)
    expect(count('leftJoin')).toBe(1)
  })

  it('still answers nothing when the route table sends nothing to undeposited funds', async () => {
    h.settings = {
      'accounting.paymentRoute.cash': 'cash',
      'accounting.paymentRoute.check': 'cash',
      'accounting.paymentRoute.card': 'clearing',
      'accounting.paymentRoute.bank': 'cash',
      'accounting.paymentRoute.other': 'cash',
    }
    const rows = await listUndepositedPayments(stubDb(), { organizationId: ORG })
    expect(rows._unsafeUnwrap()).toEqual([])
    // Not even a query: with every rail posting direct there is nothing to group.
    expect(h.calls).toEqual([])
  })

  it('answers nothing for a method whose route is not undeposited funds', async () => {
    const rows = await listUndepositedPayments(stubDb(), { organizationId: ORG, method: 'card' })
    expect(rows._unsafeUnwrap()).toEqual([])
    expect(h.calls).toEqual([])
  })
})
