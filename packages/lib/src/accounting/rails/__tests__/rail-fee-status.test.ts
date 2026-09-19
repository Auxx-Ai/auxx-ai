// packages/lib/src/accounting/rails/__tests__/rail-fee-status.test.ts
//
// The close console's Processor fees read (brief 26 §6).
//
// 🔑 The property this file exists for is §5's: a billed rail whose fees land
// in the SHARED `payment_processing_fees` account must come back as `shared`
// and carry no date. A regression there is invisible - the block would render a
// perfectly plausible date that belongs to every other rail's fallback, and
// nobody reading it could tell.
//
// 🛑 The second property is a NEGATIVE one: nothing in this module refuses.
// §14's R4 is why. There is no status, no severity and no throw on an org with
// an unmapped role, no rails, or no postings at all.
//
// `listPaymentGateways` is stubbed at the module boundary - `payment-gateways`
// has its own suite for the hydration - and the database is a hand-written stub
// answering a queue of row sets, the shape `duplicate-movements.test.ts` uses
// for the same reason: what is under test is the arithmetic between the reads,
// not the WHERE clauses.

import { ok } from 'neverthrow'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const listPaymentGateways = vi.fn()
vi.mock('../reads', () => ({
  listPaymentGateways: (...args: unknown[]) => listPaymentGateways(...args),
}))

import type { Database } from '@auxx/database'
import type { PaymentGatewayRow } from '../client'
import { readRailFeeStatus } from '../rail-fee-status'

const ORG = 'org_1'
const MONTH = '2026-09'

function gateway(overrides: Partial<PaymentGatewayRow> & { id: string }): PaymentGatewayRow {
  return {
    recordId: `payment_gateway:${overrides.id}`,
    name: 'A rail',
    handles: [],
    clearingGlAccountId: 'gl_1200',
    feeGlAccountId: null,
    settlementSource: 'manual',
    feeTreatment: 'netted',
    status: 'active',
    lastSettlementAt: null,
    processorAccountId: null,
    settlementCurrency: null,
    bankAccountId: null,
    lastFeeBookedAt: null,
    createdAt: null,
    updatedAt: null,
    ...overrides,
  }
}

/**
 * A `Database` that answers each `select()` chain with the next queued row set.
 * The module makes two queries in a fixed order: the role assignment, then the
 * grouped posting aggregate.
 */
function stubDb(...results: unknown[][]) {
  const queue = [...results]
  return {
    select: () => {
      const rows = queue.shift() ?? []
      const chain: Record<string, unknown> = {}
      const passthrough = () => chain
      for (const method of ['from', 'innerJoin', 'where', 'groupBy', 'orderBy', 'limit']) {
        chain[method] = passthrough
      }
      // biome-ignore lint/suspicious/noThenProperty: the stub must be awaitable
      chain.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
        Promise.resolve(rows).then(resolve, reject)
      return chain
    },
  } as unknown as Database
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('readRailFeeStatus', () => {
  it('answers nothing at all for an org with no payment_gateway records', async () => {
    listPaymentGateways.mockResolvedValue(ok([]))

    const result = await readRailFeeStatus(stubDb(), { organizationId: ORG, month: MONTH })

    expect(result.isOk()).toBe(true)
    expect(result._unsafeUnwrap()).toEqual([])
  })

  it('reports a netted rail with no fee account of its own as shared', async () => {
    listPaymentGateways.mockResolvedValue(
      ok([gateway({ id: 'pg_shopify', name: 'Shopify Payments', feeTreatment: 'netted' })])
    )

    const result = await readRailFeeStatus(stubDb([], []), {
      organizationId: ORG,
      month: MONTH,
    })

    expect(result._unsafeUnwrap()).toEqual([
      {
        paymentGatewayId: 'pg_shopify',
        name: 'Shopify Payments',
        feeTreatment: 'netted',
        tradedInMonth: false,
        fees: { kind: 'shared' },
      },
    ])
  })

  it('answers a billed rail with its own fee account with a date', async () => {
    listPaymentGateways.mockResolvedValue(
      ok([
        gateway({
          id: 'pg_authnet',
          name: 'Authorize.net',
          feeTreatment: 'billed',
          clearingGlAccountId: 'gl_1201',
          feeGlAccountId: 'gl_6150',
        }),
      ])
    )

    const result = await readRailFeeStatus(
      stubDb(
        [{ role: 'payment_processing_fees', glAccountId: 'gl_6100' }],
        [
          { glAccountId: 'gl_1201', lastAt: '2026-09-28', lastInMonthAt: '2026-09-28' },
          { glAccountId: 'gl_6150', lastAt: '2026-07-14', lastInMonthAt: null },
        ]
      ),
      { organizationId: ORG, month: MONTH }
    )

    expect(result._unsafeUnwrap()).toEqual([
      {
        paymentGatewayId: 'pg_authnet',
        name: 'Authorize.net',
        feeTreatment: 'billed',
        tradedInMonth: true,
        fees: {
          kind: 'own',
          glAccountId: 'gl_6150',
          bookedInMonth: false,
          lastBookedAt: '2026-07-14',
        },
      },
    ])
  })

  // A billed rail with a connector feed is the Authorize.Net case
  // (`plans/accounting/decisions.md` 27a-3b): the batch is evidence with a zero
  // fee, so the monthly statement is still outstanding and this read must keep
  // saying so. Having a feed is not having been billed.
  it('still reports a fee statement pending for a billed rail that reads a feed', async () => {
    listPaymentGateways.mockResolvedValue(
      ok([
        gateway({
          id: 'pg_authnet',
          name: 'Authorize.Net',
          feeTreatment: 'billed',
          settlementSource: 'authorize_net',
          processorAccountId: 'fsa_authnet',
          clearingGlAccountId: 'gl_1201',
          feeGlAccountId: 'gl_6150',
        }),
      ])
    )

    const result = await readRailFeeStatus(
      stubDb(
        [{ role: 'payment_processing_fees', glAccountId: 'gl_6100' }],
        // Batches settled all month; nothing ever reached the rail's fee account.
        [{ glAccountId: 'gl_1201', lastAt: '2026-09-28', lastInMonthAt: '2026-09-28' }]
      ),
      { organizationId: ORG, month: MONTH }
    )

    expect(result._unsafeUnwrap()).toEqual([
      {
        paymentGatewayId: 'pg_authnet',
        name: 'Authorize.Net',
        feeTreatment: 'billed',
        tradedInMonth: true,
        fees: { kind: 'own', glAccountId: 'gl_6150', bookedInMonth: false, lastBookedAt: null },
      },
    ])
  })

  // 🔑 §5. The whole reason `RailFeeAccount` is a union.
  it('refuses to quote a date for a rail pointed at the payment_processing_fees account', async () => {
    listPaymentGateways.mockResolvedValue(
      ok([
        gateway({
          id: 'pg_authnet',
          name: 'Authorize.net',
          feeTreatment: 'billed',
          feeGlAccountId: 'gl_6100',
        }),
      ])
    )

    const result = await readRailFeeStatus(
      stubDb(
        [{ role: 'payment_processing_fees', glAccountId: 'gl_6100' }],
        [{ glAccountId: 'gl_6100', lastAt: '2026-07-14', lastInMonthAt: null }]
      ),
      { organizationId: ORG, month: MONTH }
    )

    expect(result._unsafeUnwrap()[0]?.fees).toEqual({ kind: 'shared' })
  })

  it('refuses to quote a date for a fee account two rails both name', async () => {
    listPaymentGateways.mockResolvedValue(
      ok([
        gateway({ id: 'pg_a', name: 'Rail A', feeTreatment: 'billed', feeGlAccountId: 'gl_6150' }),
        gateway({ id: 'pg_b', name: 'Rail B', feeTreatment: 'billed', feeGlAccountId: 'gl_6150' }),
      ])
    )

    const result = await readRailFeeStatus(
      stubDb([], [{ glAccountId: 'gl_6150', lastAt: '2026-07-14', lastInMonthAt: null }]),
      { organizationId: ORG, month: MONTH }
    )

    for (const rail of result._unsafeUnwrap()) {
      expect(rail.fees).toEqual({ kind: 'shared' })
    }
  })

  // A CLOSED rail's fees were booked into that account too, so the live rail's
  // date would be reading somebody else's history.
  it('counts a closed rail when deciding a fee account is shared, but never reports it', async () => {
    listPaymentGateways.mockResolvedValue(
      ok([
        gateway({
          id: 'pg_dead',
          name: 'Retired rail',
          status: 'closed',
          feeTreatment: 'billed',
          feeGlAccountId: 'gl_6150',
        }),
        gateway({
          id: 'pg_live',
          name: 'Live rail',
          feeTreatment: 'billed',
          feeGlAccountId: 'gl_6150',
        }),
      ])
    )

    const result = await readRailFeeStatus(
      stubDb([], [{ glAccountId: 'gl_6150', lastAt: '2026-07-14', lastInMonthAt: null }]),
      { organizationId: ORG, month: MONTH }
    )

    const rails = result._unsafeUnwrap()
    expect(rails.map((rail) => rail.paymentGatewayId)).toEqual(['pg_live'])
    expect(rails[0]?.fees).toEqual({ kind: 'shared' })
  })

  it('says a fee has never been booked rather than leaving the rail out', async () => {
    listPaymentGateways.mockResolvedValue(
      ok([
        gateway({
          id: 'pg_authnet',
          name: 'Authorize.net',
          feeTreatment: 'billed',
          feeGlAccountId: 'gl_6150',
        }),
      ])
    )

    const result = await readRailFeeStatus(stubDb([], []), {
      organizationId: ORG,
      month: MONTH,
    })

    expect(result._unsafeUnwrap()[0]?.fees).toEqual({
      kind: 'own',
      glAccountId: 'gl_6150',
      bookedInMonth: false,
      lastBookedAt: null,
    })
  })

  // An org that never mapped `payment_processing_fees` is an ordinary state
  // here, not a refusal: `resolveRoles` would have thrown the whole block off
  // the screen over a mapping the block never needed.
  it('does not refuse when payment_processing_fees is unmapped', async () => {
    listPaymentGateways.mockResolvedValue(
      ok([
        gateway({
          id: 'pg_authnet',
          feeTreatment: 'billed',
          feeGlAccountId: 'gl_6150',
        }),
      ])
    )

    const result = await readRailFeeStatus(
      stubDb([], [{ glAccountId: 'gl_6150', lastAt: '2026-08-02', lastInMonthAt: null }]),
      { organizationId: ORG, month: MONTH }
    )

    expect(result.isOk()).toBe(true)
    expect(result._unsafeUnwrap()[0]?.fees).toMatchObject({
      kind: 'own',
      lastBookedAt: '2026-08-02',
    })
  })

  it('refuses a period key that is not a month', async () => {
    listPaymentGateways.mockResolvedValue(ok([gateway({ id: 'pg_a' })]))

    const result = await readRailFeeStatus(stubDb(), {
      organizationId: ORG,
      month: '2026-09-14',
    })

    expect(result.isErr()).toBe(true)
  })
})
