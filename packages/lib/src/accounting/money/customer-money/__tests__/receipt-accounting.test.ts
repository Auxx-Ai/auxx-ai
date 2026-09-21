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
}))

vi.mock('../../../rails/reads', () => ({
  listPaymentGateways: h.listPaymentGateways,
  getPaymentGateway: h.getPaymentGateway,
}))

vi.mock('../source-reads', () => ({
  readSourceObject: async () => ({ id: 'fo_1', sourceAccountId: 'fsa_1', externalId: 'capture_1' }),
  readSourceAccount: async () => ({
    id: 'fsa_1',
    environment: 'live',
    archivedAt: null,
    providerKey: 'shopify',
    externalAccountId: 'demo.myshopify.com',
    paymentGatewayId: h.feedRailId,
  }),
}))

import type { Transaction } from '@auxx/database'
import { readCustomerReceiptAccountingSource } from '../receipt-accounting'

const ORG = 'org_1'
const MOVEMENT = 'mt_1'
const ORDER = 'order_1'
const OCCURRED = new Date('2026-09-01T15:00:00.000Z')

const money = () => ({
  id: MOVEMENT,
  purpose: 'customer_receipt' as const,
  amountMinor: 12_000n,
  currency: 'USD',
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
      MoneyCommand: { findFirst: async () => null },
      MoneyApplication: {
        findMany: async () => [
          {
            id: 'ma_1',
            operation: 'apply',
            orderInstanceId: ORDER,
            amountMinor: 12_000n,
            effectiveDate: '2026-09-01',
          },
        ],
      },
      FinancialSourceAcceptance: {
        findMany: async () => [
          {
            id: 'fa_1',
            sourceObjectId: 'fo_1',
            observationId: 'ob_1',
            state: 'accepted',
            orderInstanceId: ORDER,
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

const read = () => readCustomerReceiptAccountingSource(tx(), ORG, MOVEMENT, 'America/Los_Angeles')

beforeEach(() => {
  vi.clearAllMocks()
  h.gatewayHandle = null
  h.feedRailId = 'pg_feed'
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
