// packages/lib/src/accounting/money/invoice-payments/__tests__/receipt-accounting.test.ts
//
// The hand-recorded invoice receipt on the shared frame: the debit is whatever
// the one cash endpoint answers, and the credit is always the receivable.

import { ok } from 'neverthrow'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  isAccountingEnabled: vi.fn(),
  findLiveSubjectPosting: vi.fn(),
  resolvePeriodLock: vi.fn(),
  readAutoPostMode: vi.fn(),
  postEntry: vi.fn(),
  resolveRoles: vi.fn(),
  resolveBankAccountGlAccountInTx: vi.fn(),
  loadInvoiceForIssuance: vi.fn(),
  settings: {} as Record<string, unknown>,
  money: null as unknown,
  applications: [] as unknown[],
  invoiceRows: [{ id: 'inv_1' }] as unknown[],
}))

vi.mock('../../../ledger/setup/accounting-enabled', () => ({
  isAccountingEnabled: h.isAccountingEnabled,
}))
vi.mock('../../../ledger/setup/setup-readiness', () => ({ FINALIZED_SETUP_STATE: 'finalized' }))
vi.mock('../../../ledger/reads/list-postings', () => ({
  findLiveSubjectPosting: h.findLiveSubjectPosting,
}))
vi.mock('../../../ledger/periods/period-lock', () => ({ resolvePeriodLock: h.resolvePeriodLock }))
vi.mock('../../../ledger/post/auto-post', () => ({ readAutoPostMode: h.readAutoPostMode }))
vi.mock('../../../ledger/post/post-entry', () => ({ postEntry: h.postEntry }))
vi.mock('../../../ledger/roles/resolve-roles', () => ({ resolveRoles: h.resolveRoles }))
vi.mock('../../../ledger/chart/resolve-cash-account', () => ({
  resolveBankAccountGlAccountInTx: h.resolveBankAccountGlAccountInTx,
}))
vi.mock('../../../sales/invoices/issuance-reads', () => ({
  loadInvoiceForIssuance: h.loadInvoiceForIssuance,
}))
vi.mock('../../../../settings/read', () => ({
  readOrganizationSettings: async (_org: string, keys: readonly string[]) =>
    Object.fromEntries(keys.map((key) => [key, h.settings[key] ?? null])),
}))
vi.mock('@auxx/logger', () => ({
  createScopedLogger: () => ({ warn: vi.fn(), error: vi.fn(), info: vi.fn() }),
}))

import type { Database } from '@auxx/database'
import { acceptInvoiceReceiptAccounting } from '../receipt-accounting'

const ORG = 'org_1'
const MOVEMENT = 'mt_1'

function db(): Database {
  const chain: Record<string, unknown> = {}
  for (const method of ['from', 'innerJoin', 'where', 'limit']) chain[method] = () => chain
  // biome-ignore lint/suspicious/noThenProperty: a drizzle builder is thenable
  chain.then = (resolve: (rows: unknown[]) => unknown) =>
    Promise.resolve(h.invoiceRows).then(resolve)
  const tx = {
    select: () => chain,
    query: {
      MoneyTransaction: {
        findFirst: async () => h.money,
        findMany: async () => {
          const row = await h.money
          return row ? [row] : []
        },
      },
      MoneyApplication: { findMany: async () => h.applications },
    },
    update: () => ({ set: () => ({ where: async () => undefined }) }),
  }
  return {
    update: () => ({ set: () => ({ where: async () => undefined }) }),
    // `findLiveDraft`'s select chain on `db`: no draft is waiting.
    select: () => {
      const draftChain: Record<string, unknown> = {}
      for (const method of ['from', 'innerJoin', 'where', 'limit'])
        draftChain[method] = () => draftChain
      // biome-ignore lint/suspicious/noThenProperty: chainable drizzle query-builder stub
      draftChain.then = (resolve: (v: unknown) => unknown) => Promise.resolve([]).then(resolve)
      return draftChain
    },
    transaction: async <T>(fn: (t: unknown) => Promise<T>) => fn(tx),
  } as unknown as Database
}

const post = () =>
  acceptInvoiceReceiptAccounting(db(), { organizationId: ORG, moneyTransactionId: MOVEMENT })

function lines() {
  return h.postEntry.mock.calls[0]![1].entry.lines as Array<{
    accountRole?: string
    glAccountId?: string
    direction: string
    amount: number
  }>
}

beforeEach(() => {
  vi.clearAllMocks()
  h.isAccountingEnabled.mockResolvedValue(true)
  h.findLiveSubjectPosting.mockResolvedValue(ok(null))
  h.resolvePeriodLock.mockResolvedValue({ lockedThroughMonth: null })
  h.readAutoPostMode.mockResolvedValue('post')
  h.postEntry.mockResolvedValue({ status: 'posted', glPostingId: 'gl_1' })
  h.resolveRoles.mockResolvedValue(
    ok(new Map([['undeposited_funds', { glAccountId: 'gl_undep' }]]))
  )
  h.resolveBankAccountGlAccountInTx.mockResolvedValue('gl_bank')
  h.loadInvoiceForIssuance.mockResolvedValue({
    totalMinor: 12_000,
    contactInstanceId: 'ct_1',
    number: 'INV-1',
  })
  h.settings = {
    'accounting.setupState': 'finalized',
    'accounting.bookTimeZone': 'America/Los_Angeles',
    'accounting.cutoffPeriod': null,
  }
  h.invoiceRows = [{ id: 'inv_1' }]
  h.applications = [
    { id: 'ma_1', operation: 'apply', invoiceInstanceId: 'inv_1', amountMinor: 12_000n },
  ]
  h.money = {
    id: MOVEMENT,
    organizationId: ORG,
    purpose: 'customer_receipt',
    amountMinor: 12_000n,
    currency: 'USD',
    currencyExponent: 2,
    datePrecision: 'date',
    occurredOn: '2026-09-15',
    occurredAt: null,
    partyInstanceId: 'ct_1',
    cashAccountInstanceId: null,
    paymentGatewayId: null,
    method: 'check',
  }
})

describe('acceptInvoiceReceiptAccounting', () => {
  it('debits undeposited funds when the receipt names no endpoint', async () => {
    await expect(post()).resolves.toEqual({ status: 'accepted', glPostingId: 'gl_1' })
    expect(lines().map((l) => [l.glAccountId ?? l.accountRole, l.direction, l.amount])).toEqual([
      ['gl_undep', 'debit', 12_000],
      ['accounts_receivable', 'credit', 12_000],
    ])
    expect(h.postEntry.mock.calls[0]![1].railId).toBeNull()
  })

  it('debits the bank account the receipt names', async () => {
    ;(h.money as { cashAccountInstanceId: string }).cashAccountInstanceId = 'ba_1'
    await post()
    expect(lines()[0]!.glAccountId).toBe('gl_bank')
    expect(h.postEntry.mock.calls[0]![1].railId).toBeNull()
  })

  it("debits the rail's clearing account and scopes the posting to it", async () => {
    ;(h.money as { paymentGatewayId: string }).paymentGatewayId = 'pg_1'
    h.resolveRoles.mockResolvedValue(ok(new Map([['clearing', { glAccountId: 'gl_clearing' }]])))
    await post()
    expect(lines()[0]!.glAccountId).toBe('gl_clearing')
    const options = h.postEntry.mock.calls[0]![1]
    expect(options.railId).toBe('pg_1')
    expect(options.scope).toEqual({ rail: 'pg_1' })
  })

  it('names the invoice as parent and the invoice contact as counterparty', async () => {
    await post()
    expect(h.postEntry.mock.calls[0]![1].sources).toEqual([
      { sourceKind: 'money_transaction', sourceId: MOVEMENT, linkRole: 'subject' },
      { sourceKind: 'invoice', sourceId: 'inv_1', linkRole: 'parent' },
      { sourceKind: 'contact', sourceId: 'ct_1', linkRole: 'counterparty' },
    ])
  })

  it('credits A/R with the whole movement when only part of it is applied', async () => {
    h.applications = [
      { id: 'ma_1', operation: 'apply', invoiceInstanceId: 'inv_1', amountMinor: 6_000n },
    ]
    await expect(post()).resolves.toEqual({ status: 'accepted', glPostingId: 'gl_1' })
    expect(lines().map((l) => [l.glAccountId ?? l.accountRole, l.direction, l.amount])).toEqual([
      ['gl_undep', 'debit', 12_000],
      ['accounts_receivable', 'credit', 12_000],
    ])
  })

  it('posts an unapplied receipt to A/R with no parent and the party as counterparty', async () => {
    h.applications = []
    await expect(post()).resolves.toEqual({ status: 'accepted', glPostingId: 'gl_1' })
    expect(lines()[1]!.accountRole).toBe('accounts_receivable')
    expect(h.postEntry.mock.calls[0]![1].sources).toEqual([
      { sourceKind: 'money_transaction', sourceId: MOVEMENT, linkRole: 'subject' },
      { sourceKind: 'contact', sourceId: 'ct_1', linkRole: 'counterparty' },
    ])
  })
})
