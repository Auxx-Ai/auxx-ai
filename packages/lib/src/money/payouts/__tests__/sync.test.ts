// packages/lib/src/money/payouts/__tests__/sync.test.ts
//
// plans/accounting/tasks/done/17-accounting-is-opt-in.md section 3. `syncPayouts`
// runs nightly for every org a source can poll (`payoutSyncJob` ->
// `sweepPayouts`), so the gate sits here, once per org, before any source is
// asked for a context - not only inside `postPayoutEntry`, which this test does
// not even need to mock to prove the point: the run never gets that far.
//
// task 58 §5.5: every context now carries exactly one rail, resolved off a
// linked `FinancialSourceAccount` rather than the retired `settlementSource`
// enum, so there is no more per-payout gateway resolver or ownership guard to
// pin here - `build-payout-entry.test.ts` pins the entry itself, and this file
// stays about orchestration: the gate, the per-rail floor and one source's
// failure never stopping another.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  gatherPayout: vi.fn(async () => ({})),
  isAccountingEnabled: vi.fn(async () => true),
  requirePayoutFieldContext: vi.fn(
    async () =>
      ({
        payoutDefId: 'def_payout',
        fields: { payout_payment_gateway: { id: 'f_pg' } },
      }) as never
  ),
  listLinkedFeedAccounts: vi.fn(
    async () => [] as { id: string; externalAccountId: string; paymentGatewayId: string }[]
  ),
  getPaymentAccount: vi.fn(async () => null as { stripeAccountId: string } | null),
  paymentGateways: [] as unknown[],
}))

vi.mock('../gather', () => ({ gatherPayout: h.gatherPayout }))
vi.mock('../../../postings/accounting-enabled', () => ({
  isAccountingEnabled: h.isAccountingEnabled,
}))
vi.mock('../reads', () => ({
  requirePayoutFieldContext: h.requirePayoutFieldContext,
  findPayoutByGatewayId: vi.fn(),
  listLinkedFeedAccounts: h.listLinkedFeedAccounts,
}))
vi.mock('../../stripe-connect/account', () => ({
  getPaymentAccount: h.getPaymentAccount,
}))
vi.mock('../../../accounting/rails/reads', () => ({
  listPaymentGateways: async () => ({
    isErr: () => false,
    isOk: () => true,
    value: h.paymentGateways,
  }),
}))
vi.mock('../../../users/system-user-service', () => ({
  SystemUserService: { getSystemUserForActions: async () => 'user_system' },
}))

import type { Database } from '@auxx/database'
import type { PaymentGatewayRow } from '../../../accounting/rails/client'
import type { PayoutSource, PayoutSourceCtx } from '../source'
import { __resetPayoutSourcesForTests, registerPayoutSource } from '../source-registry'
import { registerPayoutSources } from '../sources'
import { syncPayoutSource, syncPayouts } from '../sync'

const ORG = 'org_1'
const db = {} as Database

const EMPTY = { seen: 0, created: 0, posted: 0, alreadyPosted: 0, refused: [], failed: [] }

/** A `Database` whose one select (the first-sync floor) answers `rows`. */
function stubDb(rows: { createdAt: Date }[] = []): Database {
  const chain: Record<string, unknown> = {}
  for (const method of ['from', '$dynamic', 'leftJoin', 'innerJoin', 'where', 'orderBy']) {
    chain[method] = () => chain
  }
  chain.limit = () => Promise.resolve(rows)
  return { select: () => chain } as unknown as Database
}

beforeEach(() => {
  vi.clearAllMocks()
  __resetPayoutSourcesForTests()
  registerPayoutSources()
  h.isAccountingEnabled.mockResolvedValue(true)
  h.getPaymentAccount.mockResolvedValue(null)
  h.listLinkedFeedAccounts.mockResolvedValue([])
  h.paymentGateways = []
})

/** One `payment_gateway` row, as `listPaymentGateways` hands it over. */
function gateway(overrides: Partial<PaymentGatewayRow> = {}): PaymentGatewayRow {
  return {
    id: 'pg_stripe',
    recordId: 'payment_gateway:pg_stripe',
    name: 'Stripe',
    handles: ['stripe'],
    clearingGlAccountId: 'gl_clearing_stripe',
    feeGlAccountId: null,
    settlementSource: 'stripe',
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

describe('accounting not enabled', () => {
  it('never looks up the payout field context or asks a source for a context, and returns an empty result', async () => {
    h.isAccountingEnabled.mockResolvedValue(false)

    const result = await syncPayouts(db, { organizationId: ORG })

    expect(result.isOk()).toBe(true)
    expect(result._unsafeUnwrap()).toEqual(EMPTY)
    expect(h.requirePayoutFieldContext).not.toHaveBeenCalled()
    expect(h.getPaymentAccount).not.toHaveBeenCalled()
  })
})

describe('accounting enabled', () => {
  it('proceeds past the gate to the ordinary no-linked-feed case', async () => {
    const result = await syncPayouts(db, { organizationId: ORG })

    expect(result.isOk()).toBe(true)
    expect(result._unsafeUnwrap()).toEqual(EMPTY)
    expect(h.requirePayoutFieldContext).toHaveBeenCalledTimes(1)
    // Stripe's own no-connected-account short-circuit still runs first.
    expect(h.getPaymentAccount).toHaveBeenCalledTimes(1)
  })

  it('finds nothing to run when no source is registered at all', async () => {
    // The §7 hazard, stated: a process that never called
    // `registerPayoutSources()` syncs nothing, silently.
    __resetPayoutSourcesForTests()

    const result = await syncPayouts(db, { organizationId: ORG })

    expect(result._unsafeUnwrap()).toEqual(EMPTY)
    expect(h.getPaymentAccount).not.toHaveBeenCalled()
  })

  it('finds nothing to run when nothing has linked a feed to a rail', async () => {
    // task 58 §5.5: a feed nothing has linked is a manual rail - never polled.
    h.getPaymentAccount.mockResolvedValue({ stripeAccountId: 'acct_1' })
    h.listLinkedFeedAccounts.mockResolvedValue([])

    const result = await syncPayouts(db, { organizationId: ORG })

    expect(result._unsafeUnwrap()).toEqual(EMPTY)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// brief 27 §6.5: the first-run floor and the lookback are PER RAIL. Pinned
// through a fake source that records the `since` it was asked for.
// ─────────────────────────────────────────────────────────────────────────────

const NOW = new Date('2026-09-14T12:00:00.000Z')
const LOOKBACK = new Date('2026-08-15T12:00:00.000Z')

function recordingSource(): PayoutSource & { since: Date[] } {
  const since: Date[] = []
  return {
    id: 'shopify_payments',
    kind: 'api',
    since,
    listPayouts: async (_ctx, s) => {
      since.push(s)
      return []
    },
  }
}

function ctxFor(rail: PaymentGatewayRow): PayoutSourceCtx {
  return { organizationId: ORG, sourceId: 'shopify_payments', rail, handle: 'x' }
}

describe('the per-rail floor (resolveSince)', () => {
  it('reads from now on a rail that has never synced and carries no watermark', async () => {
    const source = recordingSource()
    registerPayoutSource(source)

    await syncPayoutSource(stubDb([]), ctxFor(gateway({ settlementSource: 'shopify_payments' })), {
      now: NOW,
    })

    expect(source.since).toEqual([NOW])
  })

  it('starts from the hand-entered lastSettlementAt on a rail that has never synced', async () => {
    const source = recordingSource()
    registerPayoutSource(source)

    await syncPayoutSource(
      stubDb([]),
      ctxFor(gateway({ settlementSource: 'shopify_payments', lastSettlementAt: '2026-09-01' })),
      { now: NOW }
    )

    expect(source.since).toEqual([new Date('2026-09-01T00:00:00.000Z')])
  })

  it('bounds a hand-entered date older than the lookback to the lookback', async () => {
    const source = recordingSource()
    registerPayoutSource(source)

    await syncPayoutSource(
      stubDb([]),
      ctxFor(gateway({ settlementSource: 'shopify_payments', lastSettlementAt: '2026-01-01' })),
      { now: NOW }
    )

    expect(source.since).toEqual([LOOKBACK])
  })

  it('reads the ordinary lookback once the rail holds a record, even with a later watermark', async () => {
    // 🛑 The stamped watermark is not the `since`: a payout refused before it
    // must still be re-read so the remedy is retried. The first record's date
    // is the floor and the lookback is what actually applies.
    const source = recordingSource()
    registerPayoutSource(source)

    await syncPayoutSource(
      stubDb([{ createdAt: new Date('2026-07-01T00:00:00.000Z') }]),
      ctxFor(gateway({ settlementSource: 'shopify_payments', lastSettlementAt: '2026-09-12' })),
      { now: NOW }
    )

    expect(source.since).toEqual([LOOKBACK])
  })

  it('never reaches further back than the rail’s first record when that is inside the lookback', async () => {
    const source = recordingSource()
    registerPayoutSource(source)
    const first = new Date('2026-09-10T00:00:00.000Z')

    await syncPayoutSource(
      stubDb([{ createdAt: first }]),
      ctxFor(gateway({ settlementSource: 'shopify_payments' })),
      { now: NOW }
    )

    expect(source.since).toEqual([first])
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// brief 27 §7: one rail's failure never stops the next.
// ─────────────────────────────────────────────────────────────────────────────

describe('one source failing inside an org', () => {
  it('is reported in `failed`, named by rail, while the other source still runs', async () => {
    const stripeRail = gateway({ id: 'pg_stripe' })
    const shopifyRail = gateway({ id: 'pg_shop', settlementSource: 'shopify_payments' })
    h.paymentGateways = [stripeRail, shopifyRail]
    const broken: PayoutSource = {
      id: 'stripe',
      kind: 'api',
      resolveContexts: async () => [{ ...ctxFor(stripeRail), sourceId: 'stripe' }],
      listPayouts: async () => {
        throw new Error('401 from the provider')
      },
    }
    const healthy = recordingSource()
    healthy.resolveContexts = async () => [ctxFor(shopifyRail)]
    __resetPayoutSourcesForTests()
    registerPayoutSource(broken)
    registerPayoutSource(healthy)

    const result = await syncPayouts(stubDb(), { organizationId: ORG, now: NOW })

    expect(result.isOk()).toBe(true)
    // The provider's own sentence, kept verbatim: it is what a person needs to
    // act on, and `guard`'s "Internal error" would have thrown it away.
    expect(result._unsafeUnwrap().failed).toEqual([
      { sourceId: 'stripe', paymentGatewayId: 'pg_stripe', reason: '401 from the provider' },
    ])
    expect(healthy.since).toHaveLength(1)
  })
})
