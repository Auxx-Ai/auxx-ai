// packages/lib/src/money/customer-money/__tests__/accounting.test.ts

import { describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  acceptEntryInTx: vi.fn(),
  appendCustomerReceiptWorkBasisInTx: vi.fn(),
  captureCustomerReceiptWorkInTx: vi.fn(),
  deliverAccountingPosting: vi.fn(),
  getOrganizationSetting: vi.fn(),
  isAccountingEnabled: vi.fn(),
  listCustomerReceiptAccountingCandidates: vi.fn(),
  readCustomerReceiptAccountingSource: vi.fn(),
  readOrderRecognitionFactsInTx: vi.fn(),
  readOrderRecognitionSource: vi.fn(),
  resolveAccountLines: vi.fn(),
  resolveRoles: vi.fn(),
  resolveFulfillmentDeliveryIntentInTx: vi.fn(),
  planAccountingDeliveryInTx: vi.fn(),
}))

vi.mock('../../../postings/accept-entry', () => ({ acceptEntryInTx: h.acceptEntryInTx }))
vi.mock('../../../postings/accounting-commit-lock', () => ({
  withAccountingCommitLock: vi.fn(async () => undefined),
}))
vi.mock('../../../postings/accounting-enabled', () => ({
  isAccountingEnabled: h.isAccountingEnabled,
}))
vi.mock('../../../postings/book-connections', () => ({
  resolveFulfillmentDeliveryIntentInTx: h.resolveFulfillmentDeliveryIntentInTx,
}))
vi.mock('../../../postings/delivery', () => ({
  deliverAccountingPosting: h.deliverAccountingPosting,
  planAccountingDeliveryInTx: h.planAccountingDeliveryInTx,
}))
vi.mock('../../../postings/effect-work', () => ({
  appendCustomerReceiptWorkBasisInTx: h.appendCustomerReceiptWorkBasisInTx,
  captureCustomerReceiptWorkInTx: h.captureCustomerReceiptWorkInTx,
}))
vi.mock('../../../postings/resolve-roles', () => ({
  resolveAccountLines: h.resolveAccountLines,
  resolveRoles: h.resolveRoles,
}))
vi.mock('../../../postings/setup-readiness', () => ({ FINALIZED_SETUP_STATE: 'finalized' }))
vi.mock('../../../settings/settings-service', () => ({
  getOrganizationSetting: h.getOrganizationSetting,
}))
vi.mock('../receipt-accounting', () => ({
  listCustomerReceiptAccountingCandidates: h.listCustomerReceiptAccountingCandidates,
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

import { UnprocessableEntityError } from '../../../errors'
import { postCustomerReceiptAccounting } from '../accounting'

const organizationId = 'org_1'
const moneyTransactionId = 'money_1'

function chain<T>(value: T) {
  const query = {
    from: () => query,
    innerJoin: () => query,
    where: async () => value,
  }
  return query
}

function db(existing: unknown[] = [], workState?: { current: unknown }) {
  const tx = {
    select: vi.fn(() => chain(existing)),
    query: {
      AccountingWork: {
        findFirst: vi.fn(async () => workState?.current),
      },
      AccountingEffect: { findFirst: vi.fn(async () => undefined) },
    },
    update: vi.fn(() => ({
      set: () => ({ where: async () => [] }),
    })),
  }
  return { transaction: async <T>(fn: (transaction: typeof tx) => Promise<T>) => fn(tx), tx }
}

function setup() {
  vi.clearAllMocks()
  h.isAccountingEnabled.mockResolvedValue(true)
  h.getOrganizationSetting.mockImplementation(async ({ key }: { key: string }) => {
    if (key === 'accounting.bookTimeZone') return 'America/Los_Angeles'
    if (key === 'accounting.setupState') return 'finalized'
    if (key === 'accounting.fulfillmentPosting') return 'auto'
    return null
  })
  h.resolveFulfillmentDeliveryIntentInTx.mockResolvedValue({ kind: 'not_required' })
  h.resolveRoles.mockResolvedValue({
    isErr: () => false,
    value: new Map([
      [
        'clearing',
        {
          glAccountId: 'gl_clearing',
          code: null,
          name: 'Clearing',
          accountType: 'asset',
          isActive: true,
        },
      ],
    ]),
  })
  h.resolveAccountLines.mockImplementation(async (_tx, _org, lines) => ({
    isErr: () => false,
    value: lines.map((line: { glAccountId?: string; accountRole?: string }) => {
      const accountRole = line.accountRole
      return {
        glAccountId: line.glAccountId ?? `resolved_${accountRole}`,
        code: null,
        name: line.glAccountId ?? accountRole ?? 'account',
        accountType:
          line.glAccountId || accountRole === 'accounts_receivable' ? 'asset' : 'liability',
        isActive: true,
      }
    }),
  }))
  h.acceptEntryInTx.mockResolvedValue({ status: 'accepted', glPostingId: 'posting_1' })
  h.captureCustomerReceiptWorkInTx.mockResolvedValue({
    work: { id: 'work_1', state: 'pending', basisVersion: 1 },
  })
  h.appendCustomerReceiptWorkBasisInTx.mockResolvedValue({ version: 1 })
  h.planAccountingDeliveryInTx.mockResolvedValue(undefined)
  h.deliverAccountingPosting.mockResolvedValue(undefined)
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

describe('postCustomerReceiptAccounting', () => {
  it('returns the immutable journal without rereading source evidence on retry', async () => {
    setup()
    const database = db([{ glPostingId: 'posting_existing' }])

    await expect(
      postCustomerReceiptAccounting(database as never, { organizationId, moneyTransactionId })
    ).resolves.toEqual({ status: 'accepted', glPostingId: 'posting_existing' })
    expect(h.readCustomerReceiptAccountingSource).not.toHaveBeenCalled()
    expect(h.acceptEntryInTx).not.toHaveBeenCalled()
  })

  it('captures a durable blocked work item when source evidence is incomplete', async () => {
    setup()
    const database = db()
    h.readCustomerReceiptAccountingSource.mockRejectedValue(
      new UnprocessableEntityError('Receipt processor route is unresolved')
    )

    await expect(
      postCustomerReceiptAccounting(database as never, { organizationId, moneyTransactionId })
    ).resolves.toEqual({ status: 'blocked', reason: 'Receipt processor route is unresolved' })
    expect(h.captureCustomerReceiptWorkInTx).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        organizationId,
        moneyTransactionId,
        basis: expect.objectContaining({ status: 'incomplete' }),
      })
    )
    expect(database.tx.update).toHaveBeenCalled()
  })

  it('retries blocked work after source repair and accepts the repaired basis', async () => {
    setup()
    const state: { current: unknown } = { current: undefined }
    const database = db([], state)
    h.captureCustomerReceiptWorkInTx.mockImplementation(async () => {
      state.current = { id: 'work_1', state: 'blocked', basisVersion: 1 }
      return { work: state.current }
    })
    h.readCustomerReceiptAccountingSource.mockRejectedValueOnce(
      new UnprocessableEntityError('Receipt processor route is unresolved')
    )

    await expect(
      postCustomerReceiptAccounting(database as never, { organizationId, moneyTransactionId })
    ).resolves.toMatchObject({ status: 'blocked' })

    prepareRecognition(120n, '100', '0', '20')
    h.appendCustomerReceiptWorkBasisInTx.mockResolvedValue({ version: 2 })
    await expect(
      postCustomerReceiptAccounting(database as never, { organizationId, moneyTransactionId })
    ).resolves.toEqual({ status: 'accepted', glPostingId: 'posting_1' })
    expect(h.appendCustomerReceiptWorkBasisInTx).toHaveBeenCalledOnce()
    expect(h.acceptEntryInTx).toHaveBeenCalledOnce()
  })

  it.each([
    [
      'full advance',
      120n,
      '100',
      '0',
      '20',
      ['gl_clearing:debit:120', 'customer_deposits:credit:100', 'sales_tax_payable:credit:20'],
    ],
    [
      'partial advance',
      60n,
      '50',
      '0',
      '10',
      ['gl_clearing:debit:60', 'customer_deposits:credit:50', 'sales_tax_payable:credit:10'],
    ],
    [
      'after shipment',
      60n,
      '0',
      '50',
      '10',
      ['gl_clearing:debit:60', 'accounts_receivable:credit:50', 'sales_tax_payable:credit:10'],
    ],
  ])('builds the %s journal from its numeric recognition allocation', async (_name, amount, deposit, receivable, tax, expected) => {
    setup()
    prepareRecognition(amount, deposit, receivable, tax)
    const database = db()

    await expect(
      postCustomerReceiptAccounting(database as never, { organizationId, moneyTransactionId })
    ).resolves.toEqual({ status: 'accepted', glPostingId: 'posting_1' })
    const entry = h.acceptEntryInTx.mock.calls[0]![1].entry as {
      lines: Array<{
        glAccountId?: string
        accountRole?: string
        direction: string
        amount: number
      }>
    }
    expect(
      entry.lines.map(
        (line) => `${line.glAccountId ?? line.accountRole}:${line.direction}:${line.amount}`
      )
    ).toEqual(expected)
    expect(h.acceptEntryInTx).toHaveBeenCalledOnce()
    expect(h.planAccountingDeliveryInTx).toHaveBeenCalledOnce()
    const acceptedBasis = h.acceptEntryInTx.mock.calls[0]![1].members[0].acceptedBasis
    expect(acceptedBasis.policyKey).toBe('shopify_receipt_v1')
    expect(acceptedBasis.calculation.allocation.taxMinor).toBe(tax)
    if (_name === 'full advance') {
      const revalidate = h.acceptEntryInTx.mock.calls[0]![2].revalidateMemberInTx
      await expect(revalidate({}, { basisVersion: 1 })).resolves.toMatchObject({
        policyKey: 'shopify_receipt_v1',
      })
      expect(h.readCustomerReceiptAccountingSource).toHaveBeenCalledTimes(2)
    }
  })

  it('blocks a receipt whose source supplies an invalid accounting date before acceptance', async () => {
    setup()
    prepareRecognition(120n, '100', '0', '20')
    h.readCustomerReceiptAccountingSource.mockResolvedValue({
      ...receiptSource(120n),
      effectiveDate: '2026-99-99',
    })

    const database = db()
    await expect(
      postCustomerReceiptAccounting(database as never, { organizationId, moneyTransactionId })
    ).resolves.toMatchObject({ status: 'blocked' })
    expect(h.acceptEntryInTx).not.toHaveBeenCalled()
    expect(h.captureCustomerReceiptWorkInTx).toHaveBeenCalled()
  })
})
