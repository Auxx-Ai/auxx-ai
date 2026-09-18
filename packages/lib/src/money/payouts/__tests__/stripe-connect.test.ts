// packages/lib/src/money/payouts/__tests__/stripe-connect.test.ts
//
// brief 27 §13 test 1, updated for task 58: Stripe behind the `PayoutSource`
// interface. One Stripe fixture - a payout and its balance transactions - runs
// through the registered source, the recogniser (stubbed to a fixed set, so
// this file tests the PIPELINE and `recognise.test.ts` tests the lookups), the
// split, the record write and the entry build, and lands on the two payloads
// that matter:
//
//  - the `payout` record's field values (`payoutValues`);
//  - the input `postPayoutEntry` receives - every leg a role line scoped to
//    the rail and currency (§5.3), never a resolved `gl_account` id.
//
// The second half pins the source module alone: how a balance transaction
// becomes a `PayoutItem` (which refs, which rows skipped), and that both walks
// page to exhaustion.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  payoutsList: vi.fn(async (_params: unknown, _opts: unknown) => ({
    data: [] as unknown[],
    has_more: false,
  })),
  balanceList: vi.fn(async (_params: unknown, _opts: unknown) => ({
    data: [] as unknown[],
    has_more: false,
  })),
  findPayoutByGatewayId: vi.fn(async (..._args: unknown[]) => null as unknown),
  listLinkedFeedAccounts: vi.fn(
    async () => [] as { id: string; externalAccountId: string; paymentGatewayId: string }[]
  ),
  create: vi.fn(async (_defId: string, _values: unknown) => ({ instance: { id: 'inst_1' } })),
  update: vi.fn(async (_recordId: string, _values: unknown) => undefined),
  postPayoutEntry: vi.fn(async (_db: unknown, _input: unknown) => ({
    status: 'posted' as const,
    glPostingId: 'glp_1',
  })),
  resolveRoles: vi.fn(
    async () =>
      ({ isErr: () => false, isOk: () => true, value: new Map() }) as {
        isErr: () => boolean
        isOk: () => boolean
        value?: Map<string, unknown>
        error?: Error
      }
  ),
  stamp: vi.fn(async (_db: unknown, _input: unknown) => ({ isErr: () => false })),
  recognise: vi.fn(async () => new Set<string>()),
  gateways: [] as unknown[],
  readDestinations: vi.fn(async (..._args: unknown[]) => [] as string[]),
  listPostingsForSource: vi.fn(async (..._args: unknown[]) => ({
    isErr: () => false,
    isOk: () => true,
    value: [] as { id: string; status: string }[],
  })),
}))

vi.mock('@auxx/database', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  withAccountingCommitLock: async () => {},
}))
vi.mock('../../../resources/crud/tx-write-flush', () => ({ flushTxWriteScope: async () => {} }))
vi.mock('../../../accounting/ledger/setup/accounting-enabled', () => ({
  isAccountingEnabled: async () => true,
}))
vi.mock('../reads', () => ({
  requirePayoutFieldContext: async () => ({
    payoutDefId: 'def_payout',
    fields: { payout_payment_gateway: { id: 'f_pg' } },
  }),
  findPayoutByGatewayId: h.findPayoutByGatewayId,
  listLinkedFeedAccounts: h.listLinkedFeedAccounts,
  readBankAccountSettlementDestinations: h.readDestinations,
}))
vi.mock('../../stripe-connect/account', () => ({
  getPaymentAccount: async () => ({ stripeAccountId: 'acct_1' }),
}))
vi.mock('../../stripe-connect/client', () => ({
  getStripeConnectClient: () => ({
    payouts: { list: h.payoutsList },
    balanceTransactions: { list: h.balanceList },
  }),
}))
vi.mock('../../../accounting/rails/reads', () => ({
  listPaymentGateways: async () => ({ isErr: () => false, isOk: () => true, value: h.gateways }),
}))
vi.mock('../../../accounting/rails/writes', () => ({
  stampPaymentGatewayLastSettlement: h.stamp,
}))
vi.mock('../../../accounting/ledger/post/post-payout-entry', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  postPayoutEntry: h.postPayoutEntry,
}))
vi.mock('../../../accounting/ledger/roles/resolve-roles', () => ({ resolveRoles: h.resolveRoles }))
vi.mock('../../../accounting/ledger/reads/list-postings', () => ({
  listPostingsForSource: h.listPostingsForSource,
}))
// This file is about Stripe alone; keep the shopify_payments source (registered
// alongside it by `registerPayoutSources`) a no-op rather than hitting the real DB.
vi.mock('../../../apps/invoke-app-tool', () => ({
  resolveAppToolContext: async () => ({ connected: false }),
}))
vi.mock('../../../resources/crud/unified-handler', () => ({
  UnifiedCrudHandler: class {
    withDatabase() {
      return this
    }
    create = h.create
    update = h.update
  },
}))
vi.mock('../../../users/system-user-service', () => ({
  SystemUserService: { getSystemUserForActions: async () => 'user_system' },
}))
vi.mock('../recognise', () => ({ recognise: h.recognise }))

import type { Database } from '@auxx/database'
import type { PaymentGatewayRow } from '../../../accounting/rails/client'
import type { PayoutSourceCtx } from '../source'
import { __resetPayoutSourcesForTests } from '../source-registry'
import { registerPayoutSources } from '../sources'
import { STRIPE_CONNECT_PAYOUT_SOURCE } from '../sources/stripe-connect'
import { syncPayouts } from '../sync'

const ORG = 'org_1'
const NOW = new Date('2026-09-14T12:00:00.000Z')

/** A `Database` whose one select (the first-sync floor) answers "no records yet". */
function stubDb(rows: unknown[] = []): Database {
  const chain: Record<string, unknown> = {}
  for (const method of ['from', '$dynamic', 'leftJoin', 'innerJoin', 'where', 'orderBy']) {
    chain[method] = () => chain
  }
  chain.limit = () => Promise.resolve(rows)
  const db = {
    select: () => chain,
    transaction: async <T>(run: (tx: unknown) => Promise<T>) => run(db),
  }
  return db as unknown as Database
}

const RAIL: PaymentGatewayRow = {
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
}

// ── The fixture ──────────────────────────────────────────────────────────────
// 2026-09-14T00:00:00Z. The deposit is what the recognised net plus the
// unrecognised net come to, so the builder would accept it.
const ARRIVAL = 1789344000

const PAYOUT = {
  id: 'po_1',
  object: 'payout',
  amount: 142_300,
  currency: 'usd',
  arrival_date: ARRIVAL,
  status: 'paid',
  destination: 'ba_1',
}

const BALANCE_TRANSACTIONS = [
  // Recognised charge.
  { id: 'txn_a', type: 'charge', source: 'ch_a', amount: 100_000, fee: 3_200 },
  // A charge auxx has no PaymentTransaction for: unrecognised, NET.
  { id: 'txn_b', type: 'charge', source: 'ch_b', amount: 60_000, fee: 2_000 },
  // A refund of a known charge: recognised through the refund column, negative.
  { id: 'txn_r', type: 'refund', source: 're_x', amount: -10_000, fee: 0 },
  // The payout itself, listed among its own transactions: skipped, never counted.
  { id: 'txn_po', type: 'payout', source: 'po_1', amount: -142_300, fee: 0 },
  // A Stripe fee with no charge: `none`, unrecognised.
  { id: 'txn_fee', type: 'stripe_fee', source: null, amount: -2_500, fee: 0 },
]

/** The feed a person has linked to {@link RAIL} (task 58 §5.5). */
const LINKED_FEED = { id: 'fsa_1', externalAccountId: 'acct_1', paymentGatewayId: RAIL.id }

/** What `payoutValues(gathered, ctx)` writes for this fixture. */
const EXPECTED_PAYOUT_VALUES = {
  payout_gateway_id: 'po_1',
  payout_payment_gateway: 'payment_gateway:pg_stripe',
  payout_source: 'synced',
  payout_status: 'paid',
  payout_paid_at: '2026-09-14',
  payout_destination: 'ba_1',
  payout_currency: 'usd',
  payout_deposited: 142_300,
  payout_gross: 90_000,
  payout_fees: 3_200,
  payout_net: 86_800,
  payout_unrecognised_net: 55_500,
  payout_unrecognised_count: 2,
}

/** What `ingestOne` hands `postPayoutEntry` for this fixture (task 58 §5.3). */
const EXPECTED_ENTRY_INPUT = {
  organizationId: ORG,
  actorUserId: 'user_system',
  payoutId: 'po_1',
  payoutNumber: 'PAY-0001',
  rail: 'pg_stripe',
  currency: 'USD',
  grossMinor: 90_000,
  feesMinor: 3_200,
  netMinor: 86_800,
  unrecognisedNetMinor: 55_500,
  feeTreatment: 'netted',
  paidAt: '2026-09-14',
  memo: 'Payout PAY-0001',
}

beforeEach(() => {
  vi.clearAllMocks()
  __resetPayoutSourcesForTests()
  registerPayoutSources()
  h.gateways = [RAIL]
  h.listLinkedFeedAccounts.mockResolvedValue([LINKED_FEED])
  h.resolveRoles.mockResolvedValue({ isErr: () => false, isOk: () => true, value: new Map() })
  h.recognise.mockResolvedValue(new Set(['ch_a', 're_x']))
  h.payoutsList.mockResolvedValue({ data: [PAYOUT], has_more: false })
  h.balanceList.mockResolvedValue({ data: BALANCE_TRANSACTIONS, has_more: false })
  h.create.mockResolvedValue({ instance: { id: 'inst_1' } })
  h.postPayoutEntry.mockResolvedValue({ status: 'posted', glPostingId: 'glp_1' })
  h.stamp.mockResolvedValue({ isErr: () => false })
  h.readDestinations.mockResolvedValue([])
  h.listPostingsForSource.mockResolvedValue({ isErr: () => false, isOk: () => true, value: [] })
  h.findPayoutByGatewayId
    .mockResolvedValueOnce(null)
    .mockResolvedValueOnce({ payoutId: 'inst_1', number: 'PAY-0001', glPostingId: null })
})

describe('Stripe behind the interface is bit-for-bit (§13 test 1)', () => {
  it('writes the same payout record the pre-unit-2 pipeline wrote', async () => {
    const result = await syncPayouts(stubDb(), { organizationId: ORG, now: NOW })

    expect(result._unsafeUnwrap()).toMatchObject({ seen: 1, created: 1, posted: 1, refused: [] })
    expect(h.create).toHaveBeenCalledTimes(1)
    expect(h.create).toHaveBeenCalledWith('def_payout', EXPECTED_PAYOUT_VALUES)
  })

  it('hands postPayoutEntry the input task 58 §5.3 describes - every leg a role line, scoped', async () => {
    await syncPayouts(stubDb(), { organizationId: ORG, now: NOW })

    expect(h.postPayoutEntry).toHaveBeenCalledTimes(1)
    const [, input] = h.postPayoutEntry.mock.calls[0] as [unknown, Record<string, unknown>]
    expect(input).toEqual(EXPECTED_ENTRY_INPUT)
  })

  it('checks the bank role is mapped for this rail and currency before building, and stamps the posting and the watermark', async () => {
    await syncPayouts(stubDb(), { organizationId: ORG, now: NOW })

    expect(h.resolveRoles).toHaveBeenCalledWith(expect.anything(), ORG, ['bank'], {
      rail: 'pg_stripe',
      currency: 'USD',
    })
    expect(h.update).toHaveBeenCalledWith('def_payout:inst_1', {
      payout_status: 'paid',
      payout_blocked_reason: null,
      // 58 §5.4 rule 2: the fixture's `resolveRoles` answers an EMPTY map, so
      // there is no resolved `bank` glAccountId to check the destination against.
      payout_destination_mismatch: null,
    })
    expect(h.readDestinations).not.toHaveBeenCalled()
    expect(h.stamp).toHaveBeenCalledWith(expect.anything(), {
      organizationId: ORG,
      actorUserId: 'user_system',
      paymentGatewayId: 'pg_stripe',
      settledAt: '2026-09-14',
    })
  })

  it('writes payout_destination_mismatch when the mapped bank account does not confirm the reported destination (58 §5.4 rule 2, D7)', async () => {
    // `PAYOUT.destination` ('ba_1') flows through as `gathered.destination`.
    h.resolveRoles.mockResolvedValue({
      isErr: () => false,
      isOk: () => true,
      value: new Map([['bank', { glAccountId: 'gl_bank_1' }]]),
    })
    h.readDestinations.mockResolvedValue(['ba_other'])

    await syncPayouts(stubDb(), { organizationId: ORG, now: NOW })

    expect(h.readDestinations).toHaveBeenCalledWith(expect.anything(), ORG, 'gl_bank_1')
    expect(h.update).toHaveBeenCalledWith('def_payout:inst_1', {
      payout_status: 'paid',
      payout_blocked_reason: null,
      payout_destination_mismatch: expect.stringContaining('PAY-0001'),
    })
    // The entry still posted - a mismatch is a flag, never a block.
    expect(h.postPayoutEntry).toHaveBeenCalledTimes(1)
  })

  it('writes no mismatch when the mapped bank account confirms the reported destination', async () => {
    h.resolveRoles.mockResolvedValue({
      isErr: () => false,
      isOk: () => true,
      value: new Map([['bank', { glAccountId: 'gl_bank_1' }]]),
    })
    h.readDestinations.mockResolvedValue(['ba_1'])

    await syncPayouts(stubDb(), { organizationId: ORG, now: NOW })

    expect(h.update).toHaveBeenCalledWith(
      'def_payout:inst_1',
      expect.objectContaining({ payout_destination_mismatch: null })
    )
  })

  it('reads the payouts on the connected account, from the first-run floor, exactly as before', async () => {
    // No payout record exists yet and the rail has no watermark, so the first
    // run reads from `now` - nothing older than itself.
    await syncPayouts(stubDb(), { organizationId: ORG, now: NOW })

    expect(h.payoutsList).toHaveBeenCalledWith(
      { limit: 100, arrival_date: { gte: Math.floor(NOW.getTime() / 1000) } },
      { stripeAccount: 'acct_1' }
    )
    expect(h.balanceList).toHaveBeenCalledWith(
      { payout: 'po_1', limit: 100 },
      { stripeAccount: 'acct_1' }
    )
  })

  it('runs nothing when nothing has linked a feed to a rail (task 58 §5.5)', async () => {
    // A payout with no rail cannot exist - it was read by a source that is
    // linked to one. Nothing linked means no context, no record, no entry.
    h.listLinkedFeedAccounts.mockResolvedValue([])

    const result = await syncPayouts(stubDb(), { organizationId: ORG, now: NOW })

    expect(result._unsafeUnwrap()).toMatchObject({ seen: 0, created: 0, posted: 0 })
    expect(h.create).not.toHaveBeenCalled()
    expect(h.postPayoutEntry).not.toHaveBeenCalled()
  })

  it('blocks before building when the rail has no bank row mapped for this currency (task 58 §5.4 rule 1)', async () => {
    h.resolveRoles.mockResolvedValue({
      isErr: () => true,
      isOk: () => false,
      error: new Error('unmapped'),
    })

    const result = await syncPayouts(stubDb(), { organizationId: ORG, now: NOW })

    expect(h.create).toHaveBeenCalledTimes(1)
    expect(h.postPayoutEntry).not.toHaveBeenCalled()
    expect(h.update).toHaveBeenCalledWith('def_payout:inst_1', {
      payout_blocked_reason:
        'Payout PAY-0001 has no receiving bank account mapped for Stripe in USD. Map it on ' +
        'Accounting > Settings > Payment gateways.',
    })
    expect(result._unsafeUnwrap().refused).toHaveLength(1)
    expect(h.stamp).not.toHaveBeenCalled()
  })

  it('stops at the live-posting lookup when the payout already carries a posting', async () => {
    h.findPayoutByGatewayId.mockReset()
    h.findPayoutByGatewayId.mockResolvedValue({ payoutId: 'inst_1', number: 'PAY-0001' })
    h.listPostingsForSource.mockResolvedValue({
      isErr: () => false,
      isOk: () => true,
      value: [{ id: 'glp_old', status: 'posted' }],
    })

    const result = await syncPayouts(stubDb(), { organizationId: ORG, now: NOW })

    expect(result._unsafeUnwrap()).toMatchObject({ seen: 1, alreadyPosted: 1, created: 0 })
    expect(h.balanceList).not.toHaveBeenCalled()
    expect(h.create).not.toHaveBeenCalled()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// The source module alone.
// ─────────────────────────────────────────────────────────────────────────────

const ctx: PayoutSourceCtx = {
  organizationId: ORG,
  sourceId: 'stripe',
  rail: RAIL,
  handle: 'acct_1',
}

describe('STRIPE_CONNECT_PAYOUT_SOURCE.listItems', () => {
  it('maps balance transactions to items: charge and refund refs, none for a fee, the payout row skipped', async () => {
    const header = (await STRIPE_CONNECT_PAYOUT_SOURCE.listPayouts(ctx, NOW))[0]!
    const items = await STRIPE_CONNECT_PAYOUT_SOURCE.listItems!(ctx, header)

    expect(items).toEqual([
      {
        externalId: 'txn_a',
        grossMinor: 100_000,
        feeMinor: 3_200,
        ref: { kind: 'stripe_charge', id: 'ch_a' },
      },
      {
        externalId: 'txn_b',
        grossMinor: 60_000,
        feeMinor: 2_000,
        ref: { kind: 'stripe_charge', id: 'ch_b' },
      },
      {
        externalId: 'txn_r',
        grossMinor: -10_000,
        feeMinor: 0,
        ref: { kind: 'stripe_charge', id: 're_x' },
      },
      { externalId: 'txn_fee', grossMinor: -2_500, feeMinor: 0, ref: { kind: 'none' } },
    ])
  })

  it('pages to exhaustion rather than trusting one call', async () => {
    h.balanceList
      .mockResolvedValueOnce({ data: [BALANCE_TRANSACTIONS[0]], has_more: true })
      .mockResolvedValueOnce({ data: [BALANCE_TRANSACTIONS[1]], has_more: false })

    const header = (await STRIPE_CONNECT_PAYOUT_SOURCE.listPayouts(ctx, NOW))[0]!
    const items = await STRIPE_CONNECT_PAYOUT_SOURCE.listItems!(ctx, header)

    expect(items.map((item) => item.externalId)).toEqual(['txn_a', 'txn_b'])
    expect(h.balanceList).toHaveBeenLastCalledWith(
      { payout: 'po_1', limit: 100, starting_after: 'txn_a' },
      { stripeAccount: 'acct_1' }
    )
  })
})

describe('STRIPE_CONNECT_PAYOUT_SOURCE.listPayouts', () => {
  it('transcribes the header and returns OLDEST first', async () => {
    h.payoutsList.mockResolvedValue({
      data: [
        { ...PAYOUT, id: 'po_new', arrival_date: ARRIVAL + 86_400, status: 'pending' },
        { ...PAYOUT, id: 'po_old', destination: { id: 'ba_obj' } },
      ],
      has_more: false,
    })

    const headers = await STRIPE_CONNECT_PAYOUT_SOURCE.listPayouts(ctx, NOW)

    expect(headers).toEqual([
      {
        providerPayoutId: 'po_old',
        paidAt: '2026-09-14',
        currency: 'usd',
        status: 'paid',
        depositedMinor: 142_300,
        destinationHint: 'ba_obj',
      },
      {
        providerPayoutId: 'po_new',
        paidAt: '2026-09-15',
        currency: 'usd',
        status: 'in_transit',
        depositedMinor: 142_300,
        destinationHint: 'ba_1',
      },
    ])
  })

  it('refuses a context whose handle is not a connected-account id', async () => {
    await expect(
      STRIPE_CONNECT_PAYOUT_SOURCE.listPayouts({ ...ctx, handle: 42 }, NOW)
    ).rejects.toThrow(/connected-account id/)
  })
})
