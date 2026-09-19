// packages/lib/src/accounting/money/payouts/__tests__/shopify-payments.test.ts
//
// brief 27 §5 and §13 test 2, the source half: Shopify Payments behind the
// `PayoutSource` interface over a fake `callTool`. Pins how a tool row becomes
// a header (the status map, the lowercased currency, no destination hint) and
// an item (an `order` ref off `sourceOrderId`, `none` without one, the payout's
// own row skipped), how discovery finds the one rail and refuses two, and that
// the app's missing-scope refusal comes back as ONE sentence naming the scope
// rather than a throw `syncPayouts` would have to explain.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  callTool: vi.fn(
    async (_toolId: string, _inputs: Record<string, unknown>): Promise<unknown> => ({})
  ),
  resolveAppToolContext: vi.fn(async (_input: unknown): Promise<unknown> => ({ connected: false })),
  listLinkedFeedAccounts: vi.fn(
    async () => [] as { id: string; externalAccountId: string; paymentGatewayId: string }[]
  ),
}))

vi.mock('../../../../apps/invoke-app-tool', () => ({
  resolveAppToolContext: h.resolveAppToolContext,
}))
vi.mock('../reads', () => ({ listLinkedFeedAccounts: h.listLinkedFeedAccounts }))

import type { Database } from '@auxx/database'
import { ForbiddenError } from '../../../../errors'
import type { PaymentGatewayRow } from '../../../rails/client'
import { getEntryReferenceResolver } from '../reference-resolvers'
import type { PayoutSourceCtx } from '../source'
import { __resetPayoutSourcesForTests, listPayoutSourceIds } from '../source-registry'
import { registerPayoutSources } from '../sources'
import {
  SHOPIFY_PAYMENTS_PAYOUT_SOURCE,
  SHOPIFY_PAYMENTS_PAYOUTS_SCOPE,
  toHeaderStatus,
} from '../sources/shopify-payments'

const ORG = 'org_1'
const SINCE = new Date('2026-09-01T15:30:00.000Z')

const RAIL: PaymentGatewayRow = {
  id: 'pg_shopify',
  recordId: 'payment_gateway:pg_shopify',
  name: 'Shopify Payments',
  handles: ['shopify_payments'],
  clearingGlAccountId: 'gl_clearing_shopify',
  feeGlAccountId: null,
  settlementSource: 'shopify_payments',
  feeTreatment: 'netted',
  status: 'active',
  lastSettlementAt: null,
  processorAccountId: null,
  settlementCurrency: null,
  bankAccountId: null,
  lastFeeBookedAt: null,
  createdAt: null,
  updatedAt: null,
}

const STRIPE_RAIL: PaymentGatewayRow = {
  ...RAIL,
  id: 'pg_stripe',
  recordId: 'payment_gateway:pg_stripe',
  name: 'Stripe',
  handles: ['stripe'],
  settlementSource: 'stripe',
}

const APP_CONTEXT = {
  organizationId: ORG,
  appSlug: 'shopify',
  installationId: 'inst_shopify',
  connectionId: 'cred_1',
  userId: 'user_system',
  connectionMetadata: undefined,
  callTool: h.callTool,
}

const ctx: PayoutSourceCtx = {
  organizationId: ORG,
  sourceId: 'shopify_payments',
  rail: RAIL,
  handle: APP_CONTEXT,
}

/** What `list_shopify_payouts` hands back for one paid payout. */
const PAYOUT = {
  id: '987654',
  status: 'paid',
  date: '2026-09-14',
  currency: 'USD',
  amountMinor: 142_300,
  summary: {
    adjustmentsFeeMinor: 0,
    adjustmentsGrossMinor: 0,
    chargesFeeMinor: 5_200,
    chargesGrossMinor: 160_000,
    refundsFeeMinor: 0,
    refundsGrossMinor: -10_000,
    reservedFundsFeeMinor: 0,
    reservedFundsGrossMinor: 0,
    retriedPayoutsFeeMinor: 0,
    retriedPayoutsGrossMinor: 0,
  },
}

/** What `list_shopify_payout_transactions` hands back for it. */
const TRANSACTIONS = [
  // A charge on an order the connector synced.
  {
    id: 't_a',
    type: 'charge',
    test: false,
    amountMinor: 100_000,
    feeMinor: 3_200,
    netMinor: 96_800,
    sourceId: '11',
    sourceType: 'Payments::Charge',
    sourceOrderId: '5001',
    sourceOrderTransactionId: '9001',
    processedAt: '2026-09-12T10:00:00Z',
  },
  // A charge on an order auxx never saw: still an `order` ref, the recogniser decides.
  {
    id: 't_b',
    type: 'charge',
    test: false,
    amountMinor: 60_000,
    feeMinor: 2_000,
    netMinor: 58_000,
    sourceId: '12',
    sourceType: 'Payments::Charge',
    sourceOrderId: '5002',
    sourceOrderTransactionId: '9002',
    processedAt: '2026-09-12T11:00:00Z',
  },
  // A refund on the first order: negative, same ref.
  {
    id: 't_r',
    type: 'refund',
    test: false,
    amountMinor: -10_000,
    feeMinor: 0,
    netMinor: -10_000,
    sourceId: '13',
    sourceType: 'Payments::Refund',
    sourceOrderId: '5001',
    sourceOrderTransactionId: '9003',
    processedAt: '2026-09-13T09:00:00Z',
  },
  // The payout itself, listed among its own transactions: skipped, never counted.
  {
    id: 't_po',
    type: 'payout',
    test: false,
    amountMinor: -142_300,
    feeMinor: 0,
    netMinor: -142_300,
    sourceId: null,
    sourceType: null,
    sourceOrderId: null,
    sourceOrderTransactionId: null,
    processedAt: '2026-09-14T00:00:00Z',
  },
  // An adjustment with no order: `none`.
  {
    id: 't_adj',
    type: 'adjustment',
    test: false,
    amountMinor: -2_500,
    feeMinor: 0,
    netMinor: -2_500,
    sourceId: null,
    sourceType: null,
    sourceOrderId: null,
    sourceOrderTransactionId: null,
    processedAt: '2026-09-13T12:00:00Z',
  },
]

/** An error as `callTool` throws it after the Lambda boundary: a message plus the SDK's code and details. */
function lambdaError(code: string, details?: Record<string, unknown>): Error {
  const error = new Error(`Shopify tool list_shopify_payouts failed: refused (${code})`)
  Object.assign(error, { code, statusCode: 403, details })
  return error
}

beforeEach(() => {
  vi.clearAllMocks()
  h.callTool.mockImplementation(async (toolId) => {
    if (toolId === 'list_shopify_payouts') return { payouts: [PAYOUT] }
    if (toolId === 'list_shopify_payout_transactions') return { transactions: TRANSACTIONS }
    throw new Error(`unexpected tool ${toolId}`)
  })
  h.resolveAppToolContext.mockResolvedValue({ connected: true, context: APP_CONTEXT })
})

describe('registerPayoutSources', () => {
  it('registers Stripe Connect and Shopify Payments, in that order', () => {
    __resetPayoutSourcesForTests()
    registerPayoutSources()

    expect(listPayoutSourceIds()).toEqual(['stripe', 'shopify_payments'])
    __resetPayoutSourcesForTests()
  })

  // The same boot call fills the reference-resolver seam; a process that filled
  // only the source registry would leave every Authorize.net item `no_reference`.
  it('fills the entry reference resolver seam in the same call', () => {
    registerPayoutSources()

    expect(getEntryReferenceResolver('authorize_net')?.providerKey).toBe('authorize_net')
    __resetPayoutSourcesForTests()
  })
})

describe('SHOPIFY_PAYMENTS_PAYOUT_SOURCE.listPayouts', () => {
  it('asks the tool for payouts since the UTC day and transcribes each header', async () => {
    const headers = await SHOPIFY_PAYMENTS_PAYOUT_SOURCE.listPayouts(ctx, SINCE)

    expect(h.callTool).toHaveBeenCalledWith('list_shopify_payouts', { since: '2026-09-01' })
    expect(headers).toEqual([
      {
        providerPayoutId: '987654',
        paidAt: '2026-09-14',
        currency: 'usd',
        status: 'paid',
        depositedMinor: 142_300,
      },
    ])
    // Shopify says nothing about the destination, so the key is ABSENT, not undefined.
    expect('destinationHint' in headers[0]!).toBe(false)
  })

  it('maps every Shopify status onto the header union, scheduled as in transit', () => {
    expect(toHeaderStatus('scheduled')).toBe('in_transit')
    expect(toHeaderStatus('in_transit')).toBe('in_transit')
    expect(toHeaderStatus('paid')).toBe('paid')
    expect(toHeaderStatus('failed')).toBe('failed')
    expect(toHeaderStatus('canceled')).toBe('canceled')
  })

  it('refuses a tool answer with no payouts collection rather than reading it as empty', async () => {
    h.callTool.mockResolvedValue({})

    await expect(SHOPIFY_PAYMENTS_PAYOUT_SOURCE.listPayouts(ctx, SINCE)).rejects.toThrow(
      /no "payouts" collection/
    )
  })

  it('refuses a context whose handle is not a resolved app tool context', async () => {
    await expect(
      SHOPIFY_PAYMENTS_PAYOUT_SOURCE.listPayouts({ ...ctx, handle: 'acct_1' }, SINCE)
    ).rejects.toThrow(/Shopify app tool context/)
    expect(h.callTool).not.toHaveBeenCalled()
  })
})

describe('SHOPIFY_PAYMENTS_PAYOUT_SOURCE.listItems', () => {
  it('maps transactions to items with no ref at all, the payout row skipped', async () => {
    const [header] = await SHOPIFY_PAYMENTS_PAYOUT_SOURCE.listPayouts(ctx, SINCE)
    const items = await SHOPIFY_PAYMENTS_PAYOUT_SOURCE.listItems!(ctx, header!)

    expect(h.callTool).toHaveBeenCalledWith('list_shopify_payout_transactions', {
      payoutId: '987654',
    })
    // The split moved to the stored match (§11.3); `source_order_id` said the
    // order was here, never that this charge was settled by that receipt.
    expect(items).toEqual([
      { externalId: 't_a', grossMinor: 100_000, feeMinor: 3_200, ref: { kind: 'none' } },
      { externalId: 't_b', grossMinor: 60_000, feeMinor: 2_000, ref: { kind: 'none' } },
      { externalId: 't_r', grossMinor: -10_000, feeMinor: 0, ref: { kind: 'none' } },
      { externalId: 't_adj', grossMinor: -2_500, feeMinor: 0, ref: { kind: 'none' } },
    ])
  })

  it('never produces a stripe_charge ref (R3)', async () => {
    const [header] = await SHOPIFY_PAYMENTS_PAYOUT_SOURCE.listPayouts(ctx, SINCE)
    const items = await SHOPIFY_PAYMENTS_PAYOUT_SOURCE.listItems!(ctx, header!)

    expect(items.map((item) => item.ref.kind)).not.toContain('stripe_charge')
  })
})

describe('the missing-scope refusal', () => {
  it('becomes one ForbiddenError sentence naming the scope the app reported', async () => {
    h.callTool.mockRejectedValue(
      lambdaError('INSUFFICIENT_PERMISSIONS', { requiredScopes: ['read_shopify_payments_payouts'] })
    )

    const attempt = SHOPIFY_PAYMENTS_PAYOUT_SOURCE.listPayouts(ctx, SINCE)

    await expect(attempt).rejects.toBeInstanceOf(ForbiddenError)
    await expect(attempt).rejects.toThrow(
      'Shopify has not granted read_shopify_payments_payouts for this store, so its payouts cannot be read. Reconnect the Shopify app to approve the scope; nothing else the app does is affected.'
    )
  })

  it('names this source’s scope when the refusal carries none', async () => {
    h.callTool.mockRejectedValue(lambdaError('INSUFFICIENT_PERMISSIONS'))

    await expect(SHOPIFY_PAYMENTS_PAYOUT_SOURCE.listPayouts(ctx, SINCE)).rejects.toThrow(
      SHOPIFY_PAYMENTS_PAYOUTS_SCOPE
    )
  })

  it('rethrows every other failure as the app worded it', async () => {
    const upstream = lambdaError('UPSTREAM_ERROR')
    h.callTool.mockRejectedValue(upstream)

    await expect(SHOPIFY_PAYMENTS_PAYOUT_SOURCE.listPayouts(ctx, SINCE)).rejects.toBe(upstream)
  })
})

describe('SHOPIFY_PAYMENTS_PAYOUT_SOURCE.resolveContexts', () => {
  const db = {} as Database
  const FEED = { id: 'fsa_1', externalAccountId: 'gid://shopify/…', paymentGatewayId: RAIL.id }

  it('yields nothing, and never resolves the app, when nothing has linked a Shopify Payments feed', async () => {
    h.listLinkedFeedAccounts.mockResolvedValue([])

    const contexts = await SHOPIFY_PAYMENTS_PAYOUT_SOURCE.resolveContexts!(db, ORG, [STRIPE_RAIL])

    expect(contexts).toEqual([])
    expect(h.resolveAppToolContext).not.toHaveBeenCalled()
  })

  it('yields nothing when a feed is linked but the Shopify app is not connected', async () => {
    h.listLinkedFeedAccounts.mockResolvedValue([FEED])
    h.resolveAppToolContext.mockResolvedValue({ connected: false })

    const contexts = await SHOPIFY_PAYMENTS_PAYOUT_SOURCE.resolveContexts!(db, ORG, [RAIL])

    expect(contexts).toEqual([])
    expect(h.resolveAppToolContext).toHaveBeenCalledWith({
      organizationId: ORG,
      appSlug: 'shopify',
      appLabel: 'Shopify',
    })
  })

  it('yields one context per linked feed, with the resolved app context as its handle', async () => {
    h.listLinkedFeedAccounts.mockResolvedValue([FEED])

    const contexts = await SHOPIFY_PAYMENTS_PAYOUT_SOURCE.resolveContexts!(db, ORG, [
      STRIPE_RAIL,
      RAIL,
    ])

    expect(contexts).toEqual([
      { organizationId: ORG, sourceId: 'shopify_payments', rail: RAIL, handle: APP_CONTEXT },
    ])
  })

  it('drops a linked feed whose gateway id names no live record, rather than posting with none', async () => {
    h.listLinkedFeedAccounts.mockResolvedValue([{ ...FEED, paymentGatewayId: 'pg_gone' }])

    const contexts = await SHOPIFY_PAYMENTS_PAYOUT_SOURCE.resolveContexts!(db, ORG, [RAIL])

    expect(contexts).toEqual([])
  })

  it('yields two contexts for two feeds linked to two different rails, never one for both', async () => {
    const second = { ...RAIL, id: 'pg_shopify_2', name: 'Shopify EU' }
    h.listLinkedFeedAccounts.mockResolvedValue([
      FEED,
      { id: 'fsa_2', externalAccountId: 'gid://shopify/…2', paymentGatewayId: second.id },
    ])

    const contexts = await SHOPIFY_PAYMENTS_PAYOUT_SOURCE.resolveContexts!(db, ORG, [RAIL, second])

    expect(contexts).toEqual([
      { organizationId: ORG, sourceId: 'shopify_payments', rail: RAIL, handle: APP_CONTEXT },
      { organizationId: ORG, sourceId: 'shopify_payments', rail: second, handle: APP_CONTEXT },
    ])
  })
})

describe('SHOPIFY_PAYMENTS_PAYOUT_SOURCE.listOrganizations', () => {
  it('reads every org with a live Shopify installation, once each', async () => {
    const chain: Record<string, unknown> = {}
    for (const method of ['from', 'innerJoin']) chain[method] = () => chain
    chain.where = () => Promise.resolve([{ organizationId: 'org_a' }, { organizationId: 'org_b' }])
    const selectDistinct = vi.fn(() => chain)
    const db = { selectDistinct } as unknown as Database

    const organizations = await SHOPIFY_PAYMENTS_PAYOUT_SOURCE.listOrganizations!(db)

    expect(organizations).toEqual(['org_a', 'org_b'])
    expect(selectDistinct).toHaveBeenCalledTimes(1)
  })
})
