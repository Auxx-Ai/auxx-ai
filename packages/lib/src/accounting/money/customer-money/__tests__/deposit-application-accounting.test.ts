// packages/lib/src/accounting/money/customer-money/__tests__/deposit-application-accounting.test.ts
//
// The three properties that decide whether this lane is correct:
//
//  1. the subject claim is the APPLICATION, so one movement applied to two
//     invoices is two claims, and the invoice is the parent;
//  2. the entry is dated the day it was APPLIED, never the day the money
//     arrived - the prepayment changed character on the later date;
//  3. the accounting-off gate short-circuits before any read (task 17 §3).

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  isAccountingEnabled: vi.fn(),
  postEntry: vi.fn(),
  reverseEntry: vi.fn(),
  findLiveSubjectPosting: vi.fn(),
  resolvePeriodLock: vi.fn(),
  readAutoPostMode: vi.fn(async () => 'post'),
  loadInvoiceForIssuance: vi.fn(),
  application: null as unknown,
  money: null as unknown,
  invoiceRows: [] as unknown[],
}))

vi.mock('../../../ledger/setup/accounting-enabled', () => ({
  isAccountingEnabled: h.isAccountingEnabled,
}))
vi.mock('../../../ledger/post/post-entry', () => ({ postEntry: h.postEntry }))
vi.mock('../../../ledger/post/draft-lines', () => ({
  discardDraftsForSource: async () => ({ isErr: () => false, value: [] }),
}))
vi.mock('../../../ledger/post/reverse-entry', () => ({ reverseEntry: h.reverseEntry }))
vi.mock('../../../ledger/reads/list-postings', () => ({
  findLiveSubjectPosting: h.findLiveSubjectPosting,
}))
vi.mock('../../../ledger/periods/period-lock', () => ({
  resolvePeriodLock: h.resolvePeriodLock,
}))
vi.mock('../../../ledger/post/auto-post', () => ({
  readAutoPostMode: h.readAutoPostMode,
}))
vi.mock('../../../../settings/settings-service', () => ({
  getOrganizationSetting: async ({ key }: { key: string }) =>
    key === 'organization.currency' ? 'USD' : 'America/New_York',
}))
vi.mock('../../../sales/invoices/issuance-reads', () => ({
  loadInvoiceForIssuance: h.loadInvoiceForIssuance,
}))

import {
  acceptDepositApplicationAccounting,
  reverseDepositApplicationAccounting,
} from '../deposit-application-accounting'

const ORG = 'org_1'
const APPLICATION = 'ma_1'
const MOVEMENT = 'mt_1'
const INVOICE = 'inv_1'

function stubDb() {
  const chain: Record<string, unknown> = {}
  for (const method of ['from', 'innerJoin', 'where', 'limit']) chain[method] = () => chain
  // biome-ignore lint/suspicious/noThenProperty: the stub must be awaitable
  chain.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
    Promise.resolve(h.invoiceRows).then(resolve, reject)

  const db: Record<string, unknown> = {
    select: () => chain,
    query: {
      MoneyApplication: { findFirst: async () => h.application },
      MoneyTransaction: { findFirst: async () => h.money },
    },
  }
  db.transaction = (fn: (tx: unknown) => unknown) => fn(db)
  return db as never
}

beforeEach(() => {
  vi.clearAllMocks()
  h.isAccountingEnabled.mockResolvedValue(true)
  h.application = {
    id: APPLICATION,
    organizationId: ORG,
    moneyTransactionId: MOVEMENT,
    operation: 'apply',
    amountMinor: 20_000n,
    invoiceInstanceId: INVOICE,
    orderInstanceId: null,
    vendorBillInstanceId: null,
    // The money ARRIVED in March and was APPLIED in September.
    appliedAt: new Date('2026-09-04T12:00:00Z'),
    effectiveDate: '2026-09-04',
  }
  h.money = {
    id: MOVEMENT,
    organizationId: ORG,
    purpose: 'customer_receipt',
    amountMinor: 50_000n,
    currency: 'USD',
    currencyExponent: 2,
    occurredAt: new Date('2026-03-01T12:00:00Z'),
    partyInstanceId: 'ct_1',
  }
  h.invoiceRows = [{ id: INVOICE }]
  h.loadInvoiceForIssuance.mockResolvedValue({
    number: 'INV-0042',
    issuedAt: '2026-08-01',
    subtotalMinor: 50_000,
    taxTotalMinor: 0,
    totalMinor: 50_000,
    contactInstanceId: 'ct_1',
  })
  h.readAutoPostMode.mockResolvedValue('post')
  h.resolvePeriodLock.mockResolvedValue({ lockedThroughMonth: null })
  h.findLiveSubjectPosting.mockResolvedValue({ isErr: () => false, value: null })
  h.postEntry.mockResolvedValue({ status: 'posted', glPostingId: 'gp_1' })
  h.reverseEntry.mockResolvedValue({ status: 'posted', glPostingId: 'gp_rev' })
})

describe('acceptDepositApplicationAccounting', () => {
  it('reclasses the applied amount out of customer_deposits and into the receivable', async () => {
    const result = await acceptDepositApplicationAccounting(stubDb(), {
      organizationId: ORG,
      moneyApplicationId: APPLICATION,
    })

    expect(result).toMatchObject({ status: 'posted', glPostingId: 'gp_1' })
    const entry = h.postEntry.mock.calls[0]![1].entry
    expect(entry.postingType).toBe('deposit_application')
    expect(entry.totalDebit).toBe(20_000)
    expect(
      entry.lines.map((l: { accountRole: string; direction: string }) => [
        l.accountRole,
        l.direction,
      ])
    ).toEqual([
      ['customer_deposits', 'debit'],
      ['accounts_receivable', 'credit'],
    ])
  })

  // 🛑 The date the money changed character, not the date it arrived. The
  // movement above occurred in March; the application is September's event.
  it('dates the entry the day it was APPLIED, never the day the money arrived', async () => {
    await acceptDepositApplicationAccounting(stubDb(), {
      organizationId: ORG,
      moneyApplicationId: APPLICATION,
    })
    expect(h.postEntry.mock.calls[0]![1].entry.txnDate).toBe('2026-09-04')
  })

  // 🔑 The APPLICATION is the claim, so one movement applied to two invoices is
  // two claims; the invoice is the parent the ledger card reads.
  it('claims the application and parents the invoice', async () => {
    await acceptDepositApplicationAccounting(stubDb(), {
      organizationId: ORG,
      moneyApplicationId: APPLICATION,
      automatic: true,
    })
    expect(h.postEntry.mock.calls[0]![1].sources).toEqual([
      { sourceKind: 'money_application', sourceId: APPLICATION, linkRole: 'subject' },
      { sourceKind: 'invoice', sourceId: INVOICE, linkRole: 'parent' },
    ])
  })

  it('carries the customer on both balance-sheet legs', async () => {
    await acceptDepositApplicationAccounting(stubDb(), {
      organizationId: ORG,
      moneyApplicationId: APPLICATION,
    })
    const entry = h.postEntry.mock.calls[0]![1].entry
    for (const line of entry.lines)
      expect(line).toMatchObject({ counterpartyType: 'customer', counterpartyId: 'ct_1' })
  })

  it('drafts the entry when the receipt avenue does not auto-post', async () => {
    h.readAutoPostMode.mockResolvedValue('draft')
    await acceptDepositApplicationAccounting(stubDb(), {
      organizationId: ORG,
      moneyApplicationId: APPLICATION,
    })
    expect(h.postEntry.mock.calls[0]![1].mode).toBe('draft')
  })

  // task 17 §3: nothing is read, nothing is built, nothing is logged.
  it('short-circuits before any read when accounting is off', async () => {
    h.isAccountingEnabled.mockResolvedValue(false)
    const result = await acceptDepositApplicationAccounting(stubDb(), {
      organizationId: ORG,
      moneyApplicationId: APPLICATION,
    })
    expect(result).toEqual({ status: 'not_enabled' })
    expect(h.loadInvoiceForIssuance).not.toHaveBeenCalled()
    expect(h.postEntry).not.toHaveBeenCalled()
  })

  // ⚠️ An `unapply` reverses an earlier apply; its accounting is the correction
  // of that effect, not a second reclass in the same direction.
  it('refuses when there is no live invoice application', async () => {
    h.application = null
    const result = await acceptDepositApplicationAccounting(stubDb(), {
      organizationId: ORG,
      moneyApplicationId: APPLICATION,
    })
    expect(result.status).toBe('error')
    expect(result.error).toMatch(/live invoice application/)
    expect(h.postEntry).not.toHaveBeenCalled()
  })

  it('refuses when the movement is not a confirmed USD customer receipt', async () => {
    h.money = { ...(h.money as Record<string, unknown>), currency: 'EUR' }
    const result = await acceptDepositApplicationAccounting(stubDb(), {
      organizationId: ORG,
      moneyApplicationId: APPLICATION,
    })
    expect(result.status).toBe('error')
    expect(result.error).toMatch(/USD customer receipt/)
  })

  // 🛑 `MoneyApplication`'s FK guarantees an `EntityInstance`, not an INVOICE.
  it('refuses when the named record is not a live invoice', async () => {
    h.invoiceRows = []
    const result = await acceptDepositApplicationAccounting(stubDb(), {
      organizationId: ORG,
      moneyApplicationId: APPLICATION,
    })
    expect(result.status).toBe('error')
    expect(result.error).toMatch(/live invoice in this organization/)
  })

  it('never throws when the ledger refuses', async () => {
    h.postEntry.mockResolvedValue({ status: 'period_closed', error: 'That month is locked.' })
    const result = await acceptDepositApplicationAccounting(stubDb(), {
      organizationId: ORG,
      moneyApplicationId: APPLICATION,
    })
    expect(result.status).toBe('period_closed')
    expect(result.error).toMatch(/locked/)
  })
})

describe('reverseDepositApplicationAccounting', () => {
  it('reverses the application posting, freeing its claim', async () => {
    h.findLiveSubjectPosting.mockResolvedValue({
      isErr: () => false,
      value: { id: 'gp_1', docNumber: 'AUXX-DPA-0001' },
    })

    const result = await reverseDepositApplicationAccounting(stubDb(), {
      organizationId: ORG,
      moneyApplicationId: APPLICATION,
    })

    expect(result).toMatchObject({ status: 'posted' })
    expect(h.reverseEntry.mock.calls[0]![1].glPostingId).toBe('gp_1')
  })

  it('is a no-op when the application never posted', async () => {
    const result = await reverseDepositApplicationAccounting(stubDb(), {
      organizationId: ORG,
      moneyApplicationId: APPLICATION,
    })

    expect(result).toBeNull()
    expect(h.reverseEntry).not.toHaveBeenCalled()
  })
})
