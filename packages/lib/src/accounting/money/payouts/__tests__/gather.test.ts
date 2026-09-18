// packages/lib/src/accounting/money/payouts/__tests__/gather.test.ts
//
// The split, in its three sources of truth
// (`plans/accounting/payout-links.md` §11.3, brief 27 §4 rules 2 and 3):
// evidence rows when the feed has them, the source's items when it does not, a
// totals-only header when there are no items either. `depositedMinor` is the
// header's, never a sum; a header carrying neither is the source's bug.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  recognise: vi.fn(async () => new Set<string>()),
  listPayoutFeedAccountIds: vi.fn(async () => [] as string[]),
  listPayoutMemberEntryIds: vi.fn(async () => [] as string[]),
  syncStoredMatches: vi.fn(async () => new Map()),
}))

vi.mock('../recognise', () => ({ recognise: h.recognise }))
vi.mock('../reads', () => ({
  listPayoutFeedAccountIds: h.listPayoutFeedAccountIds,
  listPayoutMemberEntryIds: h.listPayoutMemberEntryIds,
}))
vi.mock('../match-sync', () => ({ syncStoredMatches: h.syncStoredMatches }))
vi.mock('@auxx/database', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@auxx/database')>()),
  withAccountingCommitLock: vi.fn(async () => undefined),
}))

import type { Database } from '@auxx/database'
import { UnprocessableEntityError } from '../../../../errors'
import type { PaymentGatewayRow } from '../../../rails/client'
import type { PayoutSplit } from '../client'
import { gatherPayout } from '../gather'
import type { PayoutHeader, PayoutSource, PayoutSourceCtx } from '../source'

const db = {
  transaction: async <T>(run: (tx: unknown) => Promise<T>) => run({}),
} as unknown as Database

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

/** What `syncStoredMatches` answers for one feed holding these rows. */
function summaries(split: Partial<PayoutSplit>, entryCount: number) {
  return new Map([
    [
      'fsa_1',
      {
        basis: [],
        unmatchedCount: 0,
        entryCount,
        stalePostingIds: [],
        split: {
          grossMinor: 0,
          feesMinor: 0,
          netMinor: 0,
          unrecognisedNetMinor: 0,
          unrecognisedCount: 0,
          ...split,
        },
      },
    ],
  ])
}

beforeEach(() => {
  vi.clearAllMocks()
  h.recognise.mockResolvedValue(new Set(['ch_a']))
  h.listPayoutFeedAccountIds.mockResolvedValue([])
  h.listPayoutMemberEntryIds.mockResolvedValue([])
})

describe('gatherPayout over a feed with evidence rows', () => {
  it('splits on the stored match and never asks the source for its items', async () => {
    h.listPayoutFeedAccountIds.mockResolvedValue(['fsa_1'])
    h.listPayoutMemberEntryIds.mockResolvedValue(['pbe_1', 'pbe_2'])
    h.syncStoredMatches.mockResolvedValue(
      summaries(
        {
          grossMinor: 100_000,
          feesMinor: 3_200,
          netMinor: 96_800,
          unrecognisedNetMinor: 48_250,
          unrecognisedCount: 1,
        },
        2
      )
    )
    const listItems = vi.fn()

    const gathered = await gatherPayout(db, {
      ctx,
      source: { ...itemised, listItems },
      header,
    })

    expect(gathered.source).toBe('synced')
    expect(gathered.split.grossMinor).toBe(100_000)
    expect(gathered.split.unrecognisedNetMinor).toBe(48_250)
    expect(listItems).not.toHaveBeenCalled()
    expect(h.recognise).not.toHaveBeenCalled()
  })

  it('runs the matcher inline first, so a payout the drain has not reached still splits', async () => {
    h.listPayoutFeedAccountIds.mockResolvedValue(['fsa_1'])
    h.listPayoutMemberEntryIds.mockResolvedValue(['pbe_1'])
    h.syncStoredMatches.mockResolvedValue(
      summaries({ grossMinor: 10, feesMinor: 0, netMinor: 10 }, 1)
    )

    await gatherPayout(db, { ctx, source: itemised, header })

    expect(h.syncStoredMatches).toHaveBeenCalledWith(expect.anything(), 'org_1', [
      { key: 'fsa_1', sourceAccountId: 'fsa_1', payoutExternalId: 'row_7' },
    ])
  })

  it('falls back to the source items when the feed has no rows for this payout', async () => {
    h.listPayoutFeedAccountIds.mockResolvedValue(['fsa_1'])
    h.listPayoutMemberEntryIds.mockResolvedValue([])

    const gathered = await gatherPayout(db, { ctx, source: itemised, header })

    expect(h.syncStoredMatches).not.toHaveBeenCalled()
    expect(gathered.split.grossMinor).toBe(100_000)
    expect(h.recognise).toHaveBeenCalledTimes(1)
  })
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
