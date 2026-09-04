// packages/lib/src/money/invoices/__tests__/write-off.test.ts
//
// The two things that make a write-off dangerous to get wrong, per the file
// it tests:
//
//  1. **the amount is bounded by the invoice's own balance** - a write-off
//     that could exceed the balance would move a phantom expense through the
//     books;
//  2. **the status flip only happens once the ledger actually accepted the
//     entry** - a refused post (a locked period, an unmapped role) must leave
//     `invoice_status` untouched, exactly as `voidInvoice`'s own guard does.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  bySystemAttributes: vi.fn(),
  selectRows: [] as unknown[],
  resolvePeriodLock: vi.fn(),
  postEntry: vi.fn(),
  previewEntry: vi.fn(),
  getOrganizationSetting: vi.fn(),
  setValuesForEntity: vi.fn(),
  fieldValueServiceArgs: [] as unknown[][],
}))

vi.mock('../../../cache', () => ({
  getOrgCache: () => ({ from: () => ({ bySystemAttributes: h.bySystemAttributes }) }),
}))
vi.mock('../../../postings/period-lock', () => ({
  resolvePeriodLock: h.resolvePeriodLock,
}))
vi.mock('../../../postings/post-entry', () => ({
  LEDGER_CURRENCY: 'USD',
  postEntry: h.postEntry,
  previewEntry: h.previewEntry,
}))
vi.mock('../../../settings/settings-service', () => ({
  getOrganizationSetting: h.getOrganizationSetting,
}))
vi.mock('../../../field-values/field-value-service', () => ({
  FieldValueService: class {
    constructor(...args: unknown[]) {
      h.fieldValueServiceArgs.push(args)
    }
    setValuesForEntity = h.setValuesForEntity
  },
}))

const { writeOffInvoice, previewWriteOffInvoice } = await import('../write-off')
const { BadRequestError, NotFoundError } = await import('../../../errors')

const ORG = 'org-1'
const USER = 'user-1'
const INVOICE = 'inv-1'

const STATUS_FIELD = { id: 'f-status' }
const NUMBER_FIELD = { id: 'f-number' }
const BALANCE_FIELD = { id: 'f-balance' }

/** Wire the three-field read `loadInvoiceForWriteOff` performs. */
function wireInvoice(status: string | null, number = 'INV-0042', balanceMinor = 50_000) {
  h.bySystemAttributes.mockResolvedValue({
    invoice_status: STATUS_FIELD,
    invoice_number: NUMBER_FIELD,
    invoice_balance: BALANCE_FIELD,
  })
  h.selectRows = status
    ? [
        { fieldId: STATUS_FIELD.id, optionId: status, valueText: null, valueNumber: null },
        { fieldId: NUMBER_FIELD.id, optionId: null, valueText: number, valueNumber: null },
        { fieldId: BALANCE_FIELD.id, optionId: null, valueText: null, valueNumber: balanceMinor },
      ]
    : []
}

function stubDb() {
  const chain: Record<string, unknown> = {}
  const passthrough = () => chain
  for (const method of ['from', 'where']) chain[method] = passthrough
  // biome-ignore lint/suspicious/noThenProperty: the stub must be awaitable
  chain.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
    Promise.resolve(h.selectRows).then(resolve, reject)
  return { select: () => chain } as never
}

beforeEach(() => {
  vi.clearAllMocks()
  h.fieldValueServiceArgs.length = 0
  h.resolvePeriodLock.mockResolvedValue({ lockedThroughMonth: null })
  h.getOrganizationSetting.mockResolvedValue('UTC')
})

describe('writeOffInvoice - refusals before the ledger is ever asked', () => {
  it('refuses a blank reason', async () => {
    wireInvoice('sent')
    await expect(
      writeOffInvoice(stubDb(), {
        organizationId: ORG,
        actorUserId: USER,
        invoiceId: INVOICE,
        reason: '  ',
      })
    ).rejects.toBeInstanceOf(BadRequestError)
    expect(h.postEntry).not.toHaveBeenCalled()
  })

  it('refuses when the invoice does not exist', async () => {
    wireInvoice(null)
    await expect(
      writeOffInvoice(stubDb(), {
        organizationId: ORG,
        actorUserId: USER,
        invoiceId: INVOICE,
        reason: 'Bankrupt',
      })
    ).rejects.toBeInstanceOf(NotFoundError)
  })

  it.each(['void', 'written_off', 'draft', 'paid'])('refuses a %s invoice', async (status) => {
    wireInvoice(status)
    await expect(
      writeOffInvoice(stubDb(), {
        organizationId: ORG,
        actorUserId: USER,
        invoiceId: INVOICE,
        reason: 'Bankrupt',
      })
    ).rejects.toBeInstanceOf(BadRequestError)
    expect(h.postEntry).not.toHaveBeenCalled()
  })

  it('refuses an amount over the invoice balance', async () => {
    wireInvoice('sent', 'INV-0042', 10_000)
    await expect(
      writeOffInvoice(stubDb(), {
        organizationId: ORG,
        actorUserId: USER,
        invoiceId: INVOICE,
        amountMinor: 10_001,
        reason: 'Bankrupt',
      })
    ).rejects.toBeInstanceOf(BadRequestError)
    expect(h.postEntry).not.toHaveBeenCalled()
  })

  it('refuses a zero balance', async () => {
    wireInvoice('sent', 'INV-0042', 0)
    await expect(
      writeOffInvoice(stubDb(), {
        organizationId: ORG,
        actorUserId: USER,
        invoiceId: INVOICE,
        reason: 'Bankrupt',
      })
    ).rejects.toBeInstanceOf(BadRequestError)
  })
})

describe('writeOffInvoice - the happy path', () => {
  it('defaults the amount to the whole balance, posts, and flips the status', async () => {
    wireInvoice('sent', 'INV-0042', 50_000)
    h.postEntry.mockResolvedValue({
      status: 'posted',
      glPostingId: 'gp_1',
      docNumber: 'AUXX-WOF-INV0042',
    })

    const result = await writeOffInvoice(stubDb(), {
      organizationId: ORG,
      actorUserId: USER,
      invoiceId: INVOICE,
      reason: 'Customer bankrupt',
    })

    expect(result.status).toBe('posted')
    const postedEntry = h.postEntry.mock.calls[0]![1].entry
    expect(postedEntry.totalDebit).toBe(50_000)
    expect(postedEntry.lines.map((l: { direction: string }) => l.direction)).toEqual([
      'debit',
      'credit',
    ])

    expect(h.setValuesForEntity).toHaveBeenCalledTimes(1)
    const write = h.setValuesForEntity.mock.calls[0]![0]
    expect(write.values).toEqual(
      expect.arrayContaining([
        { fieldId: 'invoice_status', value: 'written_off' },
        { fieldId: 'invoice_balance', value: 0 },
      ])
    )
    // The field-hook bypass is load-bearing - see invoice-lifecycle.test.ts's
    // header for why: without it, `written_off` (an ACTION status) is refused
    // by the exact wall this write-off just added it to.
    expect(h.fieldValueServiceArgs[0]?.[4]).toEqual({
      bypassFieldGuards: new Set(['invoice_status']),
    })
  })

  // 🛑 A partial write-off must NOT stamp `written_off`. That status is a
  // statement about the whole invoice: it would drop a live 30,000 balance out
  // of A/R aging, and `assertWriteOffAllowed` would then refuse to write off the
  // remainder ("already written off") - the balance would be unreachable from
  // every door at once.
  it('writes off part of the balance and reduces invoice_balance by that much', async () => {
    wireInvoice('partially_paid', 'INV-0042', 50_000)
    h.postEntry.mockResolvedValue({ status: 'posted', glPostingId: 'gp_1' })

    await writeOffInvoice(stubDb(), {
      organizationId: ORG,
      actorUserId: USER,
      invoiceId: INVOICE,
      amountMinor: 20_000,
      reason: 'Partial settlement',
    })

    const write = h.setValuesForEntity.mock.calls[0]![0]
    expect(write.values).toEqual([{ fieldId: 'invoice_balance', value: 30_000 }])
    expect(write.values).not.toContainEqual(expect.objectContaining({ fieldId: 'invoice_status' }))
  })

  it('does stamp written_off when the amount clears the whole balance', async () => {
    wireInvoice('partially_paid', 'INV-0042', 20_000)
    h.postEntry.mockResolvedValue({ status: 'posted', glPostingId: 'gp_1' })

    await writeOffInvoice(stubDb(), {
      organizationId: ORG,
      actorUserId: USER,
      invoiceId: INVOICE,
      amountMinor: 20_000,
      reason: 'Customer bankrupt',
    })

    const write = h.setValuesForEntity.mock.calls[0]![0]
    expect(write.values).toContainEqual({ fieldId: 'invoice_status', value: 'written_off' })
    expect(write.values).toContainEqual({ fieldId: 'invoice_balance', value: 0 })
  })

  it('does NOT flip the status when the post is refused', async () => {
    wireInvoice('sent', 'INV-0042', 50_000)
    h.postEntry.mockResolvedValue({ status: 'period_closed', error: 'That month is locked.' })

    const result = await writeOffInvoice(stubDb(), {
      organizationId: ORG,
      actorUserId: USER,
      invoiceId: INVOICE,
      reason: 'Customer bankrupt',
    })

    expect(result.status).toBe('period_closed')
    expect(h.setValuesForEntity).not.toHaveBeenCalled()
  })

  it('names the invoice number as the docNumber key, via the reason as memo', async () => {
    wireInvoice('sent', 'INV-0077', 50_000)
    h.postEntry.mockResolvedValue({ status: 'posted', glPostingId: 'gp_1' })

    await writeOffInvoice(stubDb(), {
      organizationId: ORG,
      actorUserId: USER,
      invoiceId: INVOICE,
      reason: 'Customer bankrupt',
    })

    const call = h.postEntry.mock.calls[0]![1]
    expect(call.entry.periodKey).toBe('INV-0077')
    expect(call.memo).toBe('Customer bankrupt')
  })
})

describe('previewWriteOffInvoice', () => {
  it('previews without touching postEntry or the invoice fields', async () => {
    wireInvoice('sent', 'INV-0042', 50_000)
    h.previewEntry.mockResolvedValue({
      postingType: 'write_off',
      periodKey: 'INV-0042',
      txnDate: '2026-09-03',
      docNumber: 'AUXX-WOF-INV0042',
      lines: [],
      totalMinor: 50_000,
    })

    const preview = await previewWriteOffInvoice(stubDb(), {
      organizationId: ORG,
      invoiceId: INVOICE,
    })

    expect(preview.totalMinor).toBe(50_000)
    expect(h.postEntry).not.toHaveBeenCalled()
    expect(h.setValuesForEntity).not.toHaveBeenCalled()
  })
})
