// packages/lib/src/accounting/sales/credit-memos/__tests__/writes.test.ts
//
// One lane: `issueCreditMemo` posts through `postCreditMemoEntry`, and
// `voidCreditMemo` reverses through `reverseCreditMemoEntry`. There is no stamp
// field and no batch member to refuse (MIGRATION.md step 1b).

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  isAccountingActive: vi.fn(async () => true),
  memo: {} as Record<string, unknown>,
  lines: [] as unknown[],
  readShipped: vi.fn(async () => new Set<string>(['line_1'])),
  buildCreditMemoEntry: vi.fn(),
  postCreditMemoEntry: vi.fn(),
  reverseCreditMemoEntry: vi.fn(),
  setValuesForEntity: vi.fn(),
  settleCreditMemo: vi.fn(async () => ({ status: 'issued' })),
  recomputeTotals: vi.fn(async () => {}),
  sumCreditMemoApplications: vi.fn(async () => 0),
  sumSucceededCreditMemoRefunds: vi.fn(async () => 0),
  readEditStamp: vi.fn(async (): Promise<{ openedAt: string; byUserId: string } | null> => null),
  pendingItems: vi.fn(
    async (_db: unknown, _org: string, _input: unknown): Promise<unknown[]> => []
  ),
  moneyPending: null as boolean | null,
  orderLineIds: [] as string[],
}))

// 101 E9's readiness reads: the connector items around the memo, the money flag, and
// the order's line items.
vi.mock('../../../../data-connectors/pending-items', () => ({
  listPendingItemsAround: h.pendingItems,
}))
vi.mock('../../../../resources/system-records', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../resources/system-records')>()),
  systemDefId: async (_db: unknown, _org: string, type: string) => `def_${type}`,
  systemFields: async (_db: unknown, _org: string, type: string, attrs: readonly string[]) => ({
    defId: `def_${type}`,
    fields: Object.fromEntries(attrs.map((attr) => [attr, { id: attr }])),
  }),
  readSystemRecords: async (
    _db: unknown,
    _org: string,
    _ctx: unknown,
    options: { ids?: string[]; by?: unknown }
  ) =>
    options.by
      ? h.orderLineIds.map((id) => ({ id }))
      : (options.ids ?? []).map((id) => ({ id, boolean: () => h.moneyPending })),
}))

vi.mock('../../../ledger/setup/book-time-zone', () => ({
  readBookTimeZoneOrUtc: async () => 'UTC',
  todayInBookTimeZone: async () => '2026-09-01',
}))

vi.mock('@auxx/database', async () => {
  const schema = await import('../../../../../../database/src/db/schema/index')
  const enums = await import('../../../../../../database/src/enums')
  return { schema, ...enums, database: {} }
})
vi.mock('../../../ledger/setup/accounting-enabled', () => ({
  isAccountingActive: h.isAccountingActive,
}))
vi.mock('../../../../cache', () => ({
  getEntityDefIdResolver: async () => (type: string) => type,
  getOrgCache: () => ({ from: () => ({ bySystemAttributes: async () => ({}) }) }),
}))
vi.mock('../../../ledger/builders/credit-memo', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../ledger/builders/credit-memo')>()),
  buildCreditMemoEntry: h.buildCreditMemoEntry,
}))
vi.mock('../../../ledger/post/post-entry', () => ({
  LEDGER_CURRENCY: 'USD',
  previewEntry: vi.fn(),
}))
// Partial: `buildEntryForCreditMemo` and `organizationCurrency` are the real
// ones — the builder they call is mocked above, which is what these tests read.
vi.mock('../accounting', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../accounting')>()),
  postCreditMemoEntry: h.postCreditMemoEntry,
  reverseCreditMemoEntry: h.reverseCreditMemoEntry,
}))
vi.mock('../../../../settings/settings-service', () => ({
  getOrganizationSetting: async () => null,
}))
vi.mock('../../../../settings/read', () => ({
  readOrganizationSettings: async () => ({ 'accounting.cutoffPeriod': '2026-01' }),
}))
vi.mock('../../../../field-values/field-value-service', () => ({
  FieldValueService: class {
    setValuesForEntity = h.setValuesForEntity
  },
}))
vi.mock('../../totals/totals-hooks', () => ({ recomputeTotals: h.recomputeTotals }))
vi.mock('../command', () => ({
  runCreditCommand: async (
    db: unknown,
    _input: unknown,
    execute: (tx: unknown) => Promise<unknown>
  ) => execute(db),
}))
vi.mock('../reads', () => ({
  requireCreditMemo: async () => h.memo,
  loadCreditMemoLines: async () => h.lines,
  readShippedMemoLineIds: h.readShipped,
  loadInvoiceForCredit: vi.fn(),
  loadInvoiceLinesForCredit: vi.fn(),
  sumCreditMemoApplications: h.sumCreditMemoApplications,
  sumSucceededCreditMemoRefunds: h.sumSucceededCreditMemoRefunds,
  sumReservedCreditMemoRefunds: async () =>
    h.memo.source === 'channel' ? h.memo.amountRefundedMinor : h.sumSucceededCreditMemoRefunds(),
}))
vi.mock('../../../../entity-instances/edit-snapshot', () => ({
  readEditStamp: h.readEditStamp,
}))
vi.mock('../settle', () => ({
  CREDIT_MEMO_STATUS_BYPASS: new Set(['credit_memo_status']),
  settleCreditMemo: h.settleCreditMemo,
}))

import type { Database } from '@auxx/database'
import { AuxxError } from '../../../../errors'
import { refusalFromError } from '../../../work-items/refusal'
import { issueCreditMemo, voidCreditMemo } from '../writes'

const ORG = 'org_1'
const USER = 'user_1'
const MEMO_ID = 'cm_1'
const db = {} as Database
const input = { organizationId: ORG, userId: USER, creditMemoInstanceId: MEMO_ID }

beforeEach(() => {
  vi.clearAllMocks()
  h.isAccountingActive.mockResolvedValue(true)
  h.memo = {
    id: MEMO_ID,
    number: 'CM-0001',
    status: 'draft',
    source: 'native',
    reason: null,
    issuedAt: '2026-09-01',
    note: null,
    contactInstanceId: 'contact_1',
    invoiceInstanceId: null,
    orderInstanceId: null,
    subtotalMinor: 100_00,
    taxTotalMinor: 0,
    totalMinor: 100_00,
    amountAppliedMinor: 0,
    amountRefundedMinor: 0,
    balanceMinor: 100_00,
    lineIds: ['line_1'],
    hasSettlementFields: true,
  }
  h.lines = [
    {
      id: 'line_1',
      description: 'Widget',
      qty: 1,
      unitPriceMinor: 100_00,
      subtotalMinor: 100_00,
      taxTotalMinor: null,
      disposition: null,
      lineItemInstanceId: 'li_1',
      sortOrder: 0,
    },
  ]
  h.readShipped.mockResolvedValue(new Set(['line_1']))
  h.buildCreditMemoEntry.mockReturnValue({
    entry: { postingType: 'credit_memo', periodKey: 'CM-0001', txnDate: '2026-09-01', lines: [] },
  })
  h.postCreditMemoEntry.mockResolvedValue({
    status: 'posted',
    glPostingId: 'gl_1',
    docNumber: 'CM-0001',
  })
  h.reverseCreditMemoEntry.mockResolvedValue({ status: 'posted', glPostingId: 'gl_rev' })
  h.settleCreditMemo.mockResolvedValue({ status: 'issued' })
  h.sumCreditMemoApplications.mockResolvedValue(0)
  h.sumSucceededCreditMemoRefunds.mockResolvedValue(0)
  h.pendingItems.mockResolvedValue([])
  h.moneyPending = null
  h.orderLineIds = []
})

describe('issueCreditMemo', () => {
  it('posts one entry with the memo and its contact, and returns its ids', async () => {
    const result = await issueCreditMemo(db, input)

    expect(h.postCreditMemoEntry).toHaveBeenCalledTimes(1)
    expect(h.postCreditMemoEntry.mock.calls[0]![1]).toMatchObject({
      organizationId: ORG,
      creditMemoInstanceId: MEMO_ID,
      contactInstanceId: 'contact_1',
      orderInstanceId: null,
    })
    expect(result.postingId).toBe('gl_1')
    expect(result.docNumber).toBe('CM-0001')
  })

  it('writes the status with no posting stamp beside it', async () => {
    await issueCreditMemo(db, input)

    const write = h.setValuesForEntity.mock.calls[0]![0]
    expect(write.values).toEqual([{ fieldId: 'credit_memo_status', value: 'issued' }])
  })

  it('refuses the issue when the ledger refuses the entry', async () => {
    h.postCreditMemoEntry.mockResolvedValueOnce({
      status: 'unbalanced',
      error: 'The entry does not balance',
    })

    await expect(issueCreditMemo(db, input)).rejects.toThrow('could not be posted')
    expect(h.setValuesForEntity).not.toHaveBeenCalled()
  })

  // accounting is opt-in (task 17 §3): nothing is built, and nothing is posted.
  it('issues without building or posting when accounting is off', async () => {
    h.isAccountingActive.mockResolvedValue(false)

    const result = await issueCreditMemo(db, input)

    expect(h.buildCreditMemoEntry).not.toHaveBeenCalled()
    expect(h.postCreditMemoEntry).not.toHaveBeenCalled()
    expect(h.readShipped).not.toHaveBeenCalled()
    expect(result.postingId).toBeNull()
  })

  it('refuses a memo with no number before anything is written', async () => {
    h.memo.number = ''

    await expect(issueCreditMemo(db, input)).rejects.toThrow('has no number yet')
    expect(h.setValuesForEntity).not.toHaveBeenCalled()
  })
})

describe('the channel memo entry (91 D4)', () => {
  beforeEach(() => {
    h.memo.source = 'channel'
    h.memo.orderInstanceId = 'order_1'
  })

  it('issues without waiting on its order, carrying no money leg (71 D6)', async () => {
    h.memo.amountRefundedMinor = 100_00

    await issueCreditMemo(db, input)

    expect(h.buildCreditMemoEntry).toHaveBeenCalledOnce()
    const built = h.buildCreditMemoEntry.mock.calls[0]![0]
    expect(built).not.toHaveProperty('settlement')
    expect(built.lines).toEqual([
      { subtotal: 100_00, taxTotal: null, shipped: true, component: 'goods' },
    ])
    expect(h.readShipped).toHaveBeenCalledWith(
      expect.anything(),
      ORG,
      expect.objectContaining({ source: 'channel' }),
      h.lines,
      '2026-09-01'
    )
    expect(h.postCreditMemoEntry).toHaveBeenCalledOnce()
  })

  it('issues a memo whose lines never shipped with no entry at all', async () => {
    h.readShipped.mockResolvedValue(new Set())

    const result = await issueCreditMemo(db, input)

    expect(h.buildCreditMemoEntry).not.toHaveBeenCalled()
    expect(h.postCreditMemoEntry).not.toHaveBeenCalled()
    expect(result.postingId).toBeNull()
    const write = h.setValuesForEntity.mock.calls[0]![0]
    expect(write.values).toEqual([{ fieldId: 'credit_memo_status', value: 'issued' }])
  })
})

describe('a channel memo issues only once its own payload is complete (101 E9)', () => {
  beforeEach(() => {
    h.memo.source = 'channel'
    h.memo.orderInstanceId = 'order_1'
    h.orderLineIds = ['oli_1', 'oli_2']
  })

  const pendingOn = (recordId: string, fieldKey: string) => ({
    itemId: `item_${recordId}`,
    dataConnectorId: 'dc_1',
    connectorName: 'Shopify',
    entityDefinitionId: 'def_x',
    entityInstanceId: recordId,
    pendingRelations: [{ fieldKey, targetDef: 'def_y', targetExternalId: 'ext_1' }],
  })

  async function refusal() {
    const error = await issueCreditMemo(db, input).then(
      () => null,
      (e: unknown) => e
    )
    expect(error).toBeInstanceOf(AuxxError)
    return { error: error as AuxxError, refusal: refusalFromError(error) }
  }

  it.each([
    ['itself', MEMO_ID, 'credit_memo_order'],
    ['a line', 'line_1', 'credit_memo_line_credit_memo'],
    ['its order', 'order_1', 'order_contact'],
    ['an order line item', 'oli_2', 'line_item_order'],
  ])('a pending relation on %s refuses as MEMO_INPUT_INCOMPLETE, nothing built', async (_, recordId, fieldKey) => {
    h.pendingItems.mockResolvedValue([pendingOn(recordId, fieldKey)])

    const { error, refusal: parked } = await refusal()

    expect(error.message).toBe(
      'Its data from Shopify is not complete yet. It issues when the sync links it.'
    )
    expect(parked).toEqual({
      reasonCode: 'MEMO_INPUT_INCOMPLETE',
      detail: {
        connector: 'Shopify',
        pendingRelations: [{ recordId, fieldKey, targetExternalId: 'ext_1' }],
      },
    })
    expect(h.readShipped).not.toHaveBeenCalled()
    expect(h.buildCreditMemoEntry).not.toHaveBeenCalled()
    expect(h.postCreditMemoEntry).not.toHaveBeenCalled()
    expect(h.setValuesForEntity).not.toHaveBeenCalled()
  })

  it('asks about the memo, its lines, its order and the order line items', async () => {
    await issueCreditMemo(db, input)

    expect(h.pendingItems).toHaveBeenCalledWith(expect.anything(), ORG, {
      instanceIds: [MEMO_ID, 'line_1', 'order_1', 'oli_1', 'oli_2'],
      pointingFromDefIds: ['def_credit_memo', 'def_credit_memo_line', 'def_line_item'],
    })
  })

  it('a refund whose money is still pending is not ready', async () => {
    h.moneyPending = true

    const { error, refusal: parked } = await refusal()

    expect(error.message).toContain('still pending')
    expect(parked).toEqual({ reasonCode: 'MEMO_INPUT_INCOMPLETE', detail: { moneyPending: true } })
    expect(h.postCreditMemoEntry).not.toHaveBeenCalled()
  })

  it('issues once every relation resolved and the money settled', async () => {
    h.moneyPending = false

    await issueCreditMemo(db, input)

    expect(h.postCreditMemoEntry).toHaveBeenCalledOnce()
  })

  it('a native memo with no lines still refuses as line-less, without the readiness read', async () => {
    h.memo.source = 'native'
    h.memo.lineIds = []
    h.lines = []

    await expect(issueCreditMemo(db, input)).rejects.toThrow('at least one line')
    expect(h.pendingItems).not.toHaveBeenCalled()
  })
})

describe('voidCreditMemo', () => {
  beforeEach(() => {
    h.memo.status = 'issued'
    h.memo.source = 'channel'
  })

  it('reverses the memo posting, then sets void', async () => {
    await voidCreditMemo(db, input)

    expect(h.reverseCreditMemoEntry).toHaveBeenCalledTimes(1)
    expect(h.setValuesForEntity).toHaveBeenCalledTimes(1)
    const write = h.setValuesForEntity.mock.calls[0]![0]
    expect(write.values).toEqual([{ fieldId: 'credit_memo_status', value: 'void' }])
  })

  it('voids an unposted memo, because there is nothing standing to reverse', async () => {
    h.reverseCreditMemoEntry.mockResolvedValue(null)

    await voidCreditMemo(db, input)

    expect(h.setValuesForEntity).toHaveBeenCalledTimes(1)
  })

  it('refuses the void when the reversal is refused', async () => {
    h.reverseCreditMemoEntry.mockResolvedValue({
      status: 'unbalanced',
      error: 'The entry does not balance',
    })

    await expect(voidCreditMemo(db, input)).rejects.toThrow('could not be reversed')
    expect(h.setValuesForEntity).not.toHaveBeenCalled()
  })

  it('refuses a refunded memo before it touches the ledger', async () => {
    h.memo.amountRefundedMinor = 50_00

    await expect(voidCreditMemo(db, input)).rejects.toThrow('has a completed or pending refund')
    expect(h.reverseCreditMemoEntry).not.toHaveBeenCalled()
  })

  it('refuses an applied memo before it touches the ledger', async () => {
    h.sumCreditMemoApplications.mockResolvedValue(25_00)

    await expect(voidCreditMemo(db, input)).rejects.toThrow('Unapply this credit memo')
    expect(h.reverseCreditMemoEntry).not.toHaveBeenCalled()
  })

  it('refuses a memo with an open edit, before it touches the ledger', async () => {
    h.readEditStamp.mockResolvedValueOnce({ openedAt: '2026-09-19T10:00:00.000Z', byUserId: USER })

    await expect(voidCreditMemo(db, input)).rejects.toThrow('open for editing')
    expect(h.reverseCreditMemoEntry).not.toHaveBeenCalled()
    expect(h.setValuesForEntity).not.toHaveBeenCalled()
  })

  it('refuses an already-void memo', async () => {
    h.memo.status = 'void'

    await expect(voidCreditMemo(db, input)).rejects.toThrow('is already void')
  })

  it('voids a channel draft with no reversal at all', async () => {
    h.memo.status = 'draft'

    await voidCreditMemo(db, input)

    expect(h.reverseCreditMemoEntry).not.toHaveBeenCalled()
    expect(h.setValuesForEntity).toHaveBeenCalledTimes(1)
  })
})
