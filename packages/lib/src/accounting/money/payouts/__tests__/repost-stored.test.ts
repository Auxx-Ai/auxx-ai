// packages/lib/src/accounting/money/payouts/__tests__/repost-stored.test.ts
//
// §13 Q6: a payout reversed by a match change is booked again from its stored record and
// evidence rows, through the sync's own `ingestOne`, however old it is.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  findPayoutByGatewayId: vi.fn(async (..._args: unknown[]) => null as unknown),
  listPayoutMemberEntryIds: vi.fn(async (..._args: unknown[]) => [] as string[]),
  countPayoutEntryAttempts: vi.fn(async (..._args: unknown[]) => 0),
  syncStoredMatches: vi.fn(async (..._args: unknown[]) => new Map()),
  create: vi.fn(async (_defId: string, _values: unknown) => ({ instance: { id: 'inst_new' } })),
  update: vi.fn(async (_recordId: string, _values: unknown) => undefined),
  postPayoutEntry: vi.fn(async (_db: unknown, _input: unknown) => ({
    status: 'posted' as string,
    error: undefined as string | undefined,
  })),
  listPostingsForSource: vi.fn(async (..._args: unknown[]) => ({
    isErr: () => false,
    isOk: () => true,
    value: [] as { id: string; status: string }[],
  })),
  upsertWorkItem: vi.fn(async (..._args: unknown[]) => undefined),
  deleteWorkItem: vi.fn(async (..._args: unknown[]) => undefined),
  isPayoutHeldReversed: vi.fn(async (..._args: unknown[]) => false),
}))

vi.mock('@auxx/database', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  withAccountingCommitLock: async () => {},
}))
vi.mock('../../../../resources/crud/tx-write-flush', () => ({ flushTxWriteScope: async () => {} }))
vi.mock('../../../ledger/setup/accounting-enabled', () => ({
  isAccountingActive: async () => true,
  isAccountingEnabled: async () => true,
}))
vi.mock('../fields', () => ({
  requirePayoutFieldContext: async () => ({
    defId: 'def_payout',
    fields: { payout_payment_gateway: { id: 'f_pg' } },
  }),
}))
vi.mock('../reads', () => ({
  countPayoutEntryAttempts: h.countPayoutEntryAttempts,
  findPayoutByGatewayId: h.findPayoutByGatewayId,
  listPayoutFeedAccountIds: async () => ['fsa_1'],
  listPayoutMemberEntryIds: h.listPayoutMemberEntryIds,
  readBankAccountSettlementDestinations: async () => [],
}))
vi.mock('../repost-reads', () => ({ isPayoutHeldReversed: h.isPayoutHeldReversed }))
vi.mock('../match-sync', () => ({ syncStoredMatches: h.syncStoredMatches }))
vi.mock('../../../work-items/write', () => ({
  upsertWorkItem: h.upsertWorkItem,
  deleteWorkItem: h.deleteWorkItem,
}))
vi.mock('../../../rails/writes', () => ({
  stampPaymentGatewayLastSettlement: async () => ({ isErr: () => false }),
}))
vi.mock('../../../ledger/post/post-payout-entry', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  postPayoutEntry: h.postPayoutEntry,
}))
vi.mock('../../../ledger/roles/resolve-roles', () => ({
  resolveRoles: async () => ({ isErr: () => false, isOk: () => true, value: new Map() }),
}))
vi.mock('../../../ledger/reads/list-postings', () => ({
  listPostingsForSource: h.listPostingsForSource,
}))
vi.mock('../../../../resources/crud/unified-handler', () => ({
  UnifiedCrudHandler: class {
    withDatabase() {
      return this
    }
    create = h.create
    update = h.update
  },
}))
vi.mock('../../../../users/system-user-service', () => ({
  SystemUserService: { getSystemUserForActions: async () => 'user_system' },
}))

import type { Database } from '@auxx/database'
import type { PaymentGatewayRow } from '../../../rails/client'
import type { PayoutSource, PayoutSourceCtx } from '../source'
import { __resetPayoutSourcesForTests, registerPayoutSource } from '../source-registry'
import { repostStoredPayout, syncPayoutSource } from '../sync'

const ORG = 'org_1'
/** The only select is the sync's first-record floor, answered "a record from a year ago". */
const floorChain: Record<string, unknown> = {}
for (const method of ['from', '$dynamic', 'leftJoin', 'innerJoin', 'where', 'orderBy'])
  floorChain[method] = () => floorChain
floorChain.limit = async () => [{ createdAt: new Date('2025-09-01T00:00:00Z') }]
const db = {
  select: () => floorChain,
  transaction: async <T>(run: (tx: unknown) => Promise<T>) => run(db),
} as unknown as Database

const RAIL = {
  id: 'pg_shop',
  recordId: 'payment_gateway:pg_shop',
  name: 'Shopify Payments',
  feeTreatment: 'netted',
  lastSettlementAt: null,
} as unknown as PaymentGatewayRow

const CTX: PayoutSourceCtx = {
  organizationId: ORG,
  sourceId: 'shopify_payments',
  rail: RAIL,
  handle: null,
}

/** Paid long before the sync's 30-day lookback. */
const RECORD = {
  payoutId: 'inst_7',
  number: 'PAY-0007',
  status: 'paid',
  paidAt: '2025-11-03',
  currency: 'usd',
  depositedMinor: 9_700,
  destination: null,
}

/** The split the stored match now adds up to: the late-matched item is recognised. */
const NEW_SPLIT = {
  grossMinor: 10_000,
  feesMinor: 300,
  netMinor: 9_700,
  unrecognisedNetMinor: 0,
  unrecognisedCount: 0,
}

const repost = () => repostStoredPayout(db, { ctx: CTX, providerPayoutId: 'po_7' })

beforeEach(() => {
  vi.clearAllMocks()
  h.findPayoutByGatewayId.mockResolvedValue(RECORD)
  h.listPayoutMemberEntryIds.mockResolvedValue(['pbe_1', 'pbe_2'])
  h.countPayoutEntryAttempts.mockResolvedValue(1)
  h.syncStoredMatches.mockResolvedValue(
    new Map([['fsa_1', { split: NEW_SPLIT, entryCount: 2, stalePostingIds: [] }]])
  )
  h.listPostingsForSource.mockResolvedValue({ isErr: () => false, isOk: () => true, value: [] })
  h.postPayoutEntry.mockResolvedValue({ status: 'posted', error: undefined })
  h.isPayoutHeldReversed.mockResolvedValue(false)
})

describe('repostStoredPayout', () => {
  it('re-posts an old reversed payout off the new stored split, on its next document number', async () => {
    const result = await repost()

    expect(result._unsafeUnwrap()).toEqual({ status: 'posted' })
    expect(h.postPayoutEntry).toHaveBeenCalledTimes(1)
    expect(h.postPayoutEntry).toHaveBeenCalledWith(
      db,
      expect.objectContaining({
        payoutId: 'po_7',
        payoutInstanceId: 'inst_7',
        memberEntryIds: ['pbe_1', 'pbe_2'],
        payoutNumber: 'PAY-0007-R2',
        rail: 'pg_shop',
        currency: 'USD',
        grossMinor: 10_000,
        feesMinor: 300,
        netMinor: 9_700,
        unrecognisedNetMinor: 0,
        paidAt: '2025-11-03',
      })
    )
    // The record is refreshed with the new split and its own transcribed header, not a new one.
    expect(h.create).not.toHaveBeenCalled()
    expect(h.update).toHaveBeenCalledWith(
      'def_payout:inst_7',
      expect.objectContaining({ payout_deposited: 9_700, payout_unrecognised_net: 0 })
    )
    expect(h.deleteWorkItem).toHaveBeenCalledWith(db, ORG, {
      sourceKind: 'payout',
      sourceId: 'inst_7',
      stage: 'post',
    })
  })

  it('leaves a payout with a live posting untouched', async () => {
    h.listPostingsForSource.mockResolvedValue({
      isErr: () => false,
      isOk: () => true,
      value: [{ id: 'glp_live', status: 'posted' }],
    })

    const result = await repost()

    expect(result._unsafeUnwrap()).toEqual({ status: 'live' })
    expect(h.postPayoutEntry).not.toHaveBeenCalled()
    expect(h.update).not.toHaveBeenCalled()
  })

  it('parks a work item when the ledger refuses, and posts nothing', async () => {
    h.postPayoutEntry.mockResolvedValue({
      status: 'unbalanced',
      error: 'The entry does not balance',
    })

    const result = await repost()

    expect(result._unsafeUnwrap()).toEqual({
      status: 'refused',
      reason: 'The entry does not balance',
    })
    expect(h.upsertWorkItem).toHaveBeenCalledWith(
      db,
      ORG,
      expect.objectContaining({
        sourceKind: 'payout',
        sourceId: 'inst_7',
        stage: 'post',
        reasonCode: 'UNBALANCED',
      })
    )
    expect(h.deleteWorkItem).not.toHaveBeenCalled()
  })

  it('does not post twice: the second run finds the entry the first one booked', async () => {
    await repost()
    h.listPostingsForSource.mockResolvedValue({
      isErr: () => false,
      isOk: () => true,
      value: [{ id: 'glp_new', status: 'posted' }],
    })

    const second = await repost()

    expect(second._unsafeUnwrap()).toEqual({ status: 'live' })
    expect(h.postPayoutEntry).toHaveBeenCalledTimes(1)
  })

  it('leaves a payout the provider failed reversed', async () => {
    h.findPayoutByGatewayId.mockResolvedValue({ ...RECORD, status: 'reversed' })

    const result = await repost()

    expect(result._unsafeUnwrap()).toMatchObject({ status: 'skipped' })
    expect(h.postPayoutEntry).not.toHaveBeenCalled()
  })

  it('parks a work item rather than guessing when the feed no longer holds the items', async () => {
    h.listPayoutMemberEntryIds.mockResolvedValue([])

    const result = await repost()

    expect(result._unsafeUnwrap()).toMatchObject({ status: 'refused' })
    expect(h.upsertWorkItem).toHaveBeenCalledWith(
      db,
      ORG,
      expect.objectContaining({ sourceId: 'inst_7', reasonCode: 'REFUSED' })
    )
    expect(h.postPayoutEntry).not.toHaveBeenCalled()
  })

  it('leaves an old payout a person reversed alone', async () => {
    h.isPayoutHeldReversed.mockResolvedValue(true)

    const result = await repost()

    expect(result._unsafeUnwrap()).toMatchObject({ status: 'skipped' })
    expect(h.isPayoutHeldReversed).toHaveBeenCalledWith(db, ORG, 'PAY-0007')
    expect(h.postPayoutEntry).not.toHaveBeenCalled()
    expect(h.update).not.toHaveBeenCalled()
  })
})

describe('the 30-day sync honours the same rule', () => {
  const NOW = new Date('2026-09-14T12:00:00.000Z')
  const recent = { ...RECORD, paidAt: '2026-09-10' }
  const source: PayoutSource = {
    id: 'shopify_payments',
    kind: 'api',
    listPayouts: async () => [
      {
        providerPayoutId: 'po_7',
        paidAt: '2026-09-10',
        currency: 'usd',
        status: 'paid',
        depositedMinor: 9_700,
      },
    ],
  }

  beforeEach(() => {
    __resetPayoutSourcesForTests()
    registerPayoutSource(source)
    h.findPayoutByGatewayId.mockResolvedValue(recent)
  })

  it('does not re-post a recent payout a person reversed', async () => {
    h.isPayoutHeldReversed.mockResolvedValue(true)

    const result = await syncPayoutSource(db, CTX, { now: NOW })

    expect(result._unsafeUnwrap()).toMatchObject({ seen: 1, posted: 0, refused: [] })
    expect(h.postPayoutEntry).not.toHaveBeenCalled()
  })

  it('still re-posts a recent payout the matcher reversed', async () => {
    const result = await syncPayoutSource(db, CTX, { now: NOW })

    expect(result._unsafeUnwrap()).toMatchObject({ seen: 1, posted: 1 })
    expect(h.postPayoutEntry).toHaveBeenCalledWith(
      db,
      expect.objectContaining({ payoutNumber: 'PAY-0007-R2', unrecognisedNetMinor: 0 })
    )
  })
})
