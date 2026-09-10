// packages/lib/src/purchasing/expense-bill/__tests__/writes.test.ts
//
// The trigger, not the arithmetic - the builder has its own suite. Three rules:
//
//  1. **The ledger goes FIRST and a refused post refuses the transition.** A
//     bill marked `posted` whose entry never landed is a document asserting it
//     is in the books when it is not, and nothing downstream can tell.
//  2. **A void reverses BEFORE the status flips**, for the same reason with the
//     sign inverted, and a refused reversal refuses the void.
//  3. **The accounting date is the bill's own `billedAt`**, never today - the
//     field's registry description says outright that `createdAt` is routinely
//     a different period.
//
// The collaborators are stubbed at the module boundary rather than through a
// fake database: `postEntry` and `reverseEntry` have their own exhaustive
// suites, and re-driving them through a second fake here would test the fake.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  isAccountingEnabled: vi.fn(async () => true),
  bill: {} as Record<string, unknown>,
  lines: [] as unknown[],
  postEntry: vi.fn(),
  reverseEntry: vi.fn(),
  listPostingsForSource: vi.fn(),
  setValuesForEntity: vi.fn(),
}))

vi.mock('@auxx/database', async () => {
  const schema = await import('../../../../../database/src/db/schema/index')
  const enums = await import('../../../../../database/src/enums')
  return { schema, ...enums, database: {} }
})
vi.mock('../../../postings/accounting-enabled', () => ({
  isAccountingEnabled: h.isAccountingEnabled,
}))
vi.mock('../../../cache', () => ({
  getEntityDefIdResolver: async () => (type: string) => type,
}))
vi.mock('../../../postings/list-postings', () => ({
  listPostingsForSource: h.listPostingsForSource,
}))
vi.mock('../../../postings/period-lock', () => ({
  resolvePeriodLock: async () => ({ lockedThroughMonth: null }),
}))
vi.mock('../../../postings/post-entry', () => ({
  LEDGER_CURRENCY: 'USD',
  postEntry: h.postEntry,
  previewEntry: vi.fn(async () => ({ docNumber: 'AUXX-EXB-BILL0007', lines: [] })),
}))
vi.mock('../../../postings/reverse-entry', () => ({ reverseEntry: h.reverseEntry }))
vi.mock('../../../settings/settings-service', () => ({
  getOrganizationSetting: async () => null,
}))
vi.mock('../../../field-values/field-value-service', () => ({
  FieldValueService: class {
    setValuesForEntity = h.setValuesForEntity
  },
}))
vi.mock('../reads', () => ({
  requireVendorBill: async () => h.bill,
  loadVendorBillLines: async () => h.lines,
}))

import type { Database } from '@auxx/database'
import { BadRequestError } from '../../../errors'
import { postExpenseBill, previewExpenseBill, voidExpenseBill } from '../writes'

const ORG = 'org_1'
const USER = 'user_1'
const BILL_ID = 'ei_bill_1'
const db = {} as Database

/** What was written to the bill in the last `setValuesForEntity` call. */
function lastWrite(): Array<{ fieldId: string; value: unknown }> {
  const call = h.setValuesForEntity.mock.calls.at(-1)?.[0] as
    | { values: Array<{ fieldId: string; value: unknown }> }
    | undefined
  return call?.values ?? []
}

beforeEach(() => {
  vi.clearAllMocks()
  h.isAccountingEnabled.mockResolvedValue(true)
  h.bill = {
    id: BILL_ID,
    number: 'RENT-SEP',
    internalNumber: 'BILL-0007',
    status: 'draft',
    billedAt: '2026-09-01',
    currency: 'USD',
    totalMinor: 250_000,
    vendorCompanyInstanceId: 'ei_company_1',
    lineIds: ['l1'],
  }
  h.lines = [
    {
      id: 'l1',
      description: 'September rent',
      lineTotalMinor: 250_000,
      glAccountId: 'ei_acct_rent',
      sortOrder: 0,
    },
  ]
  h.postEntry.mockResolvedValue({
    status: 'posted',
    glPostingId: 'gp_1',
    docNumber: 'AUXX-EXB-BILL0007',
  })
  h.reverseEntry.mockResolvedValue({ status: 'posted', glPostingId: 'gp_2' })
  h.listPostingsForSource.mockResolvedValue({ isErr: () => false, isOk: () => true, value: [] })
})

describe('postExpenseBill', () => {
  it('posts the entry and flips the bill to posted', async () => {
    const result = await postExpenseBill(db, {
      organizationId: ORG,
      userId: USER,
      vendorBillInstanceId: BILL_ID,
    })

    expect(result.post.status).toBe('posted')
    expect(result.totalMinor).toBe(250_000)
    expect(lastWrite()).toContainEqual({ fieldId: 'vendor_bill_status', value: 'posted' })
  })

  it('hands the poster an expense_bill entry keyed on the bill INTERNAL number', async () => {
    await postExpenseBill(db, {
      organizationId: ORG,
      userId: USER,
      vendorBillInstanceId: BILL_ID,
    })

    const entry = h.postEntry.mock.calls[0]?.[1]?.entry
    expect(entry.postingType).toBe('expense_bill')
    // 🛑 Never `vendor_bill_number` ('RENT-SEP'), which two vendors may share -
    // two bills on one period key converge to `already_posted` and the loser's
    // payable is never recorded.
    expect(entry.periodKey).toBe('BILL-0007')
    expect(entry.txnDate).toBe('2026-09-01')
  })

  it('refuses the transition when the ledger refuses the entry, leaving the bill alone', async () => {
    h.postEntry.mockResolvedValue({
      status: 'period_closed',
      error: 'August is locked',
    })

    await expect(
      postExpenseBill(db, { organizationId: ORG, userId: USER, vendorBillInstanceId: BILL_ID })
    ).rejects.toThrow(/August is locked/)
    expect(h.setValuesForEntity).not.toHaveBeenCalled()
  })

  it('still posts the document when the org has never enabled accounting', async () => {
    h.isAccountingEnabled.mockResolvedValue(false)

    const result = await postExpenseBill(db, {
      organizationId: ORG,
      userId: USER,
      vendorBillInstanceId: BILL_ID,
    })

    expect(result.post.status).toBe('not_enabled')
    expect(h.postEntry).not.toHaveBeenCalled()
    expect(lastWrite()).toContainEqual({ fieldId: 'vendor_bill_status', value: 'posted' })
  })

  it('stamps the accounting date it used when the bill carried none', async () => {
    h.bill = { ...h.bill, billedAt: null }

    await postExpenseBill(db, {
      organizationId: ORG,
      userId: USER,
      vendorBillInstanceId: BILL_ID,
      billedAt: '2026-08-31',
    })

    expect(lastWrite()).toContainEqual({
      fieldId: 'vendor_bill_billed_at',
      value: '2026-08-31T12:00:00.000Z',
    })
  })

  it('refuses a bill that is already posted', async () => {
    h.bill = { ...h.bill, status: 'posted' }
    await expect(
      postExpenseBill(db, { organizationId: ORG, userId: USER, vendorBillInstanceId: BILL_ID })
    ).rejects.toThrow(BadRequestError)
  })

  it('refuses a bill with no vendor - the payable would fail every export', async () => {
    h.bill = { ...h.bill, vendorCompanyInstanceId: null }
    await expect(
      postExpenseBill(db, { organizationId: ORG, userId: USER, vendorBillInstanceId: BILL_ID })
    ).rejects.toThrow(/no vendor/)
    expect(h.postEntry).not.toHaveBeenCalled()
  })

  it('refuses a bill with no internal reference to key the claim on', async () => {
    h.bill = { ...h.bill, internalNumber: '' }
    await expect(
      postExpenseBill(db, { organizationId: ORG, userId: USER, vendorBillInstanceId: BILL_ID })
    ).rejects.toThrow(/internal reference/)
  })

  it('refuses a bill with no lines', async () => {
    h.lines = []
    await expect(
      postExpenseBill(db, { organizationId: ORG, userId: USER, vendorBillInstanceId: BILL_ID })
    ).rejects.toThrow(/at least one line/)
  })

  it('surfaces the builder refusal for an uncoded line, naming it', async () => {
    h.lines = [
      {
        id: 'l1',
        description: 'September rent',
        lineTotalMinor: 250_000,
        glAccountId: null,
        sortOrder: 0,
      },
    ]
    await expect(
      postExpenseBill(db, { organizationId: ORG, userId: USER, vendorBillInstanceId: BILL_ID })
    ).rejects.toThrow(/September rent/)
    expect(h.postEntry).not.toHaveBeenCalled()
  })
})

describe('previewExpenseBill', () => {
  it('runs the same refusals and writes nothing', async () => {
    h.bill = { ...h.bill, status: 'paid' }
    await expect(
      previewExpenseBill(db, { organizationId: ORG, userId: USER, vendorBillInstanceId: BILL_ID })
    ).rejects.toThrow(BadRequestError)
    expect(h.setValuesForEntity).not.toHaveBeenCalled()
  })
})

describe('voidExpenseBill', () => {
  beforeEach(() => {
    h.bill = { ...h.bill, status: 'posted' }
    h.listPostingsForSource.mockResolvedValue({
      isErr: () => false,
      isOk: () => true,
      value: [
        {
          id: 'gp_1',
          docNumber: 'AUXX-EXB-BILL0007',
          status: 'posted',
          postingType: 'expense_bill',
        },
      ],
    })
  })

  it('reverses the entry, then sets void', async () => {
    await voidExpenseBill(db, {
      organizationId: ORG,
      userId: USER,
      vendorBillInstanceId: BILL_ID,
    })

    expect(h.reverseEntry).toHaveBeenCalledWith(
      db,
      expect.objectContaining({ glPostingId: 'gp_1' })
    )
    expect(lastWrite()).toContainEqual({ fieldId: 'vendor_bill_status', value: 'void' })
  })

  it('refuses the void when the reversal is refused, leaving the bill posted', async () => {
    h.reverseEntry.mockResolvedValue({ status: 'period_closed', error: 'September is locked' })

    await expect(
      voidExpenseBill(db, { organizationId: ORG, userId: USER, vendorBillInstanceId: BILL_ID })
    ).rejects.toThrow(/could not be reversed/)
    expect(h.setValuesForEntity).not.toHaveBeenCalled()
  })

  it('leaves an already-reversed entry alone rather than reversing it twice', async () => {
    h.listPostingsForSource.mockResolvedValue({
      isErr: () => false,
      isOk: () => true,
      value: [
        {
          id: 'gp_1',
          docNumber: 'AUXX-EXB-BILL0007',
          status: 'reversed',
          postingType: 'expense_bill',
        },
      ],
    })

    await voidExpenseBill(db, {
      organizationId: ORG,
      userId: USER,
      vendorBillInstanceId: BILL_ID,
    })

    expect(h.reverseEntry).not.toHaveBeenCalled()
    expect(lastWrite()).toContainEqual({ fieldId: 'vendor_bill_status', value: 'void' })
  })

  it('refuses to void a bill that has been paid', async () => {
    h.bill = { ...h.bill, status: 'paid' }
    await expect(
      voidExpenseBill(db, { organizationId: ORG, userId: USER, vendorBillInstanceId: BILL_ID })
    ).rejects.toThrow(/money has already moved/)
  })
})
