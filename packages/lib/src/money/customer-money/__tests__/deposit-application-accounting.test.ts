// packages/lib/src/money/customer-money/__tests__/deposit-application-accounting.test.ts
//
// D19 task B (53 §7.3.3). The three properties that decide whether this lane is
// correct, none of which a schema test can reach:
//
//  1. the obligation is MONEY-owned and keyed on the APPLICATION, so one
//     movement applied to two invoices produces two work rows;
//  2. the entry is dated the day it was APPLIED, never the day the money
//     arrived - the prepayment changed character on the later date;
//  3. the accounting-off gate short-circuits before any read (task 17 §3).

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  isAccountingEnabled: vi.fn(),
  acceptEntryInTx: vi.fn(),
  captureMoneyApplicationWorkInTx: vi.fn(),
  resolveAccountLines: vi.fn(),
  resolveFulfillmentDeliveryIntentInTx: vi.fn(),
  planAccountingDeliveryInTx: vi.fn(),
  deliverAccountingPosting: vi.fn(),
  loadInvoiceForIssuance: vi.fn(),
  application: null as unknown,
  money: null as unknown,
  invoiceRows: [] as unknown[],
}))

vi.mock('../../../postings/accounting-enabled', () => ({
  isAccountingEnabled: h.isAccountingEnabled,
}))
vi.mock('../../../postings/accept-entry', () => ({ acceptEntryInTx: h.acceptEntryInTx }))
vi.mock('../../../postings/application-effect-work', () => ({
  captureMoneyApplicationWorkInTx: h.captureMoneyApplicationWorkInTx,
}))
vi.mock('../../../postings/resolve-roles', () => ({
  resolveAccountLines: h.resolveAccountLines,
}))
vi.mock('../../../postings/book-connections', () => ({
  resolveFulfillmentDeliveryIntentInTx: h.resolveFulfillmentDeliveryIntentInTx,
}))
vi.mock('../../../postings/delivery', () => ({
  planAccountingDeliveryInTx: h.planAccountingDeliveryInTx,
  deliverAccountingPosting: h.deliverAccountingPosting,
}))
vi.mock('../../../settings/settings-service', () => ({
  getOrganizationSetting: async ({ key }: { key: string }) =>
    key === 'organization.currency' ? 'USD' : 'America/New_York',
}))
vi.mock('../../invoices/issuance-reads', () => ({
  loadInvoiceForIssuance: h.loadInvoiceForIssuance,
}))

import { ok } from 'neverthrow'
import { acceptDepositApplicationAccounting } from '../deposit-application-accounting'

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

const accepted = (glPostingId: string) => ({
  status: 'accepted' as const,
  existing: false,
  glPostingId,
  glPostingIds: [glPostingId],
  effectIds: ['ef_1'],
  postings: [{ glPostingId, deliveryIntent: { kind: 'not_required' } }],
})

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
  h.resolveAccountLines.mockResolvedValue(
    ok([
      { glAccountId: 'gl_deposits', code: '2300', name: 'Deposits', accountType: 'liability' },
      { glAccountId: 'gl_ar', code: '1200', name: 'A/R', accountType: 'asset' },
    ])
  )
  h.captureMoneyApplicationWorkInTx.mockResolvedValue({
    work: { id: 'aw_1', basisVersion: 1 },
    basis: {},
    existing: false,
  })
  h.resolveFulfillmentDeliveryIntentInTx.mockResolvedValue({ kind: 'not_required' })
  h.acceptEntryInTx.mockResolvedValue(accepted('gp_1'))
})

describe('acceptDepositApplicationAccounting', () => {
  it('reclasses the applied amount out of customer_deposits and into the receivable', async () => {
    const result = await acceptDepositApplicationAccounting(stubDb(), {
      organizationId: ORG,
      moneyApplicationId: APPLICATION,
    })

    expect(result).toMatchObject({ status: 'posted', glPostingId: 'gp_1' })
    const entry = h.acceptEntryInTx.mock.calls[0]![1].entry
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
    const entry = h.acceptEntryInTx.mock.calls[0]![1].entry
    expect(entry.txnDate).toBe('2026-09-04')
    const member = h.acceptEntryInTx.mock.calls[0]![1].members[0]
    expect(member.acceptedBasis.effectiveDate).toBe('2026-09-04')
  })

  // 🔑 Money-owned work, keyed on the application: the capture is handed the
  // MOVEMENT as the owner and the APPLICATION as the identity.
  it('captures money-owned work that names the movement and the application', async () => {
    await acceptDepositApplicationAccounting(stubDb(), {
      organizationId: ORG,
      moneyApplicationId: APPLICATION,
      automatic: true,
    })
    const captured = h.captureMoneyApplicationWorkInTx.mock.calls[0]![1]
    expect(captured).toMatchObject({
      organizationId: ORG,
      moneyApplicationId: APPLICATION,
      moneyTransactionId: MOVEMENT,
      eligibility: 'automatic',
    })
    expect(captured.basis.calculation.invoiceInstanceId).toBe(INVOICE)
  })

  it('carries the customer on both balance-sheet legs and names the invoice as a reference', async () => {
    await acceptDepositApplicationAccounting(stubDb(), {
      organizationId: ORG,
      moneyApplicationId: APPLICATION,
    })
    const entry = h.acceptEntryInTx.mock.calls[0]![1].entry
    for (const line of entry.lines)
      expect(line).toMatchObject({ counterpartyType: 'customer', counterpartyId: 'ct_1' })
    const basis = h.acceptEntryInTx.mock.calls[0]![1].members[0].acceptedBasis
    expect(basis.documentRefs).toContainEqual({
      resourceKind: 'invoice',
      entityInstanceId: INVOICE,
    })
    expect(basis.policyKey).toBe('money_application_v1')
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
    expect(h.acceptEntryInTx).not.toHaveBeenCalled()
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
    expect(h.acceptEntryInTx).not.toHaveBeenCalled()
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

  it('never throws when acceptance refuses', async () => {
    h.acceptEntryInTx.mockRejectedValue(new Error('That month is locked.'))
    const result = await acceptDepositApplicationAccounting(stubDb(), {
      organizationId: ORG,
      moneyApplicationId: APPLICATION,
    })
    expect(result.status).toBe('error')
    expect(result.error).toMatch(/locked/)
  })
})
