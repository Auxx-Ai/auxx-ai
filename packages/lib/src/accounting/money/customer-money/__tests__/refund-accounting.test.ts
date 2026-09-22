// packages/lib/src/accounting/money/customer-money/__tests__/refund-accounting.test.ts
//
// The refund on its own facts (91 D4): `Dr A/R / Cr endpoint`, posting with no memo
// posting, no receipt posting and no memo document. The memo is a link: a parent on
// the posting, and the entitlement checked where one exists - a warning, never a refusal.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  isAccountingEnabled: vi.fn(),
  getOrganizationSetting: vi.fn(),
  postEntry: vi.fn(),
  posted: null as string | null,
  resolvePeriodLock: vi.fn(),
  readAutoPostMode: vi.fn(async () => 'post'),
  resolveRoles: vi.fn(),
  resolveBankAccountGlAccountInTx: vi.fn(),
  readSource: vi.fn(),
  loadCreditMemo: vi.fn(),
  sumCreditMemoApplications: vi.fn(async () => 0),
  sumReservedCreditMemoRefunds: vi.fn(async () => 0),
  insertLinks: vi.fn(),
  upsertWorkItem: vi.fn(),
  deleteWorkItem: vi.fn(),
  money: null as unknown,
  settlements: [] as unknown[],
  acceptances: [] as unknown[],
  memoLinks: [] as unknown[],
}))

vi.mock('../../../ledger/setup/accounting-enabled', () => ({
  isAccountingEnabled: h.isAccountingEnabled,
}))
vi.mock('../../../ledger/post/auto-post', () => ({
  readAutoPostMode: h.readAutoPostMode,
}))
vi.mock('../../../ledger/post/post-entry', () => ({ postEntry: h.postEntry }))
// The refund's own claim appears once `postEntry` has written it.
vi.mock('../../../ledger/reads/list-postings', () => ({
  findLiveSubjectPosting: async () => ({
    isErr: () => false,
    value: h.posted ? { id: h.posted, txnDate: '2026-09-04' } : null,
  }),
}))
vi.mock('../../../ledger/post/insert-posting', () => ({ insertSourceLinksInTx: h.insertLinks }))
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
vi.mock('../../../work-items/write', () => ({
  upsertWorkItem: h.upsertWorkItem,
  deleteWorkItem: h.deleteWorkItem,
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
  readCustomerReceiptAccountingSource: h.readSource,
}))
vi.mock('../../../sales/credit-memos/reads', () => ({
  loadCreditMemo: h.loadCreditMemo,
  sumCreditMemoApplications: h.sumCreditMemoApplications,
  sumReservedCreditMemoRefunds: h.sumReservedCreditMemoRefunds,
}))
vi.mock('@auxx/logger', () => ({
  createScopedLogger: () => ({ warn: vi.fn(), error: vi.fn(), info: vi.fn() }),
}))

import { type Database, schema } from '@auxx/database'
import { postCustomerRefundAccounting } from '../refund-accounting'

const ORG = 'org_1'
const MOVEMENT = 'mt_refund'
const ORDER = 'order_1'
const CUSTOMER = 'ct_1'
const GUEST = 'ct_guest'
const MEMO = 'cm_1'

function db(): Database {
  const select = () => {
    let table: unknown
    const chain: Record<string, unknown> = {}
    chain.from = (from: unknown) => {
      table = from
      return chain
    }
    for (const method of ['innerJoin', 'where', 'orderBy', 'limit']) chain[method] = () => chain
    // biome-ignore lint/suspicious/noThenProperty: a drizzle builder is thenable
    chain.then = (resolve: (rows: unknown[]) => unknown, reject?: (e: unknown) => unknown) =>
      Promise.resolve(
        table === schema.FinancialSourceAcceptance
          ? h.acceptances
          : table === schema.GlPostingSource
            ? h.memoLinks
            : []
      ).then(resolve, reject)
    return chain
  }
  const base = {
    select,
    update: () => ({ set: () => ({ where: async () => undefined }) }),
    query: {
      MoneyTransaction: { findMany: async () => (h.money ? [h.money] : []) },
      MoneyRefundSettlement: { findMany: async () => h.settlements },
    },
  }
  return {
    ...base,
    transaction: async <T>(fn: (tx: unknown) => Promise<T>) => fn(base),
  } as unknown as Database
}

const settlement = { id: 'rs_1', amountMinor: 20_000n, disposition: 'customer_credit' }

beforeEach(() => {
  vi.clearAllMocks()
  h.posted = null
  h.isAccountingEnabled.mockResolvedValue(true)
  h.readAutoPostMode.mockResolvedValue('post')
  h.sumCreditMemoApplications.mockResolvedValue(0)
  h.sumReservedCreditMemoRefunds.mockResolvedValue(20_000)
  h.resolvePeriodLock.mockResolvedValue({ lockedThroughMonth: null })
  h.postEntry.mockImplementation(async () => {
    h.posted = 'gl_refund'
    return { status: 'posted', glPostingId: 'gl_refund' }
  })
  h.resolveRoles.mockResolvedValue({
    isErr: () => false,
    value: new Map([
      ['clearing', { glAccountId: 'gl_clearing' }],
      ['undeposited_funds', { glAccountId: 'gl_undep' }],
    ]),
  })
  h.resolveBankAccountGlAccountInTx.mockResolvedValue('gl_bank')
  h.getOrganizationSetting.mockImplementation(async ({ key }: { key: string }) => {
    if (key === 'accounting.bookTimeZone') return 'America/Los_Angeles'
    if (key === 'accounting.setupState') return 'finalized'
    if (key === 'accounting.guestContactId') return GUEST
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
  // A native refund: its settlement was written with the movement.
  h.settlements = [{ ...settlement, customerCreditMemoInstanceId: MEMO }]
  h.acceptances = []
  h.memoLinks = []
  h.readSource.mockResolvedValue({ paymentGatewayId: 'pg_shop', sourceStoreId: 'fsa_1' })
  h.loadCreditMemo.mockResolvedValue({
    id: MEMO,
    contactInstanceId: CUSTOMER,
    orderInstanceId: null,
    invoiceInstanceId: 'inv_1',
    issuedAt: '2026-09-01',
    totalMinor: 20_000,
    amountRefundedMinor: 0,
    source: 'native',
  })
})

const post = () =>
  postCustomerRefundAccounting(db(), { organizationId: ORG, moneyTransactionId: MOVEMENT })

describe('the entry: Dr A/R / Cr endpoint (91 D4)', () => {
  it('debits the receivable role for the movement and credits the endpoint', async () => {
    expect(await post()).toEqual({ status: 'accepted', glPostingId: 'gl_refund' })

    const options = h.postEntry.mock.calls[0]![1]
    expect(
      options.entry.lines.map((line: Record<string, unknown>) => [
        line.accountRole ?? line.glAccountId,
        line.direction,
        line.amount,
        line.counterpartyId ?? null,
        line.sourceType,
        line.sourceId,
      ])
    ).toEqual([
      ['accounts_receivable', 'debit', 20_000, CUSTOMER, 'money_transaction', MOVEMENT],
      ['gl_clearing', 'credit', 20_000, null, 'money_transaction', MOVEMENT],
    ])
    expect(options.railId).toBe('pg_1')
    expect(options.scope).toEqual({ rail: 'pg_1' })
  })

  it('posts a channel refund with no memo document, no memo posting and no receipt posting', async () => {
    h.settlements = []
    h.acceptances = [{ orderInstanceId: ORDER }]
    ;(h.money as { paymentGatewayId: string | null }).paymentGatewayId = null

    expect(await post()).toEqual({ status: 'accepted', glPostingId: 'gl_refund' })

    expect(h.loadCreditMemo).not.toHaveBeenCalled()
    const options = h.postEntry.mock.calls[0]![1]
    expect(options.entry.lines[0]).toMatchObject({ accountRole: 'accounts_receivable' })
    expect(options.entry.lines[0].dimensions).toBeUndefined()
    expect(options.storeId).toBe('fsa_1')
    expect(options.sources).toEqual([
      { sourceKind: 'money_transaction', sourceId: MOVEMENT, linkRole: 'subject' },
      { sourceKind: 'order', sourceId: ORDER, linkRole: 'parent' },
      { sourceKind: 'contact', sourceId: CUSTOMER, linkRole: 'counterparty' },
    ])
    expect(h.insertLinks).not.toHaveBeenCalled()
  })

  it("resolves a channel refund's rail from its own gateway handle", async () => {
    h.settlements = []
    h.acceptances = [{ orderInstanceId: ORDER }]
    ;(h.money as { paymentGatewayId: string | null }).paymentGatewayId = null

    await post()

    expect(h.readSource).toHaveBeenCalledWith(expect.anything(), ORG, MOVEMENT, 'customer_refund')
    expect(h.postEntry.mock.calls[0]![1].railId).toBe('pg_shop')
  })

  it('names the guest when the refund has no customer', async () => {
    ;(h.money as { partyInstanceId: string | null }).partyInstanceId = null
    h.settlements = []

    await post()

    const options = h.postEntry.mock.calls[0]![1]
    expect(options.entry.lines[0].counterpartyId).toBe(GUEST)
    expect(options.sources).toContainEqual({
      sourceKind: 'contact',
      sourceId: GUEST,
      linkRole: 'counterparty',
    })
  })

  it('credits the bank account a hand-recorded refund names', async () => {
    ;(h.money as { paymentGatewayId: string | null }).paymentGatewayId = null
    ;(h.money as { cashAccountInstanceId: string | null }).cashAccountInstanceId = 'ba_1'

    await post()

    const options = h.postEntry.mock.calls[0]![1]
    expect(options.railId).toBeNull()
    expect(options.entry.lines[1]).toMatchObject({ glAccountId: 'gl_bank', direction: 'credit' })
  })

  it('credits undeposited funds when the refund names neither', async () => {
    ;(h.money as { paymentGatewayId: string | null }).paymentGatewayId = null

    await post()

    expect(h.postEntry.mock.calls[0]![1].entry.lines[1]).toMatchObject({
      glAccountId: 'gl_undep',
      direction: 'credit',
    })
  })

  it("parents a native refund on its memo's document and carries its one settlement", async () => {
    await post()

    const options = h.postEntry.mock.calls[0]![1]
    expect(options.sources).toContainEqual({
      sourceKind: 'invoice',
      sourceId: 'inv_1',
      linkRole: 'parent',
    })
    expect(options.entry.lines[0].dimensions).toEqual({ settlementId: 'rs_1' })
  })
})

describe('the memo, where one exists', () => {
  it('links the memo as a parent on the posting and clears any warning', async () => {
    await post()

    expect(h.insertLinks).toHaveBeenCalledWith(expect.anything(), {
      organizationId: ORG,
      glPostingId: 'gl_refund',
      sources: [{ sourceKind: 'credit_memo', sourceId: MEMO, linkRole: 'parent' }],
      mode: 'post',
    })
    expect(h.upsertWorkItem).not.toHaveBeenCalled()
    expect(h.deleteWorkItem).toHaveBeenLastCalledWith(expect.anything(), ORG, {
      sourceKind: 'money_transaction',
      sourceId: MOVEMENT,
      stage: 'post',
    })
  })

  it('does not write the parent link twice', async () => {
    h.memoLinks = [{ sourceId: MEMO }]
    await post()
    expect(h.insertLinks).not.toHaveBeenCalled()
  })

  it('posts a refund that exceeds the memo, and leaves a REFUND_EXCEEDS_MEMO warning', async () => {
    h.sumCreditMemoApplications.mockResolvedValue(1)

    expect(await post()).toEqual({ status: 'accepted', glPostingId: 'gl_refund' })

    expect(h.upsertWorkItem).toHaveBeenCalledWith(expect.anything(), ORG, {
      sourceKind: 'money_transaction',
      sourceId: MOVEMENT,
      stage: 'post',
      reasonCode: 'REFUND_EXCEEDS_MEMO',
      detail: { creditMemoInstanceIds: [MEMO] },
    })
  })

  it('refuses a refund dated before the memo it settles', async () => {
    h.loadCreditMemo.mockResolvedValue({
      id: MEMO,
      orderInstanceId: ORDER,
      invoiceInstanceId: null,
      issuedAt: '2026-09-20',
      totalMinor: 20_000,
      source: 'channel',
    })

    const result = await post()

    expect(result.status).toBe('blocked')
    expect((result as { reason: string }).reason).toMatch(/precedes the credit memo/)
    expect(h.postEntry).not.toHaveBeenCalled()
  })

  it('refuses a memo whose total is out of range', async () => {
    h.loadCreditMemo.mockResolvedValue({
      id: MEMO,
      orderInstanceId: null,
      invoiceInstanceId: 'inv_1',
      issuedAt: null,
      totalMinor: -1,
      source: 'native',
    })

    expect((await post()).status).toBe('blocked')
  })
})

describe('the frame', () => {
  it('returns the standing posting on a retry and re-runs the link step', async () => {
    h.posted = 'gl_refund'

    expect(await post()).toEqual({ status: 'accepted', glPostingId: 'gl_refund' })
    expect(h.postEntry).not.toHaveBeenCalled()
    expect(h.insertLinks).toHaveBeenCalledOnce()
  })

  it('skips when accounting is off', async () => {
    h.isAccountingEnabled.mockResolvedValue(false)

    expect((await post()).status).toBe('skipped')
    expect(h.postEntry).not.toHaveBeenCalled()
  })
})
