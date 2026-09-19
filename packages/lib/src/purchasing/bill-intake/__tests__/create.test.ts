// packages/lib/src/purchasing/bill-intake/__tests__/create.test.ts
//
// What createBillFromIntake refuses, and what it writes - copying
// intake/__tests__/commit.test.ts's harness (plans/money/tasks/58 §4.4, §4.5).
// The create path is a spy, so what is pinned is the CONTRACT: the refusals,
// the header values, a linked line's part/gl_account/vendor_code, an unlinked
// line's absence of the same three, the ordering around
// markBillIntakeRunCreated, and that the best-effort tail never fails the
// result.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  creates: [] as { def: string; values: Record<string, unknown>; options?: unknown }[],
  order: [] as string[],
  marked: [] as unknown[],
  converted: [] as { assetId: string; kind: string }[],
  rollups: [] as { org: string; lineIds: string[]; spec: string }[],
  rematches: [] as { vendorBillInstanceId: string }[],
  grniAccountId: 'gl_grni' as string | null,
  orderCurrency: null as string | null,
  orgCurrency: 'USD',
  failConvert: false,
  failRollup: false,
  failRematch: false,
  failMark: false,
}))

vi.mock('../../../resources/crud/unified-handler', () => ({
  UnifiedCrudHandler: class {
    async create(def: string, values: Record<string, unknown>, options?: unknown) {
      h.creates.push({ def, values, options })
      h.order.push(`create:${def}`)
      const instanceId = `inst_${h.creates.length}`
      return { instance: { id: instanceId }, recordId: `def_${def}:${instanceId}`, values: {} }
    }
  },
}))

vi.mock('../../../cache', () => ({
  getOrgCache: () => ({
    from: () => ({
      bySystemAttributes: async () => ({ purchase_order_currency: { id: 'fld_currency' } }),
    }),
  }),
}))

vi.mock('../link', () => ({
  resolveGrniAccountId: vi.fn(async () => h.grniAccountId),
}))

vi.mock('../run-store', async () => {
  const { ok, err } = await import('neverthrow')
  return {
    markBillIntakeRunCreated: vi.fn(async (_org: string, _runId: string, result: unknown) => {
      h.order.push('mark')
      h.marked.push(result)
      return h.failMark ? err(new Error('mark failed')) : ok(undefined)
    }),
  }
})

vi.mock('../../../files/assets/asset-mutations', async () => {
  const { ok } = await import('neverthrow')
  return {
    convertTempAssetToPermanent: vi.fn(async (_ctx, assetId: string, kind: string) => {
      h.order.push('convert')
      if (h.failConvert) throw new Error('s3 unavailable')
      h.converted.push({ assetId, kind })
      return ok(undefined)
    }),
  }
})

vi.mock('../../../field-hooks/post/purchase-order-line-rollups', () => ({
  PURCHASE_ORDER_LINE_ROLLUPS: { billed: 'billed-spec', received: 'received-spec' },
  recalculatePurchaseOrderLineRollups: vi.fn(
    async (org: string, lineIds: string[], spec: string) => {
      h.order.push('rollup')
      if (h.failRollup) throw new Error('rollup failed')
      h.rollups.push({ org, lineIds, spec })
    }
  ),
}))

vi.mock('../../match-hook', () => ({
  rematchBill: vi.fn(async ({ vendorBillInstanceId }: { vendorBillInstanceId: string }) => {
    h.order.push('rematch')
    if (h.failRematch) throw new Error('rematch failed')
    h.rematches.push({ vendorBillInstanceId })
  }),
}))

vi.mock('../../../field-values/org-currency', () => ({
  getOrgCurrencyCode: vi.fn(async () => h.orgCurrency),
}))

/** Answers `rows` however the builder is chained, then resolves on await. */
function chainReturning(rows: unknown[]): unknown {
  const proxy: unknown = new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === 'then') return (resolve: (value: unknown) => void) => resolve(rows)
        return () => proxy
      },
    }
  )
  return proxy
}

import type { Database } from '@auxx/database'
import { ConflictError, UnprocessableEntityError } from '../../../errors'
import type { LineProposal, TranscribedInvoice } from '../client'
import { createBillFromIntake } from '../create'
import type { StoredBillIntakeRun } from '../run-store'

const db = {
  select: () => chainReturning(h.orderCurrency ? [{ valueText: h.orderCurrency }] : []),
} as unknown as Database

function invoiceLine(
  partial: Partial<TranscribedInvoice['lines'][number]> = {}
): TranscribedInvoice['lines'][number] {
  return {
    lineNumber: 1,
    vendorCode: 'AF-4420',
    customerCode: null,
    description: 'Hex bolt M8x40',
    quantity: 500,
    unit: 'pcs',
    unitPriceText: '0.42',
    lineTotalText: '210.00',
    referencedInvoiceNumber: null,
    ...partial,
  }
}

function invoice(partial: Partial<TranscribedInvoice> = {}): TranscribedInvoice {
  return {
    vendorName: 'Acme Ltd',
    vendorEmail: null,
    vendorAddress: null,
    invoiceNumber: 'INV-88213',
    invoiceDate: '2026-09-01',
    dueDate: '2026-10-01',
    paymentTerms: 'Net 30',
    purchaseOrderReference: null,
    referencedInvoiceNumber: null,
    currency: 'USD',
    subtotalText: '210.00',
    shippingText: null,
    taxText: null,
    discountText: null,
    totalText: '210.00',
    lines: [invoiceLine()],
    ...partial,
  }
}

function proposal(partial: Partial<LineProposal> = {}): LineProposal {
  return {
    lineId: '0',
    tier: 'vendor_sku',
    candidates: [
      {
        orderLineRecordId: 'def_purchase_order_line:pol_1' as never,
        partRecordId: 'def_part:part_1' as never,
        label: 'Hex bolt',
        tier: 'vendor_sku',
        reasons: ['vendor code matches'],
        score: 1000,
      },
    ],
    linkedOrderLineRecordId: 'def_purchase_order_line:pol_1' as never,
    landedBillRecordId: null,
    hint: 'goods',
    ...partial,
  }
}

function run(partial: Partial<StoredBillIntakeRun> = {}): StoredBillIntakeRun {
  return {
    id: 'run_1',
    organizationId: 'org_1',
    createdById: 'user_1',
    status: 'reading',
    phase: 'bill',
    assetRef: 'asset:media_1',
    fileName: 'acme.pdf',
    mimeType: 'application/pdf',
    vendorRecordId: 'def_company:company_1' as never,
    vendorCandidates: [],
    purchaseOrderRecordId: null,
    transcription: invoice(),
    extractedText: null,
    proposals: [proposal()],
    warnings: [],
    vendorBillInstanceId: null,
    vendorBillRecordId: null,
    vendorBillLineRecordIds: [],
    existingBillRecordId: null,
    error: null,
    createdAt: '2026-09-14T00:00:00.000Z',
    ...partial,
  }
}

beforeEach(() => {
  h.creates = []
  h.order = []
  h.marked = []
  h.converted = []
  h.rollups = []
  h.rematches = []
  h.grniAccountId = 'gl_grni'
  h.orderCurrency = null
  h.orgCurrency = 'USD'
  h.failConvert = false
  h.failRollup = false
  h.failRematch = false
  h.failMark = false
})

describe('createBillFromIntake - refusals', () => {
  it('refuses without a transcription', async () => {
    const result = await createBillFromIntake(db, 'org_1', 'user_1', run({ transcription: null }))
    expect(result._unsafeUnwrapErr()).toBeInstanceOf(UnprocessableEntityError)
    expect(h.creates).toEqual([])
  })

  it('refuses without a vendor', async () => {
    const result = await createBillFromIntake(db, 'org_1', 'user_1', run({ vendorRecordId: null }))
    expect(result._unsafeUnwrapErr()).toBeInstanceOf(UnprocessableEntityError)
    expect(h.creates).toEqual([])
  })

  it('refuses when proposals do not exist or do not align with the lines', async () => {
    const noProposals = await createBillFromIntake(db, 'org_1', 'user_1', run({ proposals: null }))
    expect(noProposals._unsafeUnwrapErr()).toBeInstanceOf(UnprocessableEntityError)

    const misaligned = await createBillFromIntake(
      db,
      'org_1',
      'user_1',
      run({ proposals: [proposal(), proposal()] })
    )
    expect(misaligned._unsafeUnwrapErr()).toBeInstanceOf(UnprocessableEntityError)
    expect(h.creates).toEqual([])
  })

  it('refuses when the invoice prints no number', async () => {
    const result = await createBillFromIntake(
      db,
      'org_1',
      'user_1',
      run({ transcription: invoice({ invoiceNumber: null }) })
    )
    const error = result._unsafeUnwrapErr()
    expect(error).toBeInstanceOf(UnprocessableEntityError)
    expect(error.message).toMatch(/prints no number/)
    expect(h.creates).toEqual([])
  })

  it('a run already created is a conflict naming the existing bill', async () => {
    const result = await createBillFromIntake(
      db,
      'org_1',
      'user_1',
      run({ status: 'created', vendorBillRecordId: 'def_vendor_bill:bill_1' as never })
    )
    const error = result._unsafeUnwrapErr()
    expect(error).toBeInstanceOf(ConflictError)
    expect(error.message).toBe('This invoice is already vendor bill def_vendor_bill:bill_1')
    expect(h.creates).toEqual([])
  })
})

describe('createBillFromIntake - the header', () => {
  it('writes the number, parsed dates, the four totals, the document ref and currency', async () => {
    const result = await createBillFromIntake(db, 'org_1', 'user_1', run())
    expect(result.isOk()).toBe(true)

    const header = h.creates.find((c) => c.def === 'vendor_bill')
    expect(header?.values).toMatchObject({
      vendor_bill_vendor: 'def_company:company_1',
      vendor_bill_number: 'INV-88213',
      vendor_bill_billed_at: '2026-09-01T00:00:00.000Z',
      vendor_bill_due_at: '2026-10-01T00:00:00.000Z',
      vendor_bill_currency: 'USD',
      vendor_bill_subtotal: 21000,
      vendor_bill_total: 21000,
      vendor_bill_document: [{ ref: 'asset:media_1' }],
    })
    // Not printed: absent, not null.
    expect(header?.values).not.toHaveProperty('vendor_bill_shipping_total')
    expect(header?.values).not.toHaveProperty('vendor_bill_tax_total')
    expect(header?.values).not.toHaveProperty('vendor_bill_purchase_order')
  })

  it('omits a date that does not parse', async () => {
    const result = await createBillFromIntake(
      db,
      'org_1',
      'user_1',
      run({ transcription: invoice({ invoiceDate: 'thirty days net', dueDate: null }) })
    )
    expect(result.isOk()).toBe(true)
    const header = h.creates.find((c) => c.def === 'vendor_bill')
    expect(header?.values).not.toHaveProperty('vendor_bill_billed_at')
    expect(header?.values).not.toHaveProperty('vendor_bill_due_at')
  })

  it('falls back to the org currency when the invoice prints none and there is no order', async () => {
    h.orgCurrency = 'GBP'
    const result = await createBillFromIntake(
      db,
      'org_1',
      'user_1',
      run({ transcription: invoice({ currency: null }) })
    )
    expect(result.isOk()).toBe(true)
    const header = h.creates.find((c) => c.def === 'vendor_bill')
    expect(header?.values.vendor_bill_currency).toBe('GBP')
  })

  it('uses the order currency when the invoice prints none', async () => {
    h.orderCurrency = 'EUR'
    const result = await createBillFromIntake(
      db,
      'org_1',
      'user_1',
      run({
        purchaseOrderRecordId: 'def_purchase_order:po_1' as never,
        transcription: invoice({ currency: null }),
      })
    )
    expect(result.isOk()).toBe(true)
    const header = h.creates.find((c) => c.def === 'vendor_bill')
    expect(header?.values.vendor_bill_currency).toBe('EUR')
  })

  it('prefers the printed currency and warns when the order disagrees', async () => {
    h.orderCurrency = 'EUR'
    const result = await createBillFromIntake(
      db,
      'org_1',
      'user_1',
      run({
        purchaseOrderRecordId: 'def_purchase_order:po_1' as never,
        transcription: invoice({ currency: 'USD' }),
      })
    )
    const value = result._unsafeUnwrap()
    expect(value.warnings.some((w) => w.code === 'currency_mismatch')).toBe(true)
    const header = h.creates.find((c) => c.def === 'vendor_bill')
    expect(header?.values.vendor_bill_currency).toBe('USD')
  })

  it('creates the header even with zero printed lines, and warns no_lines', async () => {
    const result = await createBillFromIntake(
      db,
      'org_1',
      'user_1',
      run({ transcription: invoice({ lines: [] }), proposals: [] })
    )
    const value = result._unsafeUnwrap()
    expect(h.creates.filter((c) => c.def === 'vendor_bill')).toHaveLength(1)
    expect(h.creates.filter((c) => c.def === 'vendor_bill_line')).toHaveLength(0)
    expect(value.warnings.some((w) => w.code === 'no_lines')).toBe(true)
  })
})

describe('createBillFromIntake - the lines', () => {
  it('a linked line carries the order line, the part, the gl_account and the vendor code', async () => {
    await createBillFromIntake(db, 'org_1', 'user_1', run())

    const line = h.creates.find((c) => c.def === 'vendor_bill_line')
    expect(line?.values).toMatchObject({
      vendor_bill_line_purchase_order_line: 'def_purchase_order_line:pol_1',
      vendor_bill_line_part: 'def_part:part_1',
      vendor_bill_line_gl_account: 'gl_grni',
      vendor_bill_line_vendor_code: 'AF-4420',
      vendor_bill_line_sort_order: 0,
    })
    expect(line?.options).toEqual({ absorbInto: 'def_vendor_bill:inst_1' })
  })

  it('an unlinked line carries none of the three', async () => {
    await createBillFromIntake(
      db,
      'org_1',
      'user_1',
      run({ proposals: [proposal({ linkedOrderLineRecordId: null, tier: 'none' })] })
    )

    const line = h.creates.find((c) => c.def === 'vendor_bill_line')
    expect(line?.values).not.toHaveProperty('vendor_bill_line_purchase_order_line')
    expect(line?.values).not.toHaveProperty('vendor_bill_line_part')
    expect(line?.values).not.toHaveProperty('vendor_bill_line_gl_account')
  })

  it('an unread quantity is absent from the write, and warns naming the count', async () => {
    const result = await createBillFromIntake(
      db,
      'org_1',
      'user_1',
      run({ transcription: invoice({ lines: [invoiceLine({ quantity: null })] }) })
    )
    const value = result._unsafeUnwrap()
    const line = h.creates.find((c) => c.def === 'vendor_bill_line')
    expect(line?.values).not.toHaveProperty('vendor_bill_line_quantity_billed')
    expect(value.warnings.filter((w) => w.code === 'quantity_unread')).toHaveLength(1)
    expect(value.warnings.find((w) => w.code === 'quantity_unread')?.message).toMatch(/1 line/)
  })

  it('warns grni_unresolved once when the role is unassigned, and codes no lines', async () => {
    h.grniAccountId = null
    const result = await createBillFromIntake(db, 'org_1', 'user_1', run())
    const value = result._unsafeUnwrap()
    expect(value.warnings.filter((w) => w.code === 'grni_unresolved')).toHaveLength(1)
    const line = h.creates.find((c) => c.def === 'vendor_bill_line')
    expect(line?.values).not.toHaveProperty('vendor_bill_line_gl_account')
  })

  it('does not resolve grni at all when nothing links', async () => {
    await createBillFromIntake(
      db,
      'org_1',
      'user_1',
      run({ proposals: [proposal({ linkedOrderLineRecordId: null, tier: 'none' })] })
    )
    const value = (
      await createBillFromIntake(
        db,
        'org_1',
        'user_1',
        run({ id: 'run_2', proposals: [proposal({ linkedOrderLineRecordId: null, tier: 'none' })] })
      )
    )._unsafeUnwrap()
    expect(value.warnings.some((w) => w.code === 'grni_unresolved')).toBe(false)
  })
})

describe('createBillFromIntake - ordering', () => {
  it('marks the run created after the bill and lines exist, before the best-effort tail', async () => {
    await createBillFromIntake(db, 'org_1', 'user_1', run())
    expect(h.order).toEqual([
      'create:vendor_bill',
      'create:vendor_bill_line',
      'mark',
      'convert',
      'rollup',
      'rematch',
    ])
  })

  it('skips the roll-up call when nothing linked', async () => {
    await createBillFromIntake(
      db,
      'org_1',
      'user_1',
      run({ proposals: [proposal({ linkedOrderLineRecordId: null, tier: 'none' })] })
    )
    expect(h.order).toEqual([
      'create:vendor_bill',
      'create:vendor_bill_line',
      'mark',
      'convert',
      'rematch',
    ])
  })
})

describe('createBillFromIntake - best-effort tail', () => {
  it('a failed conversion still reports success', async () => {
    h.failConvert = true
    const result = await createBillFromIntake(db, 'org_1', 'user_1', run())
    expect(result.isOk()).toBe(true)
  })

  it('a failed roll-up still reports success', async () => {
    h.failRollup = true
    const result = await createBillFromIntake(db, 'org_1', 'user_1', run())
    expect(result.isOk()).toBe(true)
  })

  it('a failed rematch still reports success', async () => {
    h.failRematch = true
    const result = await createBillFromIntake(db, 'org_1', 'user_1', run())
    expect(result.isOk()).toBe(true)
  })

  it('a failed mark DOES fail the result - nothing downstream is trustworthy without it', async () => {
    h.failMark = true
    const result = await createBillFromIntake(db, 'org_1', 'user_1', run())
    expect(result.isErr()).toBe(true)
  })
})
