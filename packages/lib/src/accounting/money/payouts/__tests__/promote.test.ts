// packages/lib/src/accounting/money/payouts/__tests__/promote.test.ts
//
// Brief 114 P2: a connector payout is promoted in place from its own evidence. Only unset ledger
// fields are filled, status only advances to paid, and a negative provider status goes through
// the failed-payout reversal rather than being stamped.

import type { Database } from '@auxx/database'
import { ok } from 'neverthrow'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  active: true,
  records: [] as Array<Record<string, string | number | null>>,
  feeds: [] as Array<Record<string, string>>,
  update: vi.fn(async (_recordId: string, _values: unknown) => undefined),
  reverseFailedPayout: vi.fn(),
  findPayoutByGatewayId: vi.fn(async (..._args: unknown[]) => null as unknown),
  listUnpromoted: vi.fn(async (..._args: unknown[]) => [] as string[]),
}))

vi.mock('../../../ledger/setup/accounting-enabled', () => ({
  isAccountingActive: async () => h.active,
}))
vi.mock('../fields', () => ({
  loadPayoutFieldContext: async () => ({ defId: 'def_payout', fields: {} }),
}))
vi.mock('../../../../resources/system-records', () => ({
  readSystemRecords: async (_db: unknown, _org: string, _ctx: unknown, opts: { ids: string[] }) =>
    h.records
      .filter((row) => opts.ids.includes(row.id as string))
      .map((row) => {
        const get = (attribute: string) => (row[attribute] ?? null) as never
        return {
          id: row.id,
          text: get,
          number: get,
          option: get,
          related: get,
          date: get,
        }
      }),
}))
vi.mock('../../../rails/reads', () => ({
  listLinkedFeeds: async () => h.feeds,
  listPaymentGateways: async () =>
    ok([
      { id: 'pg_affirm', recordId: 'payment_gateway:pg_affirm' },
      { id: 'pg_shop', recordId: 'payment_gateway:pg_shop' },
    ]),
}))
vi.mock('../reads', () => ({
  findPayoutByGatewayId: h.findPayoutByGatewayId,
  listPromotableConnectorPayouts: h.listUnpromoted,
}))
vi.mock('../sync', () => ({ reverseFailedPayout: h.reverseFailedPayout }))
vi.mock('../../../../resources/crud/unified-handler', () => ({
  UnifiedCrudHandler: class {
    update = h.update
  },
}))
vi.mock('../../../../users/system-user-service', () => ({
  SystemUserService: { getSystemUserForActions: async () => 'user_system' },
}))

import {
  type PromotionCurrent,
  type PromotionEvidence,
  planPayoutPromotion,
  promoteConnectorPayouts,
  promotePendingPayouts,
} from '../promote'

const ORG = 'org_1'
const db = {} as Database
const RAIL = { id: 'pg_affirm', recordId: 'payment_gateway:pg_affirm' }

const UNSET: PromotionCurrent = {
  gatewayId: null,
  railId: null,
  status: 'in_transit',
  paidAt: null,
  currency: null,
  depositedMinor: null,
}

const AFFIRM: PromotionEvidence = {
  providerKey: 'affirm',
  externalId: 'dep_1',
  status: 'paid',
  issuedOn: '2026-03-04',
  amount: '1234.56',
  currency: 'USD',
  currencyExponent: 2,
}

const plan = (
  current: Partial<PromotionCurrent> = {},
  evidence: Partial<PromotionEvidence> = {},
  rail: typeof RAIL | null = RAIL
) =>
  planPayoutPromotion({
    current: { ...UNSET, ...current },
    evidence: { ...AFFIRM, ...evidence },
    rail,
  })

describe('planPayoutPromotion', () => {
  it('stamps the gateway id, the rail, the money and paid_at for a paid payout', () => {
    expect(plan()).toEqual({
      values: {
        payout_gateway_id: 'dep_1',
        payout_payment_gateway: 'payment_gateway:pg_affirm',
        payout_currency: 'usd',
        payout_deposited: 123_456,
        payout_status: 'paid',
        payout_paid_at: '2026-03-04',
      },
      reverse: false,
    })
  })

  it('stamps no paid_at while the payout is in transit', () => {
    const result = plan(
      {},
      { providerKey: 'shopify_payments', status: 'scheduled', issuedOn: '2026-10-01' }
    )
    expect(result?.values).not.toHaveProperty('payout_paid_at')
    expect(result?.values).not.toHaveProperty('payout_status')
    expect(result?.values.payout_gateway_id).toBe('dep_1')
  })

  it('writes in_transit onto a record with no status at all', () => {
    expect(
      plan({ status: null }, { providerKey: 'shopify_payments', status: 'in_transit' })
    ).toMatchObject({ values: { payout_status: 'in_transit' } })
  })

  it('leaves an unlinked feed unstamped', () => {
    expect(plan({}, {}, null)).toBeNull()
  })

  it('never downgrades paid to in transit', () => {
    const result = plan(
      { status: 'paid', paidAt: '2026-03-04' },
      { providerKey: 'shopify_payments', status: 'in_transit' }
    )
    expect(result?.values).not.toHaveProperty('payout_status')
  })

  it('writes nothing onto a record the lib sync already adopted', () => {
    const adopted = plan({
      gatewayId: 'dep_1',
      railId: 'pg_affirm',
      status: 'paid',
      paidAt: '2026-03-03',
      currency: 'usd',
      depositedMinor: 123_456,
    })
    expect(adopted).toEqual({ values: {}, reverse: false })
  })

  it('keeps a paid_at the sync wrote when the status advances', () => {
    const result = plan({ gatewayId: 'dep_1', railId: 'pg_affirm', paidAt: '2026-03-03' })
    expect(result?.values).toEqual({
      payout_currency: 'usd',
      payout_deposited: 123_456,
      payout_status: 'paid',
    })
  })

  it('leaves a record whose ledger fields name another payout or rail', () => {
    expect(plan({ gatewayId: 'dep_other' })).toBeNull()
    expect(plan({ railId: 'pg_shop' })).toBeNull()
  })

  it('routes a negative status to the reversal and never stamps failed', () => {
    const result = plan({}, { status: 'rejected' })
    expect(result?.reverse).toBe(true)
    expect(result?.values).not.toHaveProperty('payout_status')
    expect(result?.values.payout_gateway_id).toBe('dep_1')
  })

  it('does not reverse a payout already failed or reversed', () => {
    expect(plan({ status: 'failed' }, { status: 'rejected' })?.reverse).toBe(false)
    expect(plan({ status: 'reversed' }, { status: 'rejected' })?.reverse).toBe(false)
  })

  it('stays in transit when a paid payout carries no issued date', () => {
    expect(plan({}, { issuedOn: null })?.values).not.toHaveProperty('payout_status')
  })

  it('skips the deposit when the amount does not fit the currency', () => {
    expect(plan({}, { amount: '1.234' })?.values).not.toHaveProperty('payout_deposited')
  })
})

describe('promoteConnectorPayouts', () => {
  const RECORD = {
    id: 'inst_1',
    payout_source_provider_key: 'affirm',
    payout_source_account_id: 'merchant_1',
    payout_source_environment: 'live',
    payout_source_external_id: 'dep_1',
    payout_source_status: 'paid',
    payout_source_issued_on: '2026-03-04',
    payout_source_amount: '10.00',
    payout_source_currency: 'USD',
    payout_source_currency_exponent: 2,
    payout_status: 'in_transit',
  }
  const FEED = {
    id: 'fsa_1',
    providerKey: 'affirm',
    externalAccountId: 'merchant_1',
    environment: 'live',
    paymentGatewayId: 'pg_affirm',
  }

  beforeEach(() => {
    vi.clearAllMocks()
    h.active = true
    h.records = [RECORD]
    h.feeds = [FEED]
    h.findPayoutByGatewayId.mockResolvedValue(null)
    h.reverseFailedPayout.mockResolvedValue(ok({ reversed: false }))
  })

  const run = () => promoteConnectorPayouts(db, { organizationId: ORG, payoutIds: ['inst_1'] })

  it('stamps the rail of the feed matching provider, account and environment', async () => {
    expect((await run())._unsafeUnwrap()).toEqual({ promoted: 1, reversed: 0, skipped: 0 })
    expect(h.update).toHaveBeenCalledWith(
      'def_payout:inst_1',
      expect.objectContaining({
        payout_gateway_id: 'dep_1',
        payout_payment_gateway: 'payment_gateway:pg_affirm',
        payout_status: 'paid',
        payout_paid_at: '2026-03-04',
        payout_deposited: 1_000,
      })
    )
  })

  it('stamps nothing on a feed no rail links', async () => {
    h.feeds = [{ ...FEED, environment: 'sandbox' }]
    expect((await run())._unsafeUnwrap()).toMatchObject({ promoted: 0, skipped: 1 })
    expect(h.update).not.toHaveBeenCalled()
  })

  it('does nothing while accounting is not active', async () => {
    h.active = false
    expect((await run())._unsafeUnwrap()).toEqual({ promoted: 0, reversed: 0, skipped: 0 })
    expect(h.update).not.toHaveBeenCalled()
  })

  it('ignores a record with no connector evidence', async () => {
    h.records = [{ id: 'inst_1', payout_gateway_id: 'po_1' }]
    await run()
    expect(h.update).not.toHaveBeenCalled()
  })

  it('leaves a twin alone while another record holds the payout', async () => {
    h.findPayoutByGatewayId.mockResolvedValue({ payoutId: 'inst_legacy' })
    expect((await run())._unsafeUnwrap()).toMatchObject({ promoted: 0, skipped: 1 })
    expect(h.findPayoutByGatewayId).toHaveBeenCalledWith(db, ORG, 'dep_1', 'pg_affirm')
    expect(h.update).not.toHaveBeenCalled()
  })

  it('stamps then hands a negative status to reverseFailedPayout on this rail', async () => {
    h.records = [{ ...RECORD, payout_source_status: 'failed' }]
    expect((await run())._unsafeUnwrap()).toMatchObject({ promoted: 1, reversed: 1 })
    expect(h.update.mock.calls[0]![1]).not.toHaveProperty('payout_status')
    expect(h.update.mock.invocationCallOrder[0]!).toBeLessThan(
      h.reverseFailedPayout.mock.invocationCallOrder[0]!
    )
    expect(h.reverseFailedPayout).toHaveBeenCalledWith(db, {
      organizationId: ORG,
      gatewayPayoutId: 'dep_1',
      paymentGatewayId: 'pg_affirm',
      actorUserId: 'user_system',
    })
  })

  describe('a stamped record left in transit (PAY-0308)', () => {
    const STAMPED = {
      ...RECORD,
      payout_gateway_id: 'dep_1',
      payout_payment_gateway: 'pg_affirm',
      payout_currency: 'usd',
      payout_deposited: 1_000,
      payout_paid_at: '2026-03-04',
      payout_status: 'in_transit',
    }

    it('advances to paid when the provider reports paid, and writes nothing else', async () => {
      h.records = [STAMPED]
      // It holds its own provider id, which is not a twin.
      h.findPayoutByGatewayId.mockResolvedValue({ payoutId: 'inst_1' })
      expect((await run())._unsafeUnwrap()).toEqual({ promoted: 1, reversed: 0, skipped: 0 })
      expect(h.update).toHaveBeenCalledWith('def_payout:inst_1', { payout_status: 'paid' })
    })

    it('takes paid_at from issued_on when the record has none', async () => {
      h.records = [{ ...STAMPED, payout_paid_at: null }]
      await run()
      expect(h.update).toHaveBeenCalledWith('def_payout:inst_1', {
        payout_status: 'paid',
        payout_paid_at: '2026-03-04',
      })
    })

    it('stays in transit while the provider has not paid', async () => {
      h.records = [
        {
          ...STAMPED,
          payout_source_provider_key: 'shopify_payments',
          payout_source_status: 'scheduled',
        },
      ]
      h.feeds = [{ ...FEED, providerKey: 'shopify_payments' }]
      expect((await run())._unsafeUnwrap()).toMatchObject({ promoted: 0 })
      expect(h.update).not.toHaveBeenCalled()
    })

    it('leaves a lib-written record with no connector evidence alone', async () => {
      h.records = [
        {
          id: 'inst_1',
          payout_gateway_id: 'dep_1',
          payout_payment_gateway: 'pg_affirm',
          payout_status: 'in_transit',
        },
      ]
      expect((await run())._unsafeUnwrap()).toEqual({ promoted: 0, reversed: 0, skipped: 0 })
      expect(h.update).not.toHaveBeenCalled()
    })
  })

  it('counts a failed record as skipped and carries on', async () => {
    h.records = [RECORD, { ...RECORD, id: 'inst_2', payout_source_external_id: 'dep_2' }]
    h.update.mockRejectedValueOnce(new Error('boom'))
    const result = await promoteConnectorPayouts(db, {
      organizationId: ORG,
      payoutIds: ['inst_1', 'inst_2'],
    })
    expect(result._unsafeUnwrap()).toMatchObject({ promoted: 1, skipped: 1 })
  })
})

describe('promotePendingPayouts', () => {
  it("promotes one page of a feed's unpromoted payouts", async () => {
    h.listUnpromoted.mockResolvedValue([])
    await promotePendingPayouts(db, { organizationId: ORG, limit: 50, sourceAccountId: 'fsa_1' })
    expect(h.listUnpromoted).toHaveBeenCalledWith(db, ORG, { limit: 50, sourceAccountId: 'fsa_1' })
  })
})
