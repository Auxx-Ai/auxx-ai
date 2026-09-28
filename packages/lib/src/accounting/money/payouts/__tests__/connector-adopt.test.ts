// packages/lib/src/accounting/money/payouts/__tests__/connector-adopt.test.ts
//
// Brief 114 P1: one payout, one record. The sync adopts the connector's evidence record for the
// same provider payout, waits when the feed's connector raises records but has not reached this
// one, and creates its own record only on a feed no connector writes.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  findPayoutByGatewayId: vi.fn(async (..._args: unknown[]) => null as unknown),
  findConnectorPayout: vi.fn(async (..._args: unknown[]) => null as unknown),
  hasConnectorPayouts: vi.fn(async (..._args: unknown[]) => false),
  listLinkedFeedAccounts: vi.fn(
    async (..._args: unknown[]) =>
      [] as { id: string; externalAccountId: string; paymentGatewayId: string }[]
  ),
  create: vi.fn(async (_defId: string, _values: unknown) => ({ instance: { id: 'inst_new' } })),
  update: vi.fn(async (_recordId: string, _values: unknown) => undefined),
  postPayoutEntry: vi.fn(async (_db: unknown, _input: unknown) => ({
    status: 'posted' as string,
    error: undefined as string | undefined,
  })),
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
  countPayoutEntryAttempts: async () => 0,
  findConnectorPayout: h.findConnectorPayout,
  findPayoutByGatewayId: h.findPayoutByGatewayId,
  hasConnectorPayouts: h.hasConnectorPayouts,
  listLinkedFeedAccounts: h.listLinkedFeedAccounts,
  listPayoutFeedAccountIds: async () => ['fsa_1'],
  listPayoutMemberEntryIds: async () => [],
  readBankAccountSettlementDestinations: async () => [],
}))
vi.mock('../gather', () => ({
  gatherPayout: async () => ({
    payoutId: 'po_9',
    paidAt: '2026-09-10',
    currency: 'usd',
    depositedMinor: 9_700,
    gatewayStatus: 'paid',
    destination: null,
    source: 'synced',
    split: {
      grossMinor: 10_000,
      feesMinor: 300,
      netMinor: 9_700,
      unrecognisedNetMinor: 0,
      unrecognisedCount: 0,
    },
  }),
}))
vi.mock('../repost-reads', () => ({ isPayoutHeldReversed: async () => false }))
vi.mock('../../../work-items/write', () => ({
  upsertWorkItem: async () => undefined,
  deleteWorkItem: async () => undefined,
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
  listPostingsForSource: async () => ({ isErr: () => false, isOk: () => true, value: [] }),
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
import type { SQL } from 'drizzle-orm'
import { PgDialect } from 'drizzle-orm/pg-core'
import type { PaymentGatewayRow } from '../../../rails/client'
import type { PayoutSource, PayoutSourceCtx } from '../source'
import { __resetPayoutSourcesForTests, registerPayoutSource } from '../source-registry'
import { syncPayoutSource } from '../sync'

const ORG = 'org_1'
const NOW = new Date('2026-09-14T12:00:00.000Z')

/** The only select is the first-record floor, answered "a record from a year ago". */
const floorCalls: Array<{ method: string; args: unknown[] }> = []
const floorChain: Record<string, unknown> = {}
for (const method of ['from', '$dynamic', 'leftJoin', 'innerJoin', 'where', 'orderBy'])
  floorChain[method] = (...args: unknown[]) => {
    floorCalls.push({ method, args })
    return floorChain
  }
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

const SOURCE: PayoutSource = {
  id: 'shopify_payments',
  kind: 'api',
  listPayouts: async () => [
    {
      providerPayoutId: 'po_9',
      paidAt: '2026-09-10',
      currency: 'usd',
      status: 'paid',
      depositedMinor: 9_700,
    },
  ],
}

/** The connector's record: evidence only, no ledger fields yet. */
const CONNECTOR_RECORD = { payoutId: 'inst_conn', number: 'PAY-0310', status: 'in_transit' }

const sync = () => syncPayoutSource(db, CTX, { now: NOW })

beforeEach(() => {
  vi.clearAllMocks()
  floorCalls.length = 0
  __resetPayoutSourcesForTests()
  registerPayoutSource(SOURCE)
  h.findPayoutByGatewayId.mockReset().mockResolvedValue(null)
  h.findConnectorPayout.mockResolvedValue(null)
  h.hasConnectorPayouts.mockResolvedValue(false)
  h.listLinkedFeedAccounts.mockResolvedValue([
    { id: 'fsa_1', externalAccountId: 'shop_1', paymentGatewayId: 'pg_shop' },
    { id: 'fsa_2', externalAccountId: 'shop_other', paymentGatewayId: 'pg_other' },
  ])
  h.postPayoutEntry.mockResolvedValue({ status: 'posted', error: undefined })
})

describe('adopting the connector record', () => {
  beforeEach(() => {
    h.findConnectorPayout.mockResolvedValue(CONNECTOR_RECORD)
    // After the write the record carries `payout_gateway_id`, so the pair lookup finds it.
    h.findPayoutByGatewayId.mockResolvedValueOnce(null).mockResolvedValueOnce(CONNECTOR_RECORD)
  })

  it('writes the ledger fields onto the connector record, creates nothing, and posts it', async () => {
    const result = await sync()

    expect(result._unsafeUnwrap()).toMatchObject({ seen: 1, created: 0, posted: 1, deferred: [] })
    expect(h.create).not.toHaveBeenCalled()
    expect(h.update).toHaveBeenCalledWith(
      'def_payout:inst_conn',
      expect.objectContaining({
        payout_gateway_id: 'po_9',
        payout_payment_gateway: 'payment_gateway:pg_shop',
        payout_status: 'paid',
        payout_paid_at: '2026-09-10',
      })
    )
    expect(h.postPayoutEntry).toHaveBeenCalledTimes(1)
    expect(h.postPayoutEntry).toHaveBeenCalledWith(
      db,
      expect.objectContaining({ payoutInstanceId: 'inst_conn', payoutNumber: 'PAY-0310' })
    )
  })

  it('looks the record up by provider key and this rail’s feed accounts only', async () => {
    await sync()

    expect(h.findConnectorPayout).toHaveBeenCalledWith(db, ORG, 'po_9', 'pg_shop', {
      providerKey: 'shopify_payments',
      externalAccountIds: ['shop_1'],
    })
  })
})

describe('a feed whose connector raises records', () => {
  it('defers a payout the connector has not written yet, and writes nothing', async () => {
    h.hasConnectorPayouts.mockResolvedValue(true)

    const result = await sync()

    const value = result._unsafeUnwrap()
    expect(value).toMatchObject({ seen: 1, created: 0, posted: 0, refused: [] })
    expect(value.deferred).toEqual([
      { payoutId: 'po_9', reason: expect.stringContaining('shopify_payments connector') },
    ])
    expect(h.create).not.toHaveBeenCalled()
    expect(h.update).not.toHaveBeenCalled()
    expect(h.postPayoutEntry).not.toHaveBeenCalled()
  })
})

describe('a legacy-only feed', () => {
  it('creates and posts its own record, as before', async () => {
    h.findPayoutByGatewayId
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ payoutId: 'inst_new', number: 'PAY-0311', status: 'paid' })

    const result = await sync()

    expect(result._unsafeUnwrap()).toMatchObject({ created: 1, posted: 1, deferred: [] })
    expect(h.create).toHaveBeenCalledTimes(1)
    expect(h.create).toHaveBeenCalledWith(
      'def_payout',
      expect.objectContaining({ payout_gateway_id: 'po_9' })
    )
  })

  it('never asks about connector records once its own record exists', async () => {
    h.findPayoutByGatewayId.mockResolvedValue({
      payoutId: 'inst_lib',
      number: 'PAY-0305',
      status: 'in_transit',
    })

    await sync()

    expect(h.findConnectorPayout).not.toHaveBeenCalled()
    expect(h.hasConnectorPayouts).not.toHaveBeenCalled()
    expect(h.update).toHaveBeenCalledWith('def_payout:inst_lib', expect.anything())
  })
})

describe('the first-sync floor (brief 114 §3)', () => {
  const render = (value: unknown) => new PgDialect().sqlToQuery(value as SQL)

  it('counts only live rows stamped with this rail', async () => {
    await sync()

    expect(floorCalls.some((call) => call.method === 'leftJoin')).toBe(false)
    const join = floorCalls.find((call) => call.method === 'innerJoin')
    const on = render(join?.args[1])
    expect(on.sql).toContain('"relatedEntityId" = $')
    expect(on.params).toContain('pg_shop')
    expect(on.sql).not.toMatch(/is null/i)
    const where = render(floorCalls.find((call) => call.method === 'where')?.args[0])
    expect(where.sql).toContain('"archivedAt" is null')
    expect(where.sql).not.toContain('"relatedEntityId" is null')
  })
})
