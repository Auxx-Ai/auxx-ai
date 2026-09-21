// packages/lib/src/accounting/purchasing/expense-bill/__tests__/writes.test.ts
//
// The trigger, not the arithmetic - the builder has its own suite. Four rules:
//
//  1. **The ledger goes FIRST and a refused post refuses the transition.** A
//     bill marked `posted` whose entry never landed is a document asserting it
//     is in the books when it is not, and nothing downstream can tell.
//  2. **A void reverses BEFORE the status flips**, for the same reason with the
//     sign inverted, and a refused reversal refuses the void.
//  3. **The accounting date is the bill's own `billedAt`**, never today - the
//     field's registry description says outright that `createdAt` is routinely
//     a different period.
//  4. **One door, one posting type** (73 D3): a bill of either kind posts here
//     and nowhere else, so a second Post converges to `already_posted` and a
//     void reverses the one type.
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
  readEditStamp: vi.fn(async () => null as { openedAt: string; byUserId: string } | null),
  ledgerState: { generation: 1 },
  discardDraftPosting: vi.fn(
    async (): Promise<{ isErr: () => boolean; error?: Error }> => ({ isErr: () => false })
  ),
}))

vi.mock('@auxx/database', async () => {
  const schema = await import('../../../../../../database/src/db/schema/index')
  const enums = await import('../../../../../../database/src/enums')
  return { schema, ...enums, database: {} }
})
vi.mock('../../../ledger/setup/accounting-enabled', () => ({
  isAccountingEnabled: h.isAccountingEnabled,
}))
vi.mock('../../../../cache', () => ({
  getEntityDefIdResolver: async () => (type: string) => type,
  // 73 D5's allocation-basis read reaches `systemFields`. An org with no
  // `purchase_order` def resolved falls back to the default basis, which is what
  // every fixture here posts at.
  getCachedEntityDefId: async () => null,
}))
vi.mock('../../../ledger/reads/list-postings', () => ({
  listPostingsForSource: h.listPostingsForSource,
}))
// 74 D4's landed-cost split reads the remaining per shipment. None of these
// fixtures carries a landed line; the read has its own suite.
vi.mock('../../landed-cost/reads', () => ({
  readLandedAccrualRemaining: async () => new Map(),
}))
vi.mock('../../../ledger/periods/period-lock', () => ({
  resolvePeriodLock: async () => ({ lockedThroughMonth: null }),
}))
vi.mock('../../../ledger/post/post-entry', () => ({
  LEDGER_CURRENCY: 'USD',
  postEntry: h.postEntry,
  previewEntry: vi.fn(async () => ({ docNumber: 'AUXX-BIL-BILL0007', lines: [] })),
}))
vi.mock('../../../ledger/post/reverse-entry', () => ({ reverseEntry: h.reverseEntry }))
vi.mock('../../../../settings/settings-service', () => ({
  getOrganizationSetting: async () => null,
}))
vi.mock('../../../../field-values/field-value-service', () => ({
  FieldValueService: class {
    setValuesForEntity = h.setValuesForEntity
  },
}))
vi.mock('../../../../entity-instances/edit-snapshot', () => ({ readEditStamp: h.readEditStamp }))
vi.mock('../../../documents/document-ledger-state', () => ({
  readDocumentLedgerState: async () => h.ledgerState,
}))
vi.mock('../../../ledger/post/draft-lines', () => ({
  discardDraftPosting: h.discardDraftPosting,
}))
vi.mock('../reads', () => ({
  requireVendorBill: async () => h.bill,
  loadVendorBillLines: async () => h.lines,
}))

import type { Database } from '@auxx/database'
import { BadRequestError } from '../../../../errors'
import {
  listVendorBillPostings,
  postVendorBill,
  previewVendorBill,
  voidVendorBill,
} from '../writes'

const ORG = 'org_1'
const USER = 'user_1'
const BILL_ID = 'ei_bill_1'
/** Every read this suite makes is mocked at the module seam; `db` is only passed through. */
const db = {} as unknown as Database

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
  h.readEditStamp.mockResolvedValue(null)
  h.bill = {
    id: BILL_ID,
    number: 'RENT-SEP',
    internalNumber: 'BILL-0007',
    status: 'draft',
    paymentStatus: 'unpaid',
    billedAt: '2026-09-01',
    currency: 'USD',
    totalMinor: 250_000,
    subtotalMinor: 250_000,
    shippingMinor: 0,
    taxMinor: 0,
    discountMinor: 0,
    vendorCompanyInstanceId: 'ei_company_1',
    purchaseOrderId: null,
    lineIds: ['l1'],
  }
  h.lines = [
    {
      id: 'l1',
      description: 'September rent',
      lineTotalMinor: 250_000,
      quantityBilled: null,
      glAccountId: 'ei_acct_rent',
      purchaseOrderLineId: null,
      unitPriceExpectedMinor: null,
      sortOrder: 0,
    },
  ]
  h.postEntry.mockResolvedValue({
    status: 'posted',
    glPostingId: 'gp_1',
    docNumber: 'AUXX-BIL-BILL0007',
  })
  h.reverseEntry.mockResolvedValue({ status: 'posted', glPostingId: 'gp_2' })
  h.listPostingsForSource.mockResolvedValue({ isErr: () => false, isOk: () => true, value: [] })
  h.ledgerState = { generation: 1 }
  h.discardDraftPosting.mockResolvedValue({ isErr: () => false })
})

describe('postVendorBill', () => {
  it('posts the entry and flips the bill to posted', async () => {
    const result = await postVendorBill(db, {
      organizationId: ORG,
      userId: USER,
      vendorBillInstanceId: BILL_ID,
    })

    expect(result.post.status).toBe('posted')
    expect(result.totalMinor).toBe(250_000)
    expect(lastWrite()).toContainEqual({ fieldId: 'vendor_bill_status', value: 'posted' })
  })

  it('hands the poster a vendor_bill entry keyed on the bill INTERNAL number', async () => {
    await postVendorBill(db, {
      organizationId: ORG,
      userId: USER,
      vendorBillInstanceId: BILL_ID,
    })

    const entry = h.postEntry.mock.calls[0]?.[1]?.entry
    expect(entry.postingType).toBe('vendor_bill')
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
      postVendorBill(db, { organizationId: ORG, userId: USER, vendorBillInstanceId: BILL_ID })
    ).rejects.toThrow(/August is locked/)
    expect(h.setValuesForEntity).not.toHaveBeenCalled()
  })

  it('still posts the document when the org has never enabled accounting', async () => {
    h.isAccountingEnabled.mockResolvedValue(false)

    const result = await postVendorBill(db, {
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

    await postVendorBill(db, {
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
      postVendorBill(db, { organizationId: ORG, userId: USER, vendorBillInstanceId: BILL_ID })
    ).rejects.toThrow(BadRequestError)
  })

  it('refuses a bill with no vendor - the payable would fail every export', async () => {
    h.bill = { ...h.bill, vendorCompanyInstanceId: null }
    await expect(
      postVendorBill(db, { organizationId: ORG, userId: USER, vendorBillInstanceId: BILL_ID })
    ).rejects.toThrow(/no vendor/)
    expect(h.postEntry).not.toHaveBeenCalled()
  })

  it('refuses a bill with no internal reference to key the claim on', async () => {
    h.bill = { ...h.bill, internalNumber: '' }
    await expect(
      postVendorBill(db, { organizationId: ORG, userId: USER, vendorBillInstanceId: BILL_ID })
    ).rejects.toThrow(/internal reference/)
  })

  it('refuses a bill with no lines', async () => {
    h.lines = []
    await expect(
      postVendorBill(db, { organizationId: ORG, userId: USER, vendorBillInstanceId: BILL_ID })
    ).rejects.toThrow(/at least one line/)
  })

  it('surfaces the builder refusal for an uncoded line, naming it', async () => {
    h.lines = [
      {
        id: 'l1',
        description: 'September rent',
        lineTotalMinor: 250_000,
        quantityBilled: null,
        glAccountId: null,
        purchaseOrderLineId: null,
        unitPriceExpectedMinor: null,
        sortOrder: 0,
      },
    ]
    await expect(
      postVendorBill(db, { organizationId: ORG, userId: USER, vendorBillInstanceId: BILL_ID })
    ).rejects.toThrow(/September rent/)
    expect(h.postEntry).not.toHaveBeenCalled()
  })

  // 73 D3. One posting type means the claim's unique index answers the second
  // Post, where two types used to let one invoice land in the books twice.
  it('converges to already_posted on a second Post', async () => {
    h.postEntry.mockResolvedValue({
      status: 'already_posted',
      glPostingId: 'gp_1',
      docNumber: 'AUXX-BIL-BILL0007',
    })

    const result = await postVendorBill(db, {
      organizationId: ORG,
      userId: USER,
      vendorBillInstanceId: BILL_ID,
    })

    expect(result.post.status).toBe('already_posted')
    expect(lastWrite()).toContainEqual({ fieldId: 'vendor_bill_status', value: 'posted' })
  })

  it('surfaces the builder refusal for an UNTYPED linked line, naming it', async () => {
    h.lines = [
      {
        id: 'l1',
        description: 'Motors',
        lineTotalMinor: 250_000,
        quantityBilled: 10,
        glAccountId: null,
        purchaseOrderLineId: 'pol_1',
        unitPriceExpectedMinor: null,
        sortOrder: 0,
      },
    ]
    await expect(
      postVendorBill(db, { organizationId: ORG, userId: USER, vendorBillInstanceId: BILL_ID })
    ).rejects.toThrow(/Motors/)
    expect(h.postEntry).not.toHaveBeenCalled()
  })

  // 73 D2. The bill posts on the Post action, never on a verdict - and there is
  // no verdict input anywhere on this path to gate it.
  it('posts a PO bill whose goods have not arrived, relieving GRNI at billed x agreed', async () => {
    h.bill = { ...h.bill, purchaseOrderId: 'ei_po_1' }
    h.lines = [
      {
        id: 'l1',
        description: 'Motors',
        lineTotalMinor: 250_000,
        quantityBilled: 50,
        glAccountId: null,
        purchaseOrderLineId: 'pol_1',
        unitPriceExpectedMinor: 5_000,
        sortOrder: 0,
      },
    ]

    await postVendorBill(db, { organizationId: ORG, userId: USER, vendorBillInstanceId: BILL_ID })

    const entry = h.postEntry.mock.calls[0]?.[1]?.entry
    expect(
      entry.lines.find((line: { accountRole?: string }) => line.accountRole === 'grni')
    ).toMatchObject({
      direction: 'debit',
      amount: 250_000,
    })
    expect(lastWrite()).toContainEqual({ fieldId: 'vendor_bill_status', value: 'posted' })
  })
})

describe('previewVendorBill', () => {
  it('runs the same refusals and writes nothing', async () => {
    h.bill = { ...h.bill, status: 'void' }
    await expect(
      previewVendorBill(db, { organizationId: ORG, userId: USER, vendorBillInstanceId: BILL_ID })
    ).rejects.toThrow(BadRequestError)
    expect(h.setValuesForEntity).not.toHaveBeenCalled()
  })
})

describe('voidVendorBill', () => {
  beforeEach(() => {
    h.bill = { ...h.bill, status: 'posted' }
    h.listPostingsForSource.mockResolvedValue({
      isErr: () => false,
      isOk: () => true,
      value: [
        {
          id: 'gp_1',
          docNumber: 'AUXX-BIL-BILL0007',
          status: 'posted',
          postingType: 'vendor_bill',
        },
      ],
    })
  })

  it('reverses the entry, then sets void', async () => {
    await voidVendorBill(db, {
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
      voidVendorBill(db, { organizationId: ORG, userId: USER, vendorBillInstanceId: BILL_ID })
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
          docNumber: 'AUXX-BIL-BILL0007',
          status: 'reversed',
          postingType: 'vendor_bill',
        },
      ],
    })

    await voidVendorBill(db, {
      organizationId: ORG,
      userId: USER,
      vendorBillInstanceId: BILL_ID,
    })

    expect(h.reverseEntry).not.toHaveBeenCalled()
    expect(lastWrite()).toContainEqual({ fieldId: 'vendor_bill_status', value: 'void' })
  })

  it('refuses to void a bill that has been paid', async () => {
    h.bill = { ...h.bill, paymentStatus: 'paid' }
    await expect(
      voidVendorBill(db, { organizationId: ORG, userId: USER, vendorBillInstanceId: BILL_ID })
    ).rejects.toThrow(/money has already moved/)
  })

  // 73 D4. The values on screen are not the values the live entry was built
  // from, so reversing "every live posting" would back out the wrong figures.
  it('refuses to void a bill that is open for editing', async () => {
    h.readEditStamp.mockResolvedValue({ openedAt: '2026-09-18T00:00:00.000Z', byUserId: USER })
    await expect(
      voidVendorBill(db, { organizationId: ORG, userId: USER, vendorBillInstanceId: BILL_ID })
    ).rejects.toThrow(/open for editing/)
    expect(h.reverseEntry).not.toHaveBeenCalled()
    expect(h.setValuesForEntity).not.toHaveBeenCalled()
  })
})

// With auto-post off the bill's entry is a DRAFT. It holds no subject claim, so
// it reaches every reader through its `pending` link (tasks/77) - as `draft`,
// with no document number.
const PENDING_DRAFT = {
  id: 'gp_draft',
  docNumber: '',
  status: 'draft',
  postingType: 'vendor_bill',
  linkRole: 'pending',
}

describe('listVendorBillPostings and the drafted entry', () => {
  it('lists the pending draft as `draft`', async () => {
    h.listPostingsForSource.mockResolvedValue({
      isErr: () => false,
      isOk: () => true,
      value: [PENDING_DRAFT],
    })

    const postings = await listVendorBillPostings(db, {
      organizationId: ORG,
      vendorBillInstanceId: BILL_ID,
    })

    expect(postings).toEqual([
      { glPostingId: 'gp_draft', docNumber: '', status: 'draft', postingType: 'vendor_bill' },
    ])
  })
})

describe('voidVendorBill and a drafted entry', () => {
  beforeEach(() => {
    h.bill = { ...h.bill, status: 'posted' }
    h.listPostingsForSource.mockResolvedValue({
      isErr: () => false,
      isOk: () => true,
      value: [PENDING_DRAFT],
    })
  })

  // 🛑 A draft left standing can still be approved in the outbox, raising a
  // payable for a bill that is void.
  it('discards the draft rather than reversing it, then sets void', async () => {
    await voidVendorBill(db, { organizationId: ORG, userId: USER, vendorBillInstanceId: BILL_ID })

    expect(h.discardDraftPosting).toHaveBeenCalledWith(db, {
      organizationId: ORG,
      glPostingId: 'gp_draft',
    })
    expect(h.reverseEntry).not.toHaveBeenCalled()
    expect(lastWrite()).toContainEqual({ fieldId: 'vendor_bill_status', value: 'void' })
  })

  it('refuses the void when the draft cannot be discarded', async () => {
    h.discardDraftPosting.mockResolvedValue({
      isErr: () => true,
      error: new Error('it is posted, not draft'),
    })

    await expect(
      voidVendorBill(db, { organizationId: ORG, userId: USER, vendorBillInstanceId: BILL_ID })
    ).rejects.toThrow(/could not be discarded/)
    expect(h.setValuesForEntity).not.toHaveBeenCalled()
  })
})
