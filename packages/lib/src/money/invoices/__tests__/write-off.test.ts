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
const TOTAL_FIELD = { id: 'f-total' }
const AMOUNT_PAID_FIELD = { id: 'f-amount-paid' }
const WRITTEN_OFF_FIELD = { id: 'f-written-off' }

interface WireInvoiceOptions {
  number?: string
  balanceMinor?: number
  totalMinor?: number
  amountPaidMinor?: number
  writtenOffMinor?: number
  /** Simulate an org short of entity migration 128. */
  hasWrittenOffField?: boolean
}

/**
 * Wire the field read `loadInvoiceForWriteOff` performs.
 *
 * `totalMinor` defaults to `balanceMinor + amountPaidMinor`, which is exactly
 * what `syncInvoicePaymentState` leaves behind: it derives
 * `balance = total - amountPaid` and knows nothing about bad debt, so a
 * `writtenOffMinor` here does NOT reduce the mirrored balance. That is the
 * whole reason the outstanding figure is derived rather than read off it.
 */
function wireInvoice(status: string | null, options: WireInvoiceOptions = {}) {
  const {
    number = 'INV-0042',
    balanceMinor = 50_000,
    amountPaidMinor = 0,
    writtenOffMinor = 0,
    hasWrittenOffField = true,
  } = options
  const totalMinor = options.totalMinor ?? balanceMinor + amountPaidMinor

  h.bySystemAttributes.mockResolvedValue({
    invoice_status: STATUS_FIELD,
    invoice_number: NUMBER_FIELD,
    invoice_balance: BALANCE_FIELD,
    invoice_total: TOTAL_FIELD,
    invoice_amount_paid: AMOUNT_PAID_FIELD,
    invoice_written_off: hasWrittenOffField ? WRITTEN_OFF_FIELD : null,
  })
  h.selectRows = status
    ? [
        { fieldId: STATUS_FIELD.id, optionId: status, valueText: null, valueNumber: null },
        { fieldId: NUMBER_FIELD.id, optionId: null, valueText: number, valueNumber: null },
        { fieldId: BALANCE_FIELD.id, optionId: null, valueText: null, valueNumber: balanceMinor },
        { fieldId: TOTAL_FIELD.id, optionId: null, valueText: null, valueNumber: totalMinor },
        {
          fieldId: AMOUNT_PAID_FIELD.id,
          optionId: null,
          valueText: null,
          valueNumber: amountPaidMinor,
        },
        {
          fieldId: WRITTEN_OFF_FIELD.id,
          optionId: null,
          valueText: null,
          valueNumber: writtenOffMinor,
        },
      ]
    : []
}

/**
 * How many `write_off` postings the invoice already has, as
 * `countWriteOffPostings`'s `selectDistinct` reads it.
 */
let writeOffPostings: unknown[] = []

function stubDb() {
  const chain: Record<string, unknown> = {}
  const passthrough = () => chain
  for (const method of ['from', 'where']) chain[method] = passthrough
  // biome-ignore lint/suspicious/noThenProperty: the stub must be awaitable
  chain.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
    Promise.resolve(h.selectRows).then(resolve, reject)

  const countChain: Record<string, unknown> = {}
  for (const method of ['from', 'innerJoin', 'where']) countChain[method] = () => countChain
  // biome-ignore lint/suspicious/noThenProperty: the stub must be awaitable
  countChain.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
    Promise.resolve(writeOffPostings).then(resolve, reject)

  return { select: () => chain, selectDistinct: () => countChain } as never
}

beforeEach(() => {
  vi.clearAllMocks()
  h.fieldValueServiceArgs.length = 0
  writeOffPostings = []
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
    wireInvoice('sent', { balanceMinor: 10_000 })
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
    wireInvoice('sent', { balanceMinor: 0, totalMinor: 0 })
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
    wireInvoice('sent', { balanceMinor: 50_000 })
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
    wireInvoice('partially_paid', { balanceMinor: 50_000 })
    h.postEntry.mockResolvedValue({ status: 'posted', glPostingId: 'gp_1' })

    await writeOffInvoice(stubDb(), {
      organizationId: ORG,
      actorUserId: USER,
      invoiceId: INVOICE,
      amountMinor: 20_000,
      reason: 'Partial settlement',
    })

    const write = h.setValuesForEntity.mock.calls[0]![0]
    expect(write.values).toEqual([
      { fieldId: 'invoice_balance', value: 30_000 },
      { fieldId: 'invoice_written_off', value: 20_000 },
    ])
    expect(write.values).not.toContainEqual(expect.objectContaining({ fieldId: 'invoice_status' }))
  })

  it('does stamp written_off when the amount clears the whole balance', async () => {
    wireInvoice('partially_paid', { balanceMinor: 20_000 })
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
    wireInvoice('sent', { balanceMinor: 50_000 })
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
    wireInvoice('sent', { number: 'INV-0077', balanceMinor: 50_000 })
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

// 🛑 The defect this block exists for: `periodKey` used to be the invoice
// number and nothing else, so a SECOND partial write-off claimed the tuple the
// first already held, `postEntry` answered `already_posted` - a SUCCESS - and
// nothing posted while this function reported that it had. The books were short
// by the second write-off with no error anywhere.
describe('writeOffInvoice - a partial write-off can be topped up', () => {
  it('posts a DISTINCT entry for the second partial rather than re-claiming the first key', async () => {
    // The first write-off, on a 50,000 invoice with nothing paid.
    wireInvoice('partially_paid', { balanceMinor: 50_000 })
    h.postEntry.mockResolvedValue({ status: 'posted', glPostingId: 'gp_1' })
    await writeOffInvoice(stubDb(), {
      organizationId: ORG,
      actorUserId: USER,
      invoiceId: INVOICE,
      amountMinor: 20_000,
      reason: 'First tranche',
    })
    const first = h.postEntry.mock.calls[0]![1].entry

    // The second, with the first's posting now in the ledger and its amount
    // recorded on the invoice. `balance` is deliberately the FULL 50,000 here:
    // `syncInvoicePaymentState` re-derives it as `total - amountPaid` and knows
    // nothing about bad debt, so the outstanding figure has to come from
    // `invoice_written_off`, not from the mirrored balance.
    wireInvoice('partially_paid', { balanceMinor: 50_000, writtenOffMinor: 20_000 })
    writeOffPostings = [{ glPostingId: 'gp_1' }]
    h.postEntry.mockResolvedValue({ status: 'posted', glPostingId: 'gp_2' })
    await writeOffInvoice(stubDb(), {
      organizationId: ORG,
      actorUserId: USER,
      invoiceId: INVOICE,
      amountMinor: 15_000,
      reason: 'Second tranche',
    })
    const second = h.postEntry.mock.calls[1]![1].entry

    expect(first.periodKey).toBe('INV-0042')
    expect(second.periodKey).toBe('INV-00421')
    expect(second.periodKey).not.toBe(first.periodKey)
    expect(second.totalDebit).toBe(15_000)

    // And the cumulative figure grows rather than being restated.
    const write = h.setValuesForEntity.mock.calls[1]![0]
    expect(write.values).toContainEqual({ fieldId: 'invoice_written_off', value: 35_000 })
    expect(write.values).toContainEqual({ fieldId: 'invoice_balance', value: 15_000 })
    expect(write.values).not.toContainEqual(expect.objectContaining({ fieldId: 'invoice_status' }))
  })

  it('refuses a second write-off that would exceed what is left, naming the invoice', async () => {
    wireInvoice('partially_paid', {
      number: 'INV-0091',
      balanceMinor: 50_000,
      writtenOffMinor: 20_000,
    })
    writeOffPostings = [{ glPostingId: 'gp_1' }]

    await expect(
      writeOffInvoice(stubDb(), {
        organizationId: ORG,
        actorUserId: USER,
        invoiceId: INVOICE,
        amountMinor: 30_001,
        reason: 'Too much',
      })
    ).rejects.toThrowError(/INV-0091/)
    await expect(
      writeOffInvoice(stubDb(), {
        organizationId: ORG,
        actorUserId: USER,
        invoiceId: INVOICE,
        amountMinor: 30_001,
        reason: 'Too much',
      })
    ).rejects.toThrowError(/already been written off/)
    expect(h.postEntry).not.toHaveBeenCalled()
  })

  it('writes off only the REMAINDER when no amount is named, and then stamps written_off', async () => {
    wireInvoice('partially_paid', { balanceMinor: 50_000, writtenOffMinor: 20_000 })
    writeOffPostings = [{ glPostingId: 'gp_1' }]
    h.postEntry.mockResolvedValue({ status: 'posted', glPostingId: 'gp_2' })

    await writeOffInvoice(stubDb(), {
      organizationId: ORG,
      actorUserId: USER,
      invoiceId: INVOICE,
      reason: 'Write off the rest',
    })

    // 30,000, not the invoice's whole 50,000: the first tranche already left A/R.
    expect(h.postEntry.mock.calls[0]![1].entry.totalDebit).toBe(30_000)
    const write = h.setValuesForEntity.mock.calls[0]![0]
    expect(write.values).toContainEqual({ fieldId: 'invoice_status', value: 'written_off' })
    expect(write.values).toContainEqual({ fieldId: 'invoice_balance', value: 0 })
    expect(write.values).toContainEqual({ fieldId: 'invoice_written_off', value: 50_000 })
  })

  it('subtracts payments as well as bad debt from what is left', async () => {
    wireInvoice('partially_paid', {
      totalMinor: 100_000,
      amountPaidMinor: 40_000,
      writtenOffMinor: 10_000,
      balanceMinor: 60_000,
    })
    writeOffPostings = [{ glPostingId: 'gp_1' }]
    h.postEntry.mockResolvedValue({ status: 'posted', glPostingId: 'gp_2' })

    await writeOffInvoice(stubDb(), {
      organizationId: ORG,
      actorUserId: USER,
      invoiceId: INVOICE,
      reason: 'Write off the rest',
    })

    expect(h.postEntry.mock.calls[0]![1].entry.totalDebit).toBe(50_000)
  })

  // An org short of entity migration 128 must still be able to write an invoice
  // off - it just cannot record the cumulative figure, and so falls back to the
  // mirrored balance for the bound. Writing a field that does not exist would
  // throw and take the whole action down with it.
  it('skips the invoice_written_off write on an org that has no such field', async () => {
    wireInvoice('sent', { balanceMinor: 50_000, hasWrittenOffField: false })
    h.postEntry.mockResolvedValue({ status: 'posted', glPostingId: 'gp_1' })

    await writeOffInvoice(stubDb(), {
      organizationId: ORG,
      actorUserId: USER,
      invoiceId: INVOICE,
      amountMinor: 20_000,
      reason: 'Partial',
    })

    const write = h.setValuesForEntity.mock.calls[0]![0]
    expect(write.values).toEqual([{ fieldId: 'invoice_balance', value: 30_000 }])
  })
})

describe('previewWriteOffInvoice', () => {
  it('previews without touching postEntry or the invoice fields', async () => {
    wireInvoice('sent', { balanceMinor: 50_000 })
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
