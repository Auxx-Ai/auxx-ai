// packages/lib/src/money/payouts/__tests__/sync.test.ts
//
// plans/accounting/tasks/done/17-accounting-is-opt-in.md section 3. `syncPayouts`
// runs nightly for every org a source can poll (`payoutSyncJob` ->
// `sweepPayouts`), so the gate sits here, once per org, before any source is
// asked for a context - not only inside `postPayoutEntry`, which this test does
// not even need to mock to prove the point: the run never gets that far.
//
// Since brief 27 unit 2 the Stripe-specific resolvers live with the Stripe
// source (`sources/stripe-connect.ts`) over the generic `resolvePayoutRail`;
// their sentences are pinned here byte for byte because the entry freezes them.
// The last two blocks pin the per-rail floor (§6.5) and the rule that one
// rail's failure never stops the next (§7), through a fake source.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  assertLegacyPayoutIngestionOwner: vi.fn(async () => {}),
  gatherPayout: vi.fn(async () => ({})),
  isAccountingEnabled: vi.fn(async () => true),
  requirePayoutFieldContext: vi.fn(
    async () =>
      ({
        payoutDefId: 'def_payout',
        fields: { payout_payment_gateway: { id: 'f_pg' } },
      }) as never
  ),
  getPaymentAccount: vi.fn(async () => null as { stripeAccountId: string } | null),
  findBankAccountByStripeExternalAccountId: vi.fn(
    async () =>
      null as { bankAccountId: string; recordId: string; glAccountId: string | null } | null
  ),
  paymentGateways: [] as unknown[],
}))

vi.mock('../ingestion-owner', () => ({
  assertLegacyPayoutIngestionOwner: h.assertLegacyPayoutIngestionOwner,
}))
vi.mock('../gather', () => ({ gatherPayout: h.gatherPayout }))
vi.mock('../../../postings/accounting-enabled', () => ({
  isAccountingEnabled: h.isAccountingEnabled,
}))
vi.mock('../reads', () => ({
  requirePayoutFieldContext: h.requirePayoutFieldContext,
  findPayoutByGatewayId: vi.fn(),
  findBankAccountByStripeExternalAccountId: h.findBankAccountByStripeExternalAccountId,
}))
vi.mock('../../payments/account-state', () => ({
  getPaymentAccount: h.getPaymentAccount,
}))
vi.mock('../../../payment-gateways/reads', () => ({
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
import { type PaymentGatewayRow, toGatewayRoutes } from '../../../payment-gateways/client'
import { resolveFulfillmentDebit } from '../../../postings/build-fulfillment-batch-entry'
import { registerPayoutSources } from '../../payout-sources'
import type { PayoutSource, PayoutSourceCtx } from '../source'
import { __resetPayoutSourcesForTests, registerPayoutSource } from '../source-registry'
import { resolvePayoutGateway, resolvePayoutGatewayFrom } from '../sources/stripe-connect'
import { resolvePayoutBankAccount, syncPayoutSource, syncPayouts } from '../sync'

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
  h.assertLegacyPayoutIngestionOwner.mockReset().mockResolvedValue(undefined)
  __resetPayoutSourcesForTests()
  registerPayoutSources()
  h.isAccountingEnabled.mockResolvedValue(true)
  h.getPaymentAccount.mockResolvedValue(null)
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
  it('proceeds past the gate to the ordinary no-connected-Stripe-account case', async () => {
    const result = await syncPayouts(db, { organizationId: ORG })

    expect(result.isOk()).toBe(true)
    expect(result._unsafeUnwrap()).toEqual(EMPTY)
    expect(h.requirePayoutFieldContext).toHaveBeenCalledTimes(1)
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
})

// ─────────────────────────────────────────────────────────────────────────────
// brief 13 §2.3: a payout debits a bank account, resolved through a CONFIRMED
// Stripe identity, never a role and never `last4`.
// ─────────────────────────────────────────────────────────────────────────────

describe('resolvePayoutBankAccount', () => {
  it('blocks with no build when Stripe reported no destination at all', async () => {
    const result = await resolvePayoutBankAccount(db, ORG, null, 'PAY-0001')

    expect(result.blockedReason).toMatch(/no destination reported by Stripe/)
    expect(result.glAccountId).toBeUndefined()
    expect(h.findBankAccountByStripeExternalAccountId).not.toHaveBeenCalled()
  })

  it('names the source, not Stripe, when another source reports no destination', async () => {
    // brief 27 §6.3: the rail record carries no bank-account field yet, so a
    // Shopify payout with no destination hint blocks rather than guessing.
    const result = await resolvePayoutBankAccount(db, ORG, null, 'PAY-0001', 'Shopify Payments')

    expect(result.blockedReason).toBe(
      'Payout PAY-0001 settled with no destination reported by Shopify Payments, so there is no ' +
        'bank account to debit. Confirm its bank account on Accounting > Settings > Bank accounts.'
    )
  })

  it('blocks, naming the payout and the destination, when no bank account carries that identity', async () => {
    h.findBankAccountByStripeExternalAccountId.mockResolvedValue(null)

    const result = await resolvePayoutBankAccount(db, ORG, 'ba_unknown', 'PAY-0001')

    expect(result.blockedReason).toContain('PAY-0001')
    expect(result.blockedReason).toContain('ba_unknown')
    expect(result.blockedReason).toMatch(/not confirmed on any bank account/)
  })

  it('blocks when the matched bank account has no chart mapping', async () => {
    h.findBankAccountByStripeExternalAccountId.mockResolvedValue({
      bankAccountId: 'ba_row_1',
      recordId: 'def_bank_account:ba_row_1',
      glAccountId: null,
    })

    const result = await resolvePayoutBankAccount(db, ORG, 'ba_confirmed', 'PAY-0001')

    expect(result.blockedReason).toBeTruthy()
    expect(result.bankAccountRecordId).toBeUndefined()
  })

  it('resolves the gl_account id of a confirmed bank account, and blocks nothing', async () => {
    h.findBankAccountByStripeExternalAccountId.mockResolvedValue({
      bankAccountId: 'ba_row_1',
      recordId: 'def_bank_account:ba_row_1',
      glAccountId: 'gl_1000',
    })

    const result = await resolvePayoutBankAccount(db, ORG, 'ba_confirmed', 'PAY-0001')

    expect(result).toMatchObject({ blockedReason: null, glAccountId: 'gl_1000' })
  })

  it('carries the bank_account record id, so the payout can point at the account it landed in', async () => {
    // brief 27 §6.1: `destination` is a Stripe id only this resolver can read;
    // the record's own `bankAccount` pointer is what every other source, and
    // every screen, reads instead.
    h.findBankAccountByStripeExternalAccountId.mockResolvedValue({
      bankAccountId: 'ba_row_1',
      recordId: 'def_bank_account:ba_row_1',
      glAccountId: 'gl_1000',
    })

    const result = await resolvePayoutBankAccount(db, ORG, 'ba_confirmed', 'PAY-0001')

    expect(result.bankAccountRecordId).toBe('def_bank_account:ba_row_1')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// brief 26 §3 and §13 decision 2: a payout credits a clearing account, never a
// role, and refuses rather than guessing when two records claim the Stripe rail.
// ─────────────────────────────────────────────────────────────────────────────

describe('resolvePayoutGateway', () => {
  it('blocks nothing and names no id for an org with zero payment_gateway records', async () => {
    // 🔑 §12 test 1 at the resolver. This is the branch every org that has never
    // opened the settings page takes, and it must leave the builder falling back
    // to the roles - bit for bit what it did before this brief.
    const result = await resolvePayoutGateway(db, ORG, 'PAY-0001')

    expect(result).toMatchObject({ blockedReason: null, feeTreatment: 'netted' })
    expect(result.clearingGlAccountId).toBeUndefined()
    expect(result.feeGlAccountId).toBeUndefined()
  })

  it('names no id when records exist but none settles through Stripe', async () => {
    h.paymentGateways = [gateway({ id: 'pg_affirm', settlementSource: 'manual' })]

    const result = await resolvePayoutGateway(db, ORG, 'PAY-0001')

    expect(result).toMatchObject({ blockedReason: null, feeTreatment: 'netted' })
  })

  it('resolves the clearing account of the single Stripe rail', async () => {
    h.paymentGateways = [
      gateway({ id: 'pg_affirm', settlementSource: 'manual', clearingGlAccountId: 'gl_affirm' }),
      gateway(),
    ]

    const result = await resolvePayoutGateway(db, ORG, 'PAY-0001')

    expect(result).toMatchObject({
      blockedReason: null,
      clearingGlAccountId: 'gl_clearing_stripe',
      feeTreatment: 'netted',
    })
  })

  it("carries the rail's own fee account and fee treatment when it has them", async () => {
    h.paymentGateways = [gateway({ feeGlAccountId: 'gl_stripe_fees', feeTreatment: 'billed' })]

    const result = await resolvePayoutGateway(db, ORG, 'PAY-0001')

    expect(result).toMatchObject({
      blockedReason: null,
      clearingGlAccountId: 'gl_clearing_stripe',
      feeGlAccountId: 'gl_stripe_fees',
      feeTreatment: 'billed',
    })
  })

  it('resolves a CLOSED Stripe rail rather than ignoring it', async () => {
    // A closed rail is still a record claiming the Stripe stream, and its last
    // settlements are exactly the ones still arriving. Skipping it would send
    // them to the role while its shipments went to its own account.
    h.paymentGateways = [gateway({ status: 'closed' })]

    const result = await resolvePayoutGateway(db, ORG, 'PAY-0001')

    expect(result).toMatchObject({ clearingGlAccountId: 'gl_clearing_stripe' })
  })

  it('REFUSES when two records settle through Stripe, naming both and the remedy', async () => {
    // 🛑 §13 decision 2. Never a silent fall back to the role: a wrong clearing
    // account is invisible and permanent, a blocked payout is visible and
    // fixable.
    h.paymentGateways = [
      gateway({ id: 'pg_one', name: 'Stripe US' }),
      gateway({ id: 'pg_two', name: 'Stripe EU', clearingGlAccountId: 'gl_other' }),
    ]

    const result = await resolvePayoutGateway(db, ORG, 'PAY-0001')

    expect(result.blockedReason).toContain('PAY-0001')
    expect(result.blockedReason).toContain('Stripe US')
    expect(result.blockedReason).toContain('Stripe EU')
    expect(result.blockedReason).toMatch(/Payment gateways/)
    expect(result.clearingGlAccountId).toBeUndefined()
  })

  it('falls back to the role rather than posting to a blank clearing account', async () => {
    h.paymentGateways = [gateway({ clearingGlAccountId: '' })]

    const result = await resolvePayoutGateway(db, ORG, 'PAY-0001')

    expect(result).toMatchObject({ blockedReason: null, feeTreatment: 'netted' })
  })

  // ── brief 27 §6.1 / §6.4: the rail is the routing key AND half of the pair ──

  it('names the rail by id and record id when exactly one claims the Stripe stream', async () => {
    h.paymentGateways = [gateway({ id: 'pg_stripe', recordId: 'def_pg:pg_stripe' })]

    const result = await resolvePayoutGateway(db, ORG, 'PAY-0001')

    expect(result).toMatchObject({
      blockedReason: null,
      paymentGatewayId: 'pg_stripe',
      paymentGatewayRecordId: 'def_pg:pg_stripe',
    })
  })

  it('still names the rail when it has a blank clearing account - the pointer is provenance, not routing', async () => {
    h.paymentGateways = [gateway({ id: 'pg_stripe', clearingGlAccountId: '' })]

    const result = await resolvePayoutGateway(db, ORG, 'PAY-0001')

    expect(result.paymentGatewayId).toBe('pg_stripe')
    expect(result.clearingGlAccountId).toBeUndefined()
  })

  it('names NO rail on the role fallback, so the lookup falls back to the gateway id alone', async () => {
    const result = await resolvePayoutGateway(db, ORG, 'PAY-0001')

    expect(result.blockedReason).toBeNull()
    expect(result.paymentGatewayId).toBeUndefined()
    expect(result.paymentGatewayRecordId).toBeUndefined()
  })

  it('names NO rail on a refusal - two records is never a guess at one', async () => {
    h.paymentGateways = [gateway({ id: 'pg_one' }), gateway({ id: 'pg_two' })]

    const result = await resolvePayoutGateway(db, ORG, 'PAY-0001')

    expect(result.blockedReason).toBeTruthy()
    expect(result.paymentGatewayId).toBeUndefined()
  })

  it('answers the same from records the caller already holds, without a second read', async () => {
    const rail = gateway({ id: 'pg_stripe', feeGlAccountId: 'gl_fees' })

    const fromRows = resolvePayoutGatewayFrom([rail], 'PAY-0001')
    h.paymentGateways = [rail]
    const fromDb = await resolvePayoutGateway(db, ORG, 'PAY-0001')

    expect(fromRows).toEqual(fromDb)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// §12 test 2, closed through the real read model: the SAME `PaymentGatewayRow`
// feeds both sides. This is the brief in one assertion.
// ─────────────────────────────────────────────────────────────────────────────

describe('the debit and the credit meet', () => {
  it('routes a shipment and resolves a payout to one and the same glAccountId', async () => {
    // 🔑 One record, read once, driving both halves through the functions that
    // actually run in production: `toGatewayRoutes` -> `resolveFulfillmentDebit`
    // on the sale, `resolvePayoutGateway` on the settlement. Before brief 26
    // the payout side did not consult this record at all - it passed
    // `clearingRole: ACCOUNT_ROLES.CLEARING` and the two accounts drifted
    // apart in entries that both balanced.
    const rail = gateway({
      handles: ['authorize_net', 'authorize.net'],
      clearingGlAccountId: 'gl_authnet_clearing',
    })
    h.paymentGateways = [rail]

    const debit = resolveFulfillmentDebit({
      financialStatus: 'paid',
      gateways: ['Authorize_Net'],
      gatewayRoutes: toGatewayRoutes([rail]),
    })
    const credit = await resolvePayoutGateway(db, ORG, 'PAY-0001')

    expect(debit).toMatchObject({ kind: 'debit', glAccountId: 'gl_authnet_clearing' })
    expect(credit.clearingGlAccountId).toBe('gl_authnet_clearing')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// brief 28 §5: the unblocked arm says WHY, in words, so the sentence can be
// frozen onto the entry. A refusal always did; an answer used to say nothing.
// ─────────────────────────────────────────────────────────────────────────────

describe('the reasons', () => {
  it('names the confirmed destination on the bank account', async () => {
    h.findBankAccountByStripeExternalAccountId.mockResolvedValue({
      bankAccountId: 'ba_row_1',
      recordId: 'def_bank_account:ba_row_1',
      glAccountId: 'gl_1000',
    })

    const result = await resolvePayoutBankAccount(db, ORG, 'ba_confirmed', 'PAY-0001')

    expect(result.blockedReason).toBeNull()
    expect(result.reason).toBe(
      'Debited because Stripe reported destination ba_confirmed, which is confirmed on this bank account.'
    )
  })

  it('names the role fallback when no record claims the Stripe rail', async () => {
    const result = await resolvePayoutGateway(db, ORG, 'PAY-0001')

    expect(result.reason).toBe(
      'Credited by the card clearing role because no gateway record claims the Stripe rail.'
    )
  })

  it('names the record when one claims the Stripe rail', async () => {
    h.paymentGateways = [gateway({ name: 'Stripe US' })]

    const result = await resolvePayoutGateway(db, ORG, 'PAY-0001')

    expect(result.reason).toBe(
      'Credited because the Stripe US gateway record settles through Stripe and names this as its clearing account.'
    )
  })

  it('says the record named no clearing account when it falls back to the role', async () => {
    h.paymentGateways = [gateway({ name: 'Stripe US', clearingGlAccountId: '' })]

    const result = await resolvePayoutGateway(db, ORG, 'PAY-0001')

    expect(result.clearingGlAccountId).toBeUndefined()
    expect(result.reason).toBe(
      'Credited by the card clearing role because the Stripe US gateway record settles through Stripe but names no clearing account.'
    )
  })

  it('carries no reason on a refusal - blockedReason is the whole answer there', async () => {
    h.paymentGateways = [gateway({ id: 'pg_one' }), gateway({ id: 'pg_two' })]

    const result = await resolvePayoutGateway(db, ORG, 'PAY-0001')

    expect(result.blockedReason).toBeTruthy()
    expect(result.reason).toBeUndefined()
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

function ctxFor(rail: PaymentGatewayRow | null): PayoutSourceCtx {
  return {
    organizationId: ORG,
    sourceId: 'shopify_payments',
    rail,
    conflictingRails: [],
    handle: 'x',
  }
}

describe('connector evidence owns Shopify payout ingestion', () => {
  it('blocks a direct legacy sync before fetching or writing payouts', async () => {
    const source = recordingSource()
    registerPayoutSource(source)
    h.assertLegacyPayoutIngestionOwner.mockRejectedValue(
      new Error('Connector owns payout evidence')
    )

    const result = await syncPayoutSource(stubDb(), ctxFor(null), { now: NOW })

    expect(result.isErr()).toBe(true)
    expect(source.since).toEqual([])
    expect(h.gatherPayout).not.toHaveBeenCalled()
  })

  it('reports the selected owner to scheduled/manual org sync without running Shopify tools', async () => {
    const source = recordingSource()
    source.resolveContexts = async () => [ctxFor(null)]
    __resetPayoutSourcesForTests()
    registerPayoutSource(source)
    h.assertLegacyPayoutIngestionOwner.mockRejectedValue(
      new Error('Connector owns payout evidence')
    )

    const result = await syncPayouts(stubDb(), { organizationId: ORG, now: NOW })

    expect(result._unsafeUnwrap()).toEqual({
      ...EMPTY,
      failed: [
        {
          sourceId: 'shopify_payments',
          paymentGatewayId: null,
          reason: 'Connector owns payout evidence',
        },
      ],
    })
    expect(source.since).toEqual([])
  })

  it('rechecks ownership after provider reads before creating a legacy payout', async () => {
    const source = recordingSource()
    source.listPayouts = async () => [
      {
        providerPayoutId: 'payout-1',
        paidAt: '2026-09-14',
        currency: 'usd',
        status: 'paid',
        depositedMinor: 9700,
      },
    ]
    registerPayoutSource(source)
    h.assertLegacyPayoutIngestionOwner
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('Connector enabled during provider fetch'))

    const result = await syncPayoutSource(stubDb(), ctxFor(null), { now: NOW })

    expect(result.isErr()).toBe(true)
    expect(h.gatherPayout).toHaveBeenCalledTimes(1)
    expect(h.assertLegacyPayoutIngestionOwner).toHaveBeenCalledTimes(2)
  })
})

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
    const shopifyRail = gateway({ id: 'pg_shop', settlementSource: 'shopify_payments' })
    h.paymentGateways = [shopifyRail]
    const broken: PayoutSource = {
      id: 'stripe',
      kind: 'api',
      resolveContexts: async () => [{ ...ctxFor(null), sourceId: 'stripe' }],
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
      { sourceId: 'stripe', paymentGatewayId: null, reason: '401 from the provider' },
    ])
    expect(healthy.since).toHaveLength(1)
  })
})
