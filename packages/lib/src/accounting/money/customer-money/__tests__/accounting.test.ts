// packages/lib/src/accounting/money/customer-money/__tests__/accounting.test.ts
//
// The channel receipt writer on the one poster: the recognition split becomes
// the entry's lines, the movement is the claim, the order is the parent, and
// the store and rail ride on the posting (MIGRATION.md step 1b).

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  getOrganizationSetting: vi.fn(),
  isAccountingEnabled: vi.fn(),
  listCustomerMoneyAccountingCandidates: vi.fn(),
  readCustomerReceiptAccountingSource: vi.fn(),
  readOrderRecognitionFactsInTx: vi.fn(),
  readOrderRecognitionSource: vi.fn(),
  resolveRoles: vi.fn(),
  postEntry: vi.fn(),
  findLiveSubjectPosting: vi.fn(),
  resolvePeriodLock: vi.fn(),
  readAutoPostMode: vi.fn(async () => 'post'),
  money: null as unknown,
  updates: [] as unknown[],
}))

vi.mock('../../../ledger/setup/accounting-enabled', () => ({
  isAccountingEnabled: h.isAccountingEnabled,
}))
vi.mock('../../../ledger/post/auto-post', () => ({
  readAutoPostMode: h.readAutoPostMode,
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
  listCustomerMoneyAccountingCandidates: h.listCustomerMoneyAccountingCandidates,
  readCustomerReceiptAccountingSource: h.readCustomerReceiptAccountingSource,
}))
vi.mock('../recognition-facts', () => ({
  readOrderRecognitionFactsInTx: h.readOrderRecognitionFactsInTx,
}))
vi.mock('../recognition-source', () => ({
  readOrderRecognitionSource: h.readOrderRecognitionSource,
  requireCompleteOrderRecognitionSource: (value: unknown) => value,
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

function receiptSource(amountMinor = 120n) {
  return {
    money: {
      id: moneyTransactionId,
      amountMinor,
      currency: 'USD',
      currencyExponent: 2,
      occurredAt: new Date('2026-09-01T15:00:00.000Z'),
      partyInstanceId: 'customer_1',
    },
    orderId: 'order_1',
    effectiveDate: '2026-09-01',
    paymentGatewayId: 'gateway_1',
    sourceStoreId: 'store_1',
    sourceProvider: 'shopify',
    sourceObjectId: 'source_1',
    sourceExternalId: 'capture_1',
    sourceRevision: 'observation_1',
    gatewayName: 'Shopify Payments',
    storeDomain: 'demo.myshopify.com',
    sourceHash: 'b'.repeat(64),
    applications: [
      { id: 'application_1', orderInstanceId: 'order_1', amountMinor, effectiveDate: '2026-09-01' },
    ],
  }
}

function prepareRecognition(
  amountMinor: bigint,
  depositMinor: string,
  receivableMinor: string,
  taxMinor: string
) {
  h.readCustomerReceiptAccountingSource.mockResolvedValue(receiptSource(amountMinor))
  h.readOrderRecognitionFactsInTx.mockResolvedValue({
    orderId: 'order_1',
    customerInstanceId: 'customer_1',
    subtotal: 100n,
    tax: 20n,
    shipping: 0n,
    total: 120n,
    channel: null,
    taxComponents: [
      {
        componentKey: 'tax_1',
        amountMinor: '20',
        jurisdiction: 'CA',
        collector: 'merchant',
        remitter: 'merchant',
        withholdingEvidenceId: null,
      },
    ],
  })
  const allocation = {
    id: moneyTransactionId,
    kind: 'receipt' as const,
    effectiveDate: '2026-09-01',
    amountMinor: amountMinor.toString(),
    depositMinor,
    receivableMinor,
    taxMinor,
    historyHash: 'c'.repeat(64),
  }
  h.readOrderRecognitionSource.mockResolvedValue({
    target: allocation,
    allocations: [allocation],
    blockers: [],
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  h.updates = []
  h.money = {
    id: moneyTransactionId,
    organizationId,
    purpose: 'customer_receipt',
    amountMinor: 120n,
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
  h.readAutoPostMode.mockResolvedValue('post')
  h.resolvePeriodLock.mockResolvedValue({ lockedThroughMonth: null })
  h.findLiveSubjectPosting.mockResolvedValue({ isErr: () => false, value: null })
  h.postEntry.mockResolvedValue({ status: 'posted', glPostingId: 'posting_1' })
  h.getOrganizationSetting.mockImplementation(async ({ key }: { key: string }) => {
    if (key === 'accounting.bookTimeZone') return 'America/Los_Angeles'
    if (key === 'accounting.setupState') return 'finalized'
    return null
  })
  h.resolveRoles.mockResolvedValue({
    isErr: () => false,
    value: new Map([['clearing', { glAccountId: 'gl_clearing', accountType: 'asset' }]]),
  })
})

describe('postCustomerReceiptAccounting', () => {
  it('claims the movement, parents the order, names the customer, and scopes the rail', async () => {
    prepareRecognition(120n, '0', '100', '20')

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
    expect(options.mode).toBe('post')
    // The rail is stamped onto the movement inside the posting transaction.
    expect(h.updates).toEqual([{ paymentGatewayId: 'gateway_1' }])
  })

  it('builds the advance journal from the recognition allocation', async () => {
    prepareRecognition(120n, '100', '0', '20')

    await postCustomerReceiptAccounting(db(), { organizationId, moneyTransactionId })

    const entry = h.postEntry.mock.calls[0]![1].entry
    expect(
      entry.lines.map((line: { accountRole?: string; glAccountId?: string; amount: number }) => [
        line.accountRole ?? line.glAccountId,
        line.amount,
      ])
    ).toEqual([
      ['gl_clearing', 120],
      ['customer_deposits', 100],
      ['sales_tax_payable', 20],
    ])
  })

  it('builds the after-shipment journal against the receivable', async () => {
    prepareRecognition(120n, '0', '100', '20')

    await postCustomerReceiptAccounting(db(), { organizationId, moneyTransactionId })

    const entry = h.postEntry.mock.calls[0]![1].entry
    expect(entry.lines[1]).toMatchObject({
      accountRole: 'accounts_receivable',
      counterpartyId: 'customer_1',
      amount: 100,
    })
  })

  it('debits undeposited funds for a receipt whose handle names no rail', async () => {
    prepareRecognition(120n, '0', '100', '20')
    h.readCustomerReceiptAccountingSource.mockResolvedValue({
      ...receiptSource(120n),
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
    prepareRecognition(120n, '0', '100', '20')
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
    prepareRecognition(120n, '0', '100', '20')
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
