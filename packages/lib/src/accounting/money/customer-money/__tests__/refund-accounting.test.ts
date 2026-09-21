// packages/lib/src/accounting/money/customer-money/__tests__/refund-accounting.test.ts
//
// The refund poster on the shared frame: the movement is the claim, the order is
// the parent, the customer is the counterparty, and the refund resolves its OWN
// endpoint through `resolveCashEndpoint` — a forward event, nothing frozen off
// the receipt it settles (task 71 D5).

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  isAccountingEnabled: vi.fn(),
  getOrganizationSetting: vi.fn(),
  postEntry: vi.fn(),
  findLiveSubjectPosting: vi.fn(),
  resolvePeriodLock: vi.fn(),
  readAutoPostMode: vi.fn(async () => 'post'),
  resolveRoles: vi.fn(),
  resolveBankAccountGlAccountInTx: vi.fn(),
  readCreditMemoControlAccount: vi.fn(),
  loadCreditMemo: vi.fn(),
  sumCreditMemoApplications: vi.fn(async () => 0),
  sumReservedCreditMemoRefunds: vi.fn(async () => 0),
  money: null as unknown,
  settlements: [] as unknown[],
  postingRows: [] as unknown[],
  lineRows: [] as unknown[],
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
vi.mock('../../../ledger/chart/resolve-cash-account', () => ({
  resolveBankAccountGlAccountInTx: h.resolveBankAccountGlAccountInTx,
}))
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
vi.mock('../../../sales/credit-memos/accounting', () => ({
  readCreditMemoControlAccount: h.readCreditMemoControlAccount,
}))
vi.mock('../../../sales/credit-memos/reads', () => ({
  loadCreditMemo: h.loadCreditMemo,
  sumCreditMemoApplications: h.sumCreditMemoApplications,
  sumReservedCreditMemoRefunds: h.sumReservedCreditMemoRefunds,
}))
vi.mock('@auxx/logger', () => ({
  createScopedLogger: () => ({ warn: vi.fn(), error: vi.fn(), info: vi.fn() }),
}))

import type { Database } from '@auxx/database'
import { postCustomerRefundAccounting } from '../refund-accounting'

const ORG = 'org_1'
const MOVEMENT = 'mt_refund'
const ORDER = 'order_1'
const CUSTOMER = 'ct_1'
const MEMO = 'cm_1'

function db(): Database {
  let call = 0
  const chain: Record<string, unknown> = {}
  for (const method of ['from', 'innerJoin', 'where', 'orderBy', 'limit'])
    chain[method] = () => chain
  // biome-ignore lint/suspicious/noThenProperty: a drizzle builder is thenable
  chain.then = (resolve: (rows: unknown[]) => unknown, reject?: (e: unknown) => unknown) =>
    Promise.resolve(call++ === 0 ? h.postingRows : h.lineRows).then(resolve, reject)
  const base = {
    select: () => chain,
    update: () => ({ set: () => ({ where: async () => undefined }) }),
    query: {
      MoneyTransaction: {
        findFirst: async () => h.money,
        findMany: async () => {
          const row = await h.money
          return row ? [row] : []
        },
      },
      MoneyRefundSettlement: { findMany: async () => h.settlements },
    },
  }
  return {
    ...base,
    update: () => ({ set: () => ({ where: async () => undefined }) }),
    transaction: async <T>(fn: (tx: unknown) => Promise<T>) => fn(base),
  } as unknown as Database
}

beforeEach(() => {
  vi.clearAllMocks()
  h.isAccountingEnabled.mockResolvedValue(true)
  h.readAutoPostMode.mockResolvedValue('post')
  h.sumCreditMemoApplications.mockResolvedValue(0)
  h.sumReservedCreditMemoRefunds.mockResolvedValue(0)
  h.resolvePeriodLock.mockResolvedValue({ lockedThroughMonth: null })
  h.postEntry.mockResolvedValue({ status: 'posted', glPostingId: 'gl_refund' })
  h.resolveRoles.mockResolvedValue({
    isErr: () => false,
    value: new Map([['clearing', { glAccountId: 'gl_clearing' }]]),
  })
  h.resolveBankAccountGlAccountInTx.mockResolvedValue('gl_bank')
  h.getOrganizationSetting.mockImplementation(async ({ key }: { key: string }) => {
    if (key === 'accounting.bookTimeZone') return 'America/Los_Angeles'
    if (key === 'accounting.setupState') return 'finalized'
    return null
  })
  h.money = {
    id: MOVEMENT,
    purpose: 'customer_refund',
    amountMinor: 20_000n,
    currency: 'USD',
    currencyExponent: 2,
    datePrecision: 'date',
    occurredOn: '2026-09-04',
    occurredAt: null,
    partyInstanceId: CUSTOMER,
    method: 'card',
    cashAccountInstanceId: null,
    paymentGatewayId: 'pg_1',
  }
  h.settlements = [
    {
      id: 'rs_1',
      amountMinor: 20_000n,
      disposition: 'customer_credit',
      customerCreditMemoInstanceId: MEMO,
      originalTransactionId: 'mt_receipt',
    },
  ]
  h.readCreditMemoControlAccount.mockResolvedValue({
    glPostingId: 'gl_memo',
    glAccountId: 'gl_ar',
    txnDate: '2026-09-01',
  })
  h.loadCreditMemo.mockResolvedValue({
    id: MEMO,
    contactInstanceId: CUSTOMER,
    orderInstanceId: ORDER,
    invoiceInstanceId: null,
    totalMinor: 20_000,
    amountRefundedMinor: 0,
    source: 'channel',
  })
  // The refund has not posted; the ORIGINAL receipt has.
  h.findLiveSubjectPosting.mockImplementation(
    async (_db: unknown, options: { sourceId: string }) =>
      options.sourceId === MOVEMENT
        ? { isErr: () => false, value: null }
        : {
            isErr: () => false,
            value: { id: 'gl_receipt', docNumber: 'AUXX-PMT-0001', txnDate: '2026-09-01' },
          }
  )
  h.postingRows = [{ railId: 'pg_1' }]
  h.lineRows = [{ glAccountId: 'gl_clearing' }]
})

describe('postCustomerRefundAccounting', () => {
  it('claims the movement, parents the order and names the customer', async () => {
    const result = await postCustomerRefundAccounting(db(), {
      organizationId: ORG,
      moneyTransactionId: MOVEMENT,
    })

    expect(result).toEqual({ status: 'accepted', glPostingId: 'gl_refund' })
    expect(h.postEntry.mock.calls[0]![1].sources).toEqual([
      { sourceKind: 'money_transaction', sourceId: MOVEMENT, linkRole: 'subject' },
      { sourceKind: 'order', sourceId: ORDER, linkRole: 'parent' },
      { sourceKind: 'contact', sourceId: CUSTOMER, linkRole: 'counterparty' },
    ])
  })

  it("credits the rail's clearing account the refund itself names", async () => {
    await postCustomerRefundAccounting(db(), { organizationId: ORG, moneyTransactionId: MOVEMENT })

    const options = h.postEntry.mock.calls[0]![1]
    expect(options.railId).toBe('pg_1')
    expect(options.scope).toEqual({ rail: 'pg_1' })
    const [debit, credit] = options.entry.lines
    expect(debit).toMatchObject({ glAccountId: 'gl_ar', direction: 'debit', amount: 20_000 })
    expect(credit).toMatchObject({ glAccountId: 'gl_clearing', direction: 'credit' })
  })

  // 71 D14, the other half: a memo issued before the order shipped credits A/R
  // out of `customer_deposits`, so its control account is A/R and the refund
  // draws THAT down. The refund poster does not branch on how the memo posted.
  it('draws down a pre-fulfillment memo through the same control account', async () => {
    h.readCreditMemoControlAccount.mockResolvedValue({
      glPostingId: 'gl_memo_prefulfilment',
      glAccountId: 'gl_ar',
      txnDate: '2026-09-01',
    })
    await postCustomerRefundAccounting(db(), { organizationId: ORG, moneyTransactionId: MOVEMENT })

    const [debit, credit] = h.postEntry.mock.calls[0]![1].entry.lines
    expect(debit).toMatchObject({ glAccountId: 'gl_ar', direction: 'debit', amount: 20_000 })
    expect(credit).toMatchObject({ glAccountId: 'gl_clearing', direction: 'credit' })
  })

  it('credits the bank account a hand-recorded refund names', async () => {
    ;(h.money as { paymentGatewayId: string | null }).paymentGatewayId = null
    ;(h.money as { cashAccountInstanceId: string | null }).cashAccountInstanceId = 'ba_1'
    await postCustomerRefundAccounting(db(), { organizationId: ORG, moneyTransactionId: MOVEMENT })

    const options = h.postEntry.mock.calls[0]![1]
    expect(options.railId).toBeNull()
    expect(options.entry.lines[1]).toMatchObject({ glAccountId: 'gl_bank', direction: 'credit' })
  })

  it('credits undeposited funds when the refund names neither', async () => {
    ;(h.money as { paymentGatewayId: string | null }).paymentGatewayId = null
    h.resolveRoles.mockResolvedValue({
      isErr: () => false,
      value: new Map([['undeposited_funds', { glAccountId: 'gl_undep' }]]),
    })
    await postCustomerRefundAccounting(db(), { organizationId: ORG, moneyTransactionId: MOVEMENT })

    expect(h.postEntry.mock.calls[0]![1].entry.lines[1]).toMatchObject({
      glAccountId: 'gl_undep',
      direction: 'credit',
    })
  })

  it('refuses a refund dated before the receipt it settles', async () => {
    h.findLiveSubjectPosting.mockImplementation(
      async (_db: unknown, options: { sourceId: string }) =>
        options.sourceId === MOVEMENT
          ? { isErr: () => false, value: null }
          : { isErr: () => false, value: { id: 'gl_receipt', txnDate: '2026-09-20' } }
    )
    const result = await postCustomerRefundAccounting(db(), {
      organizationId: ORG,
      moneyTransactionId: MOVEMENT,
    })
    expect(result.status).toBe('blocked')
    expect((result as { reason: string }).reason).toMatch(/precedes the original receipt/)
  })

  it('returns the standing posting on a retry, without preparing anything', async () => {
    h.findLiveSubjectPosting.mockResolvedValue({ isErr: () => false, value: { id: 'gl_refund' } })

    const result = await postCustomerRefundAccounting(db(), {
      organizationId: ORG,
      moneyTransactionId: MOVEMENT,
    })

    expect(result).toEqual({ status: 'accepted', glPostingId: 'gl_refund' })
    expect(h.postEntry).not.toHaveBeenCalled()
  })

  it('blocks when the credit memo never posted, so there is no control account', async () => {
    h.readCreditMemoControlAccount.mockResolvedValue(null)

    const result = await postCustomerRefundAccounting(db(), {
      organizationId: ORG,
      moneyTransactionId: MOVEMENT,
    })

    expect(result.status).toBe('blocked')
    expect((result as { reason: string }).reason).toMatch(/posted credit memo/)
  })

  it('blocks when the refund exceeds what the memo still has', async () => {
    h.sumCreditMemoApplications.mockResolvedValue(20_001)

    const result = await postCustomerRefundAccounting(db(), {
      organizationId: ORG,
      moneyTransactionId: MOVEMENT,
    })

    expect(result.status).toBe('blocked')
    expect((result as { reason: string }).reason).toMatch(/remaining credit memo entitlement/)
  })

  it('skips when accounting is off', async () => {
    h.isAccountingEnabled.mockResolvedValue(false)

    const result = await postCustomerRefundAccounting(db(), {
      organizationId: ORG,
      moneyTransactionId: MOVEMENT,
    })

    expect(result.status).toBe('skipped')
    expect(h.postEntry).not.toHaveBeenCalled()
  })

  it('drafts the entry when the refund avenue does not auto-post', async () => {
    h.readAutoPostMode.mockResolvedValue('draft')

    await postCustomerRefundAccounting(db(), { organizationId: ORG, moneyTransactionId: MOVEMENT })

    expect(h.postEntry.mock.calls[0]![1].mode).toBe('draft')
  })
})
