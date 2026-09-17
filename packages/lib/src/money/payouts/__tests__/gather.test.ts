// packages/lib/src/money/payouts/__tests__/gather.test.ts
//
// brief 27 §4 rules 2 and 3 / §13 test 3: a source with totals and no items
// posts recognised gross with a zero remainder and the record says `imported`;
// an itemised source says `synced`; `depositedMinor` is the header's, never a
// sum; and a header that carries neither is the source's bug, refused.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  recognise: vi.fn(async () => new Set<string>()),
}))

vi.mock('../recognise', () => ({ recognise: h.recognise }))

import type { Database } from '@auxx/database'
import { UnprocessableEntityError } from '../../../errors'
import type { PaymentGatewayRow } from '../../../payment-gateways/client'
import { gatherPayout } from '../gather'
import type { PayoutHeader, PayoutSource, PayoutSourceCtx } from '../source'

const db = {} as Database

/** A minimal linked rail - task 58 §5.5: every context carries exactly one. */
const RAIL: PaymentGatewayRow = {
  id: 'gateway_1',
  recordId: 'payment_gateway:gateway_1',
  name: 'Stripe',
  handles: [],
  clearingGlAccountId: '',
  feeGlAccountId: null,
  settlementSource: 'stripe',
  processorAccountId: null,
  settlementCurrency: null,
  bankAccountId: null,
  feeTreatment: 'netted',
  status: 'active',
  lastSettlementAt: null,
  lastFeeBookedAt: null,
  createdAt: null,
  updatedAt: null,
}

const ctx: PayoutSourceCtx = {
  organizationId: 'org_1',
  sourceId: 'stripe',
  rail: RAIL,
  handle: 'acct_1',
}

const header: PayoutHeader = {
  providerPayoutId: 'row_7',
  paidAt: '2026-09-12',
  currency: 'usd',
  status: 'paid',
  // Deliberately NOT gross - fees: the header is transcribed, and a source
  // whose arithmetic disagrees must reach the builder's refusal, not be
  // silently corrected here.
  depositedMinor: 145_000,
}

/** A source with totals only - the shape a statement row takes. */
const totalsOnly: PayoutSource = {
  id: 'stripe',
  kind: 'file',
  listPayouts: async () => [],
}

/** An itemised source. */
const itemised: PayoutSource = {
  id: 'stripe',
  kind: 'api',
  listPayouts: async () => [],
  listItems: async () => [
    {
      externalId: 'bt_1',
      grossMinor: 100_000,
      feeMinor: 3_200,
      ref: { kind: 'stripe_charge', id: 'ch_a' },
    },
    { externalId: 'bt_2', grossMinor: 50_000, feeMinor: 1_750, ref: { kind: 'none' } },
  ],
}

beforeEach(() => {
  vi.clearAllMocks()
  h.recognise.mockResolvedValue(new Set(['ch_a']))
})

describe('gatherPayout over a totals-only source', () => {
  it('posts recognised gross with a zero remainder and says `imported`', async () => {
    const gathered = await gatherPayout(db, {
      ctx,
      source: totalsOnly,
      header: { ...header, totals: { grossMinor: 150_000, feesMinor: 4_950 } },
    })

    expect(gathered.source).toBe('imported')
    expect(gathered.split).toEqual({
      grossMinor: 150_000,
      feesMinor: 4_950,
      netMinor: 145_050,
      unrecognisedNetMinor: 0,
      unrecognisedCount: 0,
    })
    expect(h.recognise).not.toHaveBeenCalled()
  })

  it('transcribes the deposit from the header rather than deriving it', async () => {
    const gathered = await gatherPayout(db, {
      ctx,
      source: totalsOnly,
      header: { ...header, totals: { grossMinor: 150_000, feesMinor: 4_950 } },
    })

    expect(gathered.depositedMinor).toBe(145_000)
  })

  it('refuses a header with neither items nor totals as the source’s own bug', async () => {
    await expect(gatherPayout(db, { ctx, source: totalsOnly, header })).rejects.toBeInstanceOf(
      UnprocessableEntityError
    )
  })
})

describe('gatherPayout over an itemised source', () => {
  it('splits through the recogniser and says `synced`', async () => {
    const gathered = await gatherPayout(db, { ctx, source: itemised, header })

    expect(gathered.source).toBe('synced')
    expect(h.recognise).toHaveBeenCalledTimes(1)
    expect(gathered.split).toEqual({
      grossMinor: 100_000,
      feesMinor: 3_200,
      netMinor: 96_800,
      unrecognisedNetMinor: 48_250,
      unrecognisedCount: 1,
    })
  })

  it('prefers the items over totals when a header carries both', async () => {
    const gathered = await gatherPayout(db, {
      ctx,
      source: itemised,
      header: { ...header, totals: { grossMinor: 1, feesMinor: 0 } },
    })

    expect(gathered.source).toBe('synced')
    expect(gathered.split.grossMinor).toBe(100_000)
  })

  it('carries the header’s status, currency, date and destination hint through', async () => {
    const gathered = await gatherPayout(db, {
      ctx,
      source: itemised,
      header: { ...header, status: 'in_transit', destinationHint: 'ba_1' },
    })

    expect(gathered).toMatchObject({
      payoutId: 'row_7',
      paidAt: '2026-09-12',
      currency: 'usd',
      gatewayStatus: 'in_transit',
      destination: 'ba_1',
    })
  })

  it('reads `null` for a destination the source did not report', async () => {
    const gathered = await gatherPayout(db, { ctx, source: itemised, header })
    expect(gathered.destination).toBeNull()
  })
})
