// packages/lib/src/accounting/money/customer-money/__tests__/receipt-accounting.test.ts
//
// Which rail a channel receipt posts to, in four rules (task 71 U2): the
// movement's own gateway HANDLE decides, the feed link is the fallback for a
// transaction that carries none, a reserved handle names no rail at all, and an
// unmapped handle refuses rather than guessing.

import { ok } from 'neverthrow'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  listPaymentGateways: vi.fn(),
  getPaymentGateway: vi.fn(),
  gatewayHandle: null as string | null,
  feedRailId: 'pg_feed' as string | null,
  applications: [] as Array<Record<string, unknown>>,
  acceptanceState: 'accepted',
  environment: 'live',
  currency: 'USD',
  nativeOwner: null as unknown,
}))

vi.mock('../../../rails/reads', () => ({
  listPaymentGateways: h.listPaymentGateways,
  getPaymentGateway: h.getPaymentGateway,
}))

vi.mock('../source-reads', () => ({
  readSourceObject: async () => ({ id: 'fo_1', sourceAccountId: 'fsa_1', externalId: 'capture_1' }),
  readSourceAccount: async () => ({
    id: 'fsa_1',
    environment: h.environment,
    archivedAt: null,
    providerKey: 'shopify',
    externalAccountId: 'demo.myshopify.com',
    paymentGatewayId: h.feedRailId,
  }),
}))

import type { Transaction } from '@auxx/database'
import { refusalFromError } from '../../../work-items/refusal'
import { readCustomerReceiptAccountingSource } from '../receipt-accounting'

const ORG = 'org_1'
const MOVEMENT = 'mt_1'
const ORDER = 'order_1'
const OCCURRED = new Date('2026-09-01T15:00:00.000Z')

const apply = (id: string, orderInstanceId: string, amountMinor: bigint) => ({
  id,
  operation: 'apply',
  orderInstanceId,
  amountMinor,
  effectiveDate: '2026-09-05',
  reversesApplicationId: null,
})

const money = () => ({
  id: MOVEMENT,
  purpose: 'customer_receipt' as const,
  amountMinor: 12_000n,
  currency: h.currency,
  currencyExponent: 2,
  occurredAt: OCCURRED,
  partyInstanceId: 'ct_1',
})

function tx(): Transaction {
  return {
    query: {
      MoneyTransaction: {
        findFirst: async () => money(),
        findMany: async () => {
          const row = await money()
          return row ? [row] : []
        },
      },
      MoneyCommand: { findFirst: async () => h.nativeOwner },
      MoneyApplication: { findMany: async () => h.applications },
      FinancialSourceAcceptance: {
        findMany: async () => [
          {
            id: 'fa_1',
            sourceObjectId: 'fo_1',
            observationId: 'ob_1',
            state: h.acceptanceState,
            orderInstanceId: 'order_elsewhere',
            moneyTransactionId: MOVEMENT,
          },
        ],
      },
      FinancialSourceObservation: {
        findFirst: async () => ({
          id: 'ob_1',
          contentHash: 'a'.repeat(64),
          payload: {
            version: 2,
            id: 'capture_1',
            kind: 'receipt',
            status: 'confirmed',
            amount: '120.00',
            currency: 'USD',
            processedAt: OCCURRED.toISOString(),
            gateway: h.gatewayHandle,
            settlementCurrency: null,
            parentTransactionId: null,
            creditMemoExternalId: null,
            paymentId: null,
            test: false,
          },
        }),
      },
      MoneySourceLink: {
        findMany: async () => [
          { id: 'link_1', sourceObjectId: 'fo_1', moneyTransactionId: MOVEMENT },
        ],
      },
    },
  } as unknown as Transaction
}

const read = () => readCustomerReceiptAccountingSource(tx(), ORG, MOVEMENT)

beforeEach(() => {
  vi.clearAllMocks()
  h.gatewayHandle = null
  h.feedRailId = 'pg_feed'
  h.applications = [apply('ma_1', ORDER, 12_000n)]
  h.acceptanceState = 'accepted'
  h.environment = 'live'
  h.currency = 'USD'
  h.nativeOwner = null
  h.listPaymentGateways.mockResolvedValue(
    ok([
      { id: 'pg_shopify', handles: ['shopify_payments'], status: 'active' },
      { id: 'pg_closed', handles: ['Authorize.Net'], status: 'closed' },
    ])
  )
  h.getPaymentGateway.mockImplementation(async (_tx: unknown, _org: string, id: string) =>
    ok({ id, name: `Gateway ${id}`, handles: [], clearingGlAccountId: 'gl_clearing' })
  )
})

describe('which rail a channel receipt posts to', () => {
  it('takes the rail its HANDLE names, even when the feed links a different one', async () => {
    h.gatewayHandle = 'Shopify_Payments'
    h.feedRailId = 'pg_feed'
    const source = await read()
    expect(source.paymentGatewayId).toBe('pg_shopify')
  })

  it('matches a CLOSED rail too — its history still has to reconcile', async () => {
    h.gatewayHandle = 'authorize.net'
    const source = await read()
    expect(source.paymentGatewayId).toBe('pg_closed')
  })

  it('names NO rail for a reserved handle, so the money lands in undeposited funds', async () => {
    h.gatewayHandle = 'manual'
    h.feedRailId = null
    const source = await read()
    // No rail, and the feed-link refusal does not apply: a manual Shopify
    // payment is money in no processor.
    expect(source.paymentGatewayId).toBeNull()
    expect(h.getPaymentGateway).not.toHaveBeenCalled()
  })

  it('names no rail for the test gateway either', async () => {
    h.gatewayHandle = 'bogus'
    h.feedRailId = null
    expect((await read()).paymentGatewayId).toBeNull()
  })

  it('refuses an unmapped handle by name rather than falling back to the feed', async () => {
    h.gatewayHandle = 'paypal'
    await expect(read()).rejects.toThrow(
      /Receipt gateway handle "paypal" is not mapped to a payment gateway/
    )
  })

  it('refuses a handle two rails both claim', async () => {
    h.gatewayHandle = 'shopify_payments'
    h.listPaymentGateways.mockResolvedValue(
      ok([
        { id: 'pg_a', handles: ['shopify_payments'], status: 'active' },
        { id: 'pg_b', handles: ['Shopify_Payments'], status: 'active' },
      ])
    )
    await expect(read()).rejects.toThrow(/is not mapped to a payment gateway/)
  })

  it('falls back to the feed link when the transaction carries no handle', async () => {
    h.gatewayHandle = null
    const source = await read()
    expect(source.paymentGatewayId).toBe('pg_feed')
    expect(h.listPaymentGateways).not.toHaveBeenCalled()
  })

  it('refuses when there is no handle and no feed link either', async () => {
    h.gatewayHandle = null
    h.feedRailId = null
    await expect(read()).rejects.toThrow(/Receipt source feed has no payment gateway linked/)
  })
})

// 91 D1: the order is a link. Nothing about the applications refuses the receipt.
describe('the order a receipt names', () => {
  it('is the one order its live applications name', async () => {
    expect((await read()).orderId).toBe(ORDER)
  })

  it('is null for a receipt applied to nothing yet, which still reads', async () => {
    h.applications = []
    expect((await read()).orderId).toBeNull()
  })

  it('reads a partial application off another day without refusing', async () => {
    h.applications = [apply('ma_1', ORDER, 5_000n)]
    expect((await read()).orderId).toBe(ORDER)
  })

  it('names no order for a receipt split across two', async () => {
    h.applications = [apply('ma_1', ORDER, 6_000n), apply('ma_2', 'order_2', 6_000n)]
    expect((await read()).orderId).toBeNull()
  })

  it('ignores an application an unapply reversed', async () => {
    h.applications = [
      apply('ma_1', 'order_2', 12_000n),
      { ...apply('ma_2', 'order_2', 12_000n), operation: 'unapply', reversesApplicationId: 'ma_1' },
      apply('ma_3', ORDER, 12_000n),
    ]
    expect((await read()).orderId).toBe(ORDER)
  })
})

// 91 §4.6: every refusal names its code, so the Blocked tab groups and wakes it.
describe('the code a receipt refusal carries', () => {
  const refusal = async () => refusalFromError(await read().catch((error: unknown) => error))

  it('names an unmapped handle as GATEWAY_UNMAPPED keyed by the handle', async () => {
    h.gatewayHandle = 'paypal'
    expect(await refusal()).toEqual({ reasonCode: 'GATEWAY_UNMAPPED', externalRef: 'paypal' })
  })

  it('names a feed with no rail as GATEWAY_UNMAPPED with no handle', async () => {
    h.feedRailId = null
    expect(await refusal()).toEqual({ reasonCode: 'GATEWAY_UNMAPPED' })
  })

  it('names a non-USD amount MISSING_AMOUNT', async () => {
    h.currency = 'EUR'
    expect((await refusal()).reasonCode).toBe('MISSING_AMOUNT')
  })

  it('waits on an acceptance that has not cleared, and rejects a test feed', async () => {
    h.acceptanceState = 'pending'
    expect((await refusal()).reasonCode).toBe('EVIDENCE_PENDING')
    h.acceptanceState = 'accepted'
    h.environment = 'test'
    expect(await refusal()).toMatchObject({
      reasonCode: 'INVALID_EVIDENCE',
      detail: { message: expect.stringContaining('test mode') },
    })
  })

  it('names native ownership as OWNERSHIP_CONFLICT', async () => {
    h.nativeOwner = { id: 'cmd_1' }
    expect((await refusal()).reasonCode).toBe('OWNERSHIP_CONFLICT')
  })
})
