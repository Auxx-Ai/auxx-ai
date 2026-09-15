// packages/lib/src/money/payouts/__tests__/rails.test.ts
//
// The per-rail strip read (brief 27 §8.2).
//
// 🔑 Test 6 of 27 §13 lives here: two rails on ONE clearing account come back
// with the SAME balance and each names the other in `sharedWith`, so the screen
// can say "the account's figure" rather than present one number as two per-rail
// figures. Nothing stamps a gateway onto a posting line (26 §9.1), so a per-rail
// claim would be invented.
//
// The four collaborators are stubbed at their module boundaries - each has its
// own suite - and what is under test is the arithmetic between them.

import { ok } from 'neverthrow'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  listPaymentGateways: vi.fn(),
  readClearingAccountBalance: vi.fn(),
  readRailFeeStatus: vi.fn(),
  listPayouts: vi.fn(),
}))

vi.mock('../../../payment-gateways/reads', () => ({
  listPaymentGateways: h.listPaymentGateways,
}))
vi.mock('../../../payment-gateways/repoint', () => ({
  readClearingAccountBalance: h.readClearingAccountBalance,
}))
vi.mock('../../../postings/rail-fee-status', () => ({
  readRailFeeStatus: h.readRailFeeStatus,
}))
vi.mock('../reads', () => ({ listPayouts: h.listPayouts }))

import type { Database } from '@auxx/database'
import type { PaymentGatewayRow } from '../../../payment-gateways/client'
import { listRailStrip } from '../rails'

const ORG = 'org_1'
const db = {} as Database

function gateway(over: Partial<PaymentGatewayRow> & { id: string }): PaymentGatewayRow {
  return {
    recordId: `payment_gateway:${over.id}`,
    name: over.id,
    handles: [],
    clearingGlAccountId: 'gl_1200',
    feeGlAccountId: null,
    settlementSource: 'manual',
    feeTreatment: 'netted',
    status: 'active',
    lastSettlementAt: null,
    lastFeeBookedAt: null,
    createdAt: null,
    updatedAt: null,
    ...over,
  }
}

/** Balances by account id. An account not listed answers zero, as the real read does. */
function balances(byAccount: Record<string, number>) {
  h.readClearingAccountBalance.mockImplementation(
    async (_db: unknown, params: { glAccountId: string }) =>
      ok({
        glAccountId: params.glAccountId,
        debitMinor: 0,
        creditMinor: 0,
        balanceMinor: byAccount[params.glAccountId] ?? 0,
        lineCount: 0,
        lastTxnDate: null,
      })
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  h.listPaymentGateways.mockResolvedValue(ok([]))
  h.readRailFeeStatus.mockResolvedValue(ok([]))
  h.listPayouts.mockResolvedValue(ok([]))
  balances({})
})

describe('listRailStrip', () => {
  it('answers nothing for an org with no routed rail, and reads no balance', async () => {
    h.listPaymentGateways.mockResolvedValue(ok([gateway({ id: 'blank', clearingGlAccountId: '' })]))

    const result = await listRailStrip(db, { organizationId: ORG })

    expect(result._unsafeUnwrap()).toEqual([])
    expect(h.readClearingAccountBalance).not.toHaveBeenCalled()
  })

  it('🔑 names the ACCOUNT over a shared clearing account and claims no per-rail figure', async () => {
    h.listPaymentGateways.mockResolvedValue(
      ok([
        gateway({ id: 'pg_shopify', name: 'Shopify Payments', clearingGlAccountId: 'gl_1200' }),
        gateway({ id: 'pg_paypal', name: 'PayPal', clearingGlAccountId: 'gl_1200' }),
      ])
    )
    balances({ gl_1200: 48_231_14 })

    const rows = (await listRailStrip(db, { organizationId: ORG }))._unsafeUnwrap()

    // One balance read for the one account, not one per rail.
    expect(h.readClearingAccountBalance).toHaveBeenCalledTimes(1)
    expect(rows).toHaveLength(2)
    for (const row of rows) {
      expect(row.clearingGlAccountId).toBe('gl_1200')
      expect(row.balanceMinor).toBe(48_231_14)
    }
    expect(rows.find((row) => row.name === 'PayPal')?.sharedWith).toEqual(['Shopify Payments'])
    expect(rows.find((row) => row.name === 'Shopify Payments')?.sharedWith).toEqual(['PayPal'])
  })

  it('keeps a closed rail while its account holds a balance and drops it at zero', async () => {
    h.listPaymentGateways.mockResolvedValue(
      ok([
        gateway({
          id: 'pg_authnet',
          name: 'Authorize.net',
          status: 'closed',
          clearingGlAccountId: 'gl_1205',
        }),
        gateway({
          id: 'pg_amazon',
          name: 'Amazon Pay',
          status: 'closed',
          clearingGlAccountId: 'gl_1215',
        }),
        gateway({ id: 'pg_live', name: 'Shopify Payments', clearingGlAccountId: 'gl_1200' }),
      ])
    )
    balances({ gl_1205: 1_912_40, gl_1215: 0, gl_1200: 0 })

    const rows = (await listRailStrip(db, { organizationId: ORG }))._unsafeUnwrap()

    // Active first, then the closed rail that still holds money. The zeroed
    // closed rail is gone; the zeroed ACTIVE rail stays.
    expect(rows.map((row) => row.name)).toEqual(['Shopify Payments', 'Authorize.net'])
    expect(rows[1]?.status).toBe('closed')
    expect(rows[1]?.balanceMinor).toBe(1_912_40)
  })

  it('reads the last settlement off the stamped field or the latest paid payout, whichever is later', async () => {
    h.listPaymentGateways.mockResolvedValue(
      ok([
        gateway({
          id: 'pg_stripe',
          name: 'Stripe',
          settlementSource: 'stripe',
          lastSettlementAt: '2026-08-01',
        }),
        gateway({
          id: 'pg_affirm',
          name: 'Affirm',
          clearingGlAccountId: 'gl_1210',
          lastSettlementAt: '2026-08-30',
        }),
      ])
    )
    h.listPayouts.mockResolvedValue(
      ok([
        { paidAt: '2026-09-10', status: 'paid' },
        // Created later, paid earlier: the page is scanned, not trusted in order.
        { paidAt: '2026-09-12', status: 'paid' },
        { paidAt: null, status: 'paid' },
      ])
    )

    const rows = (await listRailStrip(db, { organizationId: ORG }))._unsafeUnwrap()

    expect(rows.find((row) => row.name === 'Stripe')?.lastSettledAt).toBe('2026-09-12')
    // A payout cannot be attributed to a non-Stripe rail until unit 1 stamps
    // the gateway on it, so Affirm keeps its stamped date.
    expect(rows.find((row) => row.name === 'Affirm')?.lastSettledAt).toBe('2026-08-30')
    expect(h.listPayouts).toHaveBeenCalledWith(
      db,
      expect.objectContaining({ organizationId: ORG, status: 'paid' })
    )
  })

  it('attributes payouts to NO rail when two records settle through Stripe', async () => {
    h.listPaymentGateways.mockResolvedValue(
      ok([
        gateway({ id: 'pg_a', name: 'Stripe A', settlementSource: 'stripe' }),
        gateway({
          id: 'pg_b',
          name: 'Stripe B',
          settlementSource: 'stripe',
          clearingGlAccountId: 'gl_1201',
        }),
      ])
    )
    h.listPayouts.mockResolvedValue(ok([{ paidAt: '2026-09-12', status: 'paid' }]))

    const rows = (await listRailStrip(db, { organizationId: ORG }))._unsafeUnwrap()

    expect(rows.every((row) => row.lastSettledAt === null)).toBe(true)
  })

  it("reads the fee date off the rail's OWN fee account and says so when it is shared", async () => {
    h.listPaymentGateways.mockResolvedValue(
      ok([
        gateway({
          id: 'pg_authnet',
          name: 'Authorize.net',
          feeTreatment: 'billed',
          feeGlAccountId: 'gl_6105',
          clearingGlAccountId: 'gl_1205',
          lastFeeBookedAt: '2026-01-01',
        }),
        gateway({
          id: 'pg_other',
          name: 'Other',
          feeTreatment: 'billed',
          feeGlAccountId: 'gl_6100',
          clearingGlAccountId: 'gl_1206',
          lastFeeBookedAt: '2026-02-02',
        }),
      ])
    )
    h.readRailFeeStatus.mockResolvedValue(
      ok([
        {
          paymentGatewayId: 'pg_authnet',
          name: 'Authorize.net',
          feeTreatment: 'billed',
          tradedInMonth: true,
          fees: {
            kind: 'own',
            glAccountId: 'gl_6105',
            bookedInMonth: false,
            lastBookedAt: '2026-07-14',
          },
        },
        {
          paymentGatewayId: 'pg_other',
          name: 'Other',
          feeTreatment: 'billed',
          tradedInMonth: true,
          fees: { kind: 'shared' },
        },
      ])
    )

    const rows = (await listRailStrip(db, { organizationId: ORG }))._unsafeUnwrap()

    const authnet = rows.find((row) => row.name === 'Authorize.net')
    expect(authnet?.lastFeeBookedAt).toBe('2026-07-14')
    expect(authnet?.feeAccountShared).toBe(false)

    // The ledger cannot tell this rail's fees apart; the stamped field is the
    // only date left, and the row says the account is shared so the screen can.
    const other = rows.find((row) => row.name === 'Other')
    expect(other?.lastFeeBookedAt).toBe('2026-02-02')
    expect(other?.feeAccountShared).toBe(true)
  })

  it('falls back to the stamped fee date for a closed rail the fee read excludes', async () => {
    h.listPaymentGateways.mockResolvedValue(
      ok([
        gateway({
          id: 'pg_authnet',
          name: 'Authorize.net',
          status: 'closed',
          feeTreatment: 'billed',
          clearingGlAccountId: 'gl_1205',
          lastFeeBookedAt: '2026-07-14',
        }),
      ])
    )
    balances({ gl_1205: 100 })

    const rows = (await listRailStrip(db, { organizationId: ORG }))._unsafeUnwrap()

    expect(rows[0]?.lastFeeBookedAt).toBe('2026-07-14')
    expect(rows[0]?.feeAccountShared).toBe(false)
  })
})
