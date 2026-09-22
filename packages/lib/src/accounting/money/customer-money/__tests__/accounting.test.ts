// packages/lib/src/accounting/money/customer-money/__tests__/accounting.test.ts
//
// The channel receipt on the one poster: Dr endpoint / Cr A/R for the movement's
// amount, the movement is the claim, the order a link, the store and rail ride on
// the posting (91 D1).

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  getOrganizationSetting: vi.fn(),
  isAccountingEnabled: vi.fn(),
  readCustomerReceiptAccountingSource: vi.fn(),
  resolveRoles: vi.fn(),
  postEntry: vi.fn(),
  findLiveSubjectPosting: vi.fn(),
  resolvePeriodLock: vi.fn(),
  upsertWorkItem: vi.fn(async () => ({ isErr: () => false })),
  money: null as unknown,
  updates: [] as unknown[],
}))

vi.mock('../../../ledger/setup/accounting-enabled', () => ({
  isAccountingEnabled: h.isAccountingEnabled,
}))
vi.mock('../../../ledger/post/post-entry', () => ({ postEntry: h.postEntry }))
vi.mock('../../../ledger/reads/list-postings', () => ({
  findLiveSubjectPosting: h.findLiveSubjectPosting,
}))
vi.mock('../../../ledger/periods/period-lock', () => ({
  resolvePeriodLock: h.resolvePeriodLock,
}))
vi.mock('../../../ledger/roles/resolve-roles', () => ({ resolveRoles: h.resolveRoles }))
vi.mock('../../../ledger/setup/setup-readiness', () => ({
  FINALIZED_SETUP_STATE: 'finalized',
}))
vi.mock('../../../../settings/settings-service', () => ({
  getOrganizationSetting: h.getOrganizationSetting,
}))
vi.mock('../../../../settings/read', () => ({
  readOrganizationSettings: async (organizationId: string, keys: readonly string[]) =>
    Object.fromEntries(
      await Promise.all(
        keys.map(async (key) => [key, await h.getOrganizationSetting({ organizationId, key })])
      )
    ),
}))
vi.mock('../receipt-accounting', () => ({
  readCustomerReceiptAccountingSource: h.readCustomerReceiptAccountingSource,
}))
vi.mock('../../../work-items/write', () => ({
  upsertWorkItem: h.upsertWorkItem,
  deleteWorkItem: vi.fn(async () => ({ isErr: () => false })),
}))
vi.mock('@auxx/logger', () => ({
  createScopedLogger: () => ({ warn: vi.fn(), error: vi.fn(), info: vi.fn() }),
}))

import type { Database } from '@auxx/database'
import { postCustomerReceiptAccounting } from '../accounting'

const organizationId = 'org_1'
const moneyTransactionId = 'money_1'

function db(): Database {
  const tx = {
    query: {
      MoneyTransaction: {
        findFirst: async () => h.money,
        findMany: async () => {
          const row = await h.money
          return row ? [row] : []
        },
      },
    },
    update: () => ({ set: (values: unknown) => ({ where: async () => h.updates.push(values) }) }),
  }
  return {
    update: () => ({ set: () => ({ where: async () => undefined }) }),
    // `findLiveDraft`'s select chain: no draft is waiting.
    select: () => {
      const chain: Record<string, unknown> = {}
      for (const method of ['from', 'innerJoin', 'where', 'limit']) chain[method] = () => chain
      // biome-ignore lint/suspicious/noThenProperty: chainable drizzle query-builder stub
      chain.then = (resolve: (v: unknown) => unknown) => Promise.resolve([]).then(resolve)
      return chain
    },
    transaction: async <T>(fn: (transaction: typeof tx) => Promise<T>) => fn(tx),
  } as unknown as Database
}

function receiptSource(
  overrides: { orderId?: string | null; partyInstanceId?: string | null } = {}
) {
  return {
    money: {
      id: moneyTransactionId,
      amountMinor: 10_800n,
      currency: 'USD',
      currencyExponent: 2,
      occurredAt: new Date('2026-09-01T15:00:00.000Z'),
      partyInstanceId:
        overrides.partyInstanceId === undefined ? 'customer_1' : overrides.partyInstanceId,
    },
    orderId: overrides.orderId === undefined ? 'order_1' : overrides.orderId,
    paymentGatewayId: 'gateway_1',
    sourceStoreId: 'store_1',
    sourceProvider: 'shopify',
    sourceObjectId: 'source_1',
    sourceExternalId: 'capture_1',
    sourceRevision: 'observation_1',
    gatewayName: 'Shopify Payments',
    storeDomain: 'demo.myshopify.com',
    sourceHash: 'b'.repeat(64),
  }
}

type Line = {
  accountRole?: string
  glAccountId?: string
  direction: string
  amount: number
  counterpartyId?: string
}
const shape = (lines: Line[]) =>
  lines.map((line) => [line.accountRole ?? line.glAccountId, line.direction, line.amount])

beforeEach(() => {
  vi.clearAllMocks()
  h.updates = []
  h.money = {
    id: moneyTransactionId,
    organizationId,
    purpose: 'customer_receipt',
    amountMinor: 10_800n,
    currency: 'USD',
    currencyExponent: 2,
    datePrecision: 'instant',
    occurredAt: new Date('2026-09-01T15:00:00.000Z'),
    occurredOn: null,
    partyInstanceId: 'customer_1',
    cashAccountInstanceId: null,
    paymentGatewayId: null,
    method: null,
  }
  h.isAccountingEnabled.mockResolvedValue(true)
  h.resolvePeriodLock.mockResolvedValue({ lockedThroughMonth: null })
  h.findLiveSubjectPosting.mockResolvedValue({ isErr: () => false, value: null })
  h.postEntry.mockResolvedValue({ status: 'posted', glPostingId: 'posting_1' })
  h.getOrganizationSetting.mockImplementation(async ({ key }: { key: string }) => {
    if (key === 'accounting.bookTimeZone') return 'America/Los_Angeles'
    if (key === 'accounting.setupState') return 'finalized'
    if (key === 'accounting.guestContactId') return 'guest_1'
    return null
  })
  h.readCustomerReceiptAccountingSource.mockResolvedValue(receiptSource())
  h.resolveRoles.mockResolvedValue({
    isErr: () => false,
    value: new Map([['clearing', { glAccountId: 'gl_clearing', accountType: 'asset' }]]),
  })
})

describe('postCustomerReceiptAccounting', () => {
  it('claims the movement, parents the order, names the customer, and scopes the rail', async () => {
    const result = await postCustomerReceiptAccounting(db(), {
      organizationId,
      moneyTransactionId,
    })

    expect(result).toEqual({ status: 'accepted', glPostingId: 'posting_1' })
    const options = h.postEntry.mock.calls[0]![1]
    expect(options.sources).toEqual([
      { sourceKind: 'money_transaction', sourceId: moneyTransactionId, linkRole: 'subject' },
      { sourceKind: 'order', sourceId: 'order_1', linkRole: 'parent' },
      { sourceKind: 'contact', sourceId: 'customer_1', linkRole: 'counterparty' },
    ])
    expect(options.storeId).toBe('store_1')
    expect(options.railId).toBe('gateway_1')
    expect(options.scope).toEqual({ store: 'store_1', rail: 'gateway_1' })
    // The rail is stamped onto the movement inside the posting transaction.
    expect(h.updates).toEqual([{ paymentGatewayId: 'gateway_1' }])
  })

  it('posts Dr endpoint / Cr A/R for the whole movement, with no deposits or tax leg', async () => {
    await postCustomerReceiptAccounting(db(), { organizationId, moneyTransactionId })

    const lines: Line[] = h.postEntry.mock.calls[0]![1].entry.lines
    expect(shape(lines)).toEqual([
      ['gl_clearing', 'debit', 10_800],
      ['accounts_receivable', 'credit', 10_800],
    ])
    expect(lines[1]).toMatchObject({
      sourceType: 'money_transaction',
      sourceId: moneyTransactionId,
      counterpartyType: 'customer',
      counterpartyId: 'customer_1',
    })
  })

  it('posts the same lines for a receipt applied to no order, with no parent link', async () => {
    await postCustomerReceiptAccounting(db(), { organizationId, moneyTransactionId })
    const withOrder = h.postEntry.mock.calls[0]![1]
    h.readCustomerReceiptAccountingSource.mockResolvedValue(receiptSource({ orderId: null }))

    await postCustomerReceiptAccounting(db(), { organizationId, moneyTransactionId })

    const withoutOrder = h.postEntry.mock.calls[1]![1]
    expect(withoutOrder.entry.lines).toEqual(withOrder.entry.lines)
    expect(withoutOrder.sources).toEqual([
      { sourceKind: 'money_transaction', sourceId: moneyTransactionId, linkRole: 'subject' },
      { sourceKind: 'contact', sourceId: 'customer_1', linkRole: 'counterparty' },
    ])
  })

  it('names the guest customer when the movement has none', async () => {
    h.money = { ...(h.money as object), partyInstanceId: null }
    h.readCustomerReceiptAccountingSource.mockResolvedValue(
      receiptSource({ orderId: null, partyInstanceId: null })
    )

    await postCustomerReceiptAccounting(db(), { organizationId, moneyTransactionId })

    const options = h.postEntry.mock.calls[0]![1]
    expect(options.entry.lines[1]).toMatchObject({ counterpartyId: 'guest_1' })
    expect(options.sources).toContainEqual({
      sourceKind: 'contact',
      sourceId: 'guest_1',
      linkRole: 'counterparty',
    })
  })

  it('blocks when neither the movement nor the org has a customer', async () => {
    h.money = { ...(h.money as object), partyInstanceId: null }
    h.readCustomerReceiptAccountingSource.mockResolvedValue(
      receiptSource({ partyInstanceId: null })
    )
    h.getOrganizationSetting.mockImplementation(async ({ key }: { key: string }) =>
      key === 'accounting.bookTimeZone'
        ? 'America/Los_Angeles'
        : key === 'accounting.setupState'
          ? 'finalized'
          : null
    )

    const result = await postCustomerReceiptAccounting(db(), { organizationId, moneyTransactionId })

    expect(result).toEqual({
      status: 'blocked',
      reason: 'Receipt has no customer and the organization has no guest customer',
    })
    expect(h.postEntry).not.toHaveBeenCalled()
    // The code minting the guest wakes.
    expect(h.upsertWorkItem).toHaveBeenCalledWith(
      expect.anything(),
      organizationId,
      expect.objectContaining({ stage: 'post', reasonCode: 'CUSTOMER_UNRESOLVED' })
    )
  })

  it('parks an unmapped clearing as ROLE_UNMAPPED keyed by role and rail', async () => {
    h.resolveRoles.mockResolvedValue({ isErr: () => false, value: new Map() })

    const result = await postCustomerReceiptAccounting(db(), { organizationId, moneyTransactionId })

    expect(result.status).toBe('blocked')
    expect(h.upsertWorkItem).toHaveBeenCalledWith(
      expect.anything(),
      organizationId,
      expect.objectContaining({
        reasonCode: 'ROLE_UNMAPPED',
        role: 'clearing',
        railId: 'gateway_1',
      })
    )
  })

  it('debits undeposited funds for a receipt whose handle names no rail', async () => {
    h.readCustomerReceiptAccountingSource.mockResolvedValue({
      ...receiptSource(),
      paymentGatewayId: null,
    })
    h.resolveRoles.mockResolvedValue({
      isErr: () => false,
      value: new Map([['undeposited_funds', { glAccountId: 'gl_undep' }]]),
    })

    await postCustomerReceiptAccounting(db(), { organizationId, moneyTransactionId })

    // Nothing stamped: a `manual` Shopify payment is money in no processor.
    expect(h.updates).toEqual([])
    const options = h.postEntry.mock.calls[0]![1]
    expect(options.railId).toBeNull()
    expect(options.entry.lines[0]).toMatchObject({ glAccountId: 'gl_undep', direction: 'debit' })
  })

  it('returns the standing posting without preparing anything, on a retry', async () => {
    h.findLiveSubjectPosting.mockResolvedValue({ isErr: () => false, value: { id: 'posting_1' } })

    const result = await postCustomerReceiptAccounting(db(), {
      organizationId,
      moneyTransactionId,
    })

    expect(result).toEqual({ status: 'accepted', glPostingId: 'posting_1' })
    expect(h.readCustomerReceiptAccountingSource).not.toHaveBeenCalled()
    expect(h.postEntry).not.toHaveBeenCalled()
  })

  it('blocks rather than throws when the source cannot be read', async () => {
    h.readCustomerReceiptAccountingSource.mockRejectedValue(
      new (await import('../../../../errors')).UnprocessableEntityError(
        'Receipt source is unresolved'
      )
    )

    const result = await postCustomerReceiptAccounting(db(), {
      organizationId,
      moneyTransactionId,
    })

    expect(result.status).toBe('blocked')
    expect((result as { reason: string }).reason).toMatch(/unresolved/)
    expect(h.postEntry).not.toHaveBeenCalled()
  })

  it('blocks when the ledger refuses the entry', async () => {
    h.postEntry.mockResolvedValue({ status: 'period_closed', error: 'September is closed.' })

    const result = await postCustomerReceiptAccounting(db(), {
      organizationId,
      moneyTransactionId,
    })

    expect(result).toEqual({ status: 'blocked', reason: 'September is closed.' })
  })

  it('skips when accounting is off', async () => {
    const result = await postCustomerReceiptAccounting(db(), {
      organizationId,
      moneyTransactionId,
    })

    h.isAccountingEnabled.mockResolvedValue(false)
    expect(result.status).toBe('accepted')
    expect(
      (await postCustomerReceiptAccounting(db(), { organizationId, moneyTransactionId })).status
    ).toBe('skipped')
  })
})
