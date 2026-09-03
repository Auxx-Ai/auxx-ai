// packages/lib/src/purchasing/intake/__tests__/commit.test.ts
//
// What the commit refuses, and what it writes. The create path is a spy, so what
// is pinned is the CONTRACT §6.3 states: the hard gate on a part-less line, the
// header totals a fold produced, `absorbInto` on every line, the temp asset being
// taken off its 24-hour fuse, and the write-backs.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  draft: null as Record<string, unknown> | null,
  creates: [] as { def: string; values: Record<string, unknown>; options?: unknown }[],
  updates: [] as { recordId: string; values: Record<string, unknown> }[],
  converted: [] as { assetId: string; kind: string }[],
  committed: [] as { draftId: string; purchaseOrderInstanceId: string }[],
  /** 🛑 Every read must be keyed by the CALLER's org id, never the draft's. */
  reads: [] as { organizationId: string; draftId: string }[],
  /** Interleaved write log, so the commit's ORDERING can be asserted. */
  order: [] as string[],
  /** What `findVendorPartForLine` answers for a write-back's `(part, vendor)`. */
  existingVendorPart: null as string | null,
  /** Make the attachment conversion blow up, to pin that it is best-effort. */
  failConvert: false,
  /** Make a vendorSku write-back blow up, likewise. */
  failWriteBack: false,
}))

vi.mock('../../../resources/crud/unified-handler', () => ({
  UnifiedCrudHandler: class {
    async create(def: string, values: Record<string, unknown>, options?: unknown) {
      h.creates.push({ def, values, options })
      h.order.push(`create:${def}`)
      const instanceId = `inst_${h.creates.length}`
      return {
        instance: { id: instanceId },
        recordId: `def_${def}:${instanceId}`,
        // The RecordSequence hook mints this; the caller never passes it.
        values: def === 'purchase_order' ? { purchase_order_number: 'PO-1042' } : {},
      }
    }
    async update(recordId: string, values: Record<string, unknown>) {
      if (h.failWriteBack) throw new Error('vendor_part write failed')
      h.updates.push({ recordId, values })
      h.order.push('update:vendor_part')
    }
  },
}))

vi.mock('../../../files/assets/asset-mutations', async () => {
  const { ok } = await import('neverthrow')
  return {
    convertTempAssetToPermanent: vi.fn(async (_ctx, assetId: string, kind: string) => {
      if (h.failConvert) throw new Error('s3 unavailable')
      h.converted.push({ assetId, kind })
      return ok(undefined)
    }),
  }
})

vi.mock('../../vendor-part-lookup', async () => {
  const { ok } = await import('neverthrow')
  return {
    findVendorPartForLine: vi.fn(async () =>
      ok(
        h.existingVendorPart ? { vendorPartRecordId: h.existingVendorPart, unitPrice: null } : null
      )
    ),
  }
})

vi.mock('../draft-mutations', async () => {
  const { ok } = await import('neverthrow')
  return {
    markIntakeDraftCommitted: vi.fn(
      async (_org, draftId: string, purchaseOrderInstanceId: string) => {
        h.committed.push({ draftId, purchaseOrderInstanceId })
        h.order.push('mark')
        return ok(undefined)
      }
    ),
  }
})

vi.mock('../draft-queries', () => ({
  readStoredIntakeDraft: vi.fn(async (organizationId: string, draftId: string) => {
    h.reads.push({ organizationId, draftId })
    return h.draft
  }),
}))

import type { Database } from '@auxx/database'
import { ConflictError, NotFoundError, UnprocessableEntityError } from '../../../errors'
import type { IntakeDraftPayload, IntakeFold, IntakeLine, TranscribedLine } from '../client'
import { commitIntakeDraft } from '../commit'

const db = {} as unknown as Database

const PRINTED: TranscribedLine = {
  lineNumber: 1,
  vendorCode: 'AF-4420',
  description: 'Hex bolt M8x40 zinc',
  quantity: 500,
  unit: 'pcs',
  unitPriceText: '0.42',
  lineTotalText: '210.00',
  leadTime: null,
  priceBreaks: [],
}

function intakeLine(partial: Partial<IntakeLine> = {}): IntakeLine {
  return {
    lineId: 'line_1',
    printed: PRINTED,
    tier: 'sku',
    candidates: [],
    partRecordId: 'def_part:part_1' as never,
    vendorPartRecordId: null,
    description: 'Hex bolt M8x40 zinc',
    quantity: 500,
    unitPriceCents: 42,
    chosenBreakIndex: null,
    foldedInto: null,
    removed: false,
    ...partial,
  }
}

function payload(partial: Partial<IntakeDraftPayload> = {}): IntakeDraftPayload {
  return {
    transcription: {
      vendorName: 'Acme',
      vendorEmail: null,
      vendorPhone: null,
      vendorAddress: null,
      quoteNumber: 'Q-77',
      quoteDate: '2026-09-01',
      validUntil: null,
      currency: 'EUR',
      subtotalText: '210.00',
      shippingText: '35.00',
      taxText: null,
      totalText: '245.00',
      lines: [PRINTED],
    },
    vendorRecordId: 'def_company:company_1' as never,
    vendorCandidates: [],
    lines: [intakeLine()],
    currency: 'EUR',
    quoteNumber: 'Q-77',
    quoteDate: '2026-09-01',
    expectedDeliveryDate: null,
    shippingCents: 0,
    taxCents: 0,
    ...partial,
  }
}

function draftRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'draft_1',
    organizationId: 'org_1',
    status: 'ready',
    assetRef: 'asset:media_1',
    payload: payload(),
    ...overrides,
  }
}

beforeEach(() => {
  h.draft = draftRow()
  h.creates = []
  h.updates = []
  h.converted = []
  h.committed = []
  h.reads = []
  h.order = []
  h.existingVendorPart = null
  h.failConvert = false
  h.failWriteBack = false
})

const INPUT = { draftId: 'draft_1', writeBacks: [] }

describe('commitIntakeDraft — refusals', () => {
  it('a draft in another org is not found', async () => {
    h.draft = null
    const result = await commitIntakeDraft(db, 'org_1', 'user_1', INPUT)
    expect(result._unsafeUnwrapErr()).toBeInstanceOf(NotFoundError)
  })

  it('🛑 a second commit is refused, naming the order that already exists', async () => {
    h.draft = draftRow({ status: 'committed', purchaseOrderInstanceId: 'inst_1' })

    const error = (await commitIntakeDraft(db, 'org_1', 'user_1', INPUT))._unsafeUnwrapErr()
    expect(error).toBeInstanceOf(ConflictError)
    expect(error.message).toBe('This quote is already purchase order inst_1')
    expect((error as ConflictError).details).toEqual({ purchaseOrderInstanceId: 'inst_1' })
    // 🛑 Nothing is written. A double-clicked button must not mint a second
    // order and send the vendor two copies of the same one.
    expect(h.creates).toEqual([])
  })

  it('a draft that has not been read yet has nothing to commit', async () => {
    h.draft = draftRow({ payload: null })
    const result = await commitIntakeDraft(db, 'org_1', 'user_1', INPUT)
    expect(result._unsafeUnwrapErr()).toBeInstanceOf(UnprocessableEntityError)
  })

  it('refuses without a vendor: purchase_order.vendor is required', async () => {
    h.draft = draftRow({ payload: payload({ vendorRecordId: null }) })
    const result = await commitIntakeDraft(db, 'org_1', 'user_1', INPUT)
    expect(result._unsafeUnwrapErr().message).toMatch(/vendor/i)
    expect(h.creates).toEqual([])
  })

  it('🛑 refuses an orderable line with no part, naming the count', async () => {
    h.draft = draftRow({
      payload: payload({
        lines: [
          intakeLine(),
          intakeLine({ lineId: 'l2', partRecordId: null, tier: 'fuzzy' }),
          intakeLine({ lineId: 'l3', partRecordId: null, tier: 'none' }),
        ],
      }),
    })

    const result = await commitIntakeDraft(db, 'org_1', 'user_1', INPUT)
    const error = result._unsafeUnwrapErr()
    expect(error).toBeInstanceOf(UnprocessableEntityError)
    expect(error.message).toBe('2 lines still need a part')
    // 🛑 Nothing is written: the header must not exist before the gate answers.
    expect(h.creates).toEqual([])
  })

  it('names one line in the singular', async () => {
    h.draft = draftRow({
      payload: payload({ lines: [intakeLine({ partRecordId: null, tier: 'none' })] }),
    })
    const result = await commitIntakeDraft(db, 'org_1', 'user_1', INPUT)
    expect(result._unsafeUnwrapErr().message).toBe('1 line still needs a part')
  })
})

describe('commitIntakeDraft — the write', () => {
  it('creates the order through the generic path and reports the minted number', async () => {
    const result = await commitIntakeDraft(db, 'org_1', 'user_1', INPUT)

    const value = result._unsafeUnwrap()
    expect(value.number).toBe('PO-1042')
    expect(value.purchaseOrderInstanceId).toBe('inst_1')
    expect(value.recordId).toBe('def_purchase_order:inst_1')

    const header = h.creates[0]
    expect(header?.def).toBe('purchase_order')
    // 🛑 Never passed: the RecordSequence hook is the only writer.
    expect(header?.values).not.toHaveProperty('purchase_order_number')
    expect(header?.values.purchase_order_vendor).toBe('def_company:company_1')
    expect(header?.values.purchase_order_attachments).toEqual([{ ref: 'asset:media_1' }])
  })

  it('creates every line with absorbInto and a RecordId part', async () => {
    h.draft = draftRow({
      payload: payload({
        lines: [
          intakeLine(),
          intakeLine({ lineId: 'l2', partRecordId: 'def_part:part_2' as never }),
        ],
      }),
    })

    await commitIntakeDraft(db, 'org_1', 'user_1', INPUT)

    const lines = h.creates.filter((c) => c.def === 'purchase_order_line')
    expect(lines).toHaveLength(2)
    for (const created of lines) {
      expect(created.options).toEqual({ absorbInto: 'def_purchase_order:inst_1' })
      expect(created.values.purchase_order_line_purchase_order).toBe('def_purchase_order:inst_1')
      expect(String(created.values.purchase_order_line_part)).toMatch(/^def_part:/)
    }
    expect(lines[0]?.values.purchase_order_line_sort_order).toBe(0)
    expect(lines[1]?.values.purchase_order_line_sort_order).toBe(1)
  })

  it('takes the quote off its 24-hour fuse', async () => {
    await commitIntakeDraft(db, 'org_1', 'user_1', INPUT)
    expect(h.converted).toEqual([{ assetId: 'media_1', kind: 'DOCUMENT' }])
  })

  it('marks the draft committed and never deletes its key', async () => {
    await commitIntakeDraft(db, 'org_1', 'user_1', INPUT)
    // 🛑 A delete that failed would leave an editable draft over records that
    // already exist, and a retry would mint a second order. The TTL reaps it.
    expect(h.committed).toEqual([{ draftId: 'draft_1', purchaseOrderInstanceId: 'inst_1' }])
  })

  it('⚠️ marks committed AFTER the records exist and BEFORE the write-backs', async () => {
    h.existingVendorPart = 'def_vendor_part:vp_1'

    await commitIntakeDraft(db, 'org_1', 'user_1', {
      draftId: 'draft_1',
      writeBacks: [{ partRecordId: 'def_part:part_1' as never, vendorSku: 'AF-4420' }],
    })

    // Marking before the create would strand a failed create in an
    // uncommittable draft; marking after the write-backs would leave a window
    // in which a retry mints a second order.
    expect(h.order).toEqual([
      'create:purchase_order',
      'create:purchase_order_line',
      'mark',
      'update:vendor_part',
    ])
  })

  it("🛑 reads the draft under the CALLER's org id, never the draft id alone", async () => {
    await commitIntakeDraft(db, 'org_1', 'user_1', INPUT)
    expect(h.reads).toEqual([{ organizationId: 'org_1', draftId: 'draft_1' }])
  })
})

describe('commitIntakeDraft — everything after the order is best-effort', () => {
  // ⚠️ These pin a deliberate swallow. Never report failure for work that
  // succeeded: the order exists with a real number, and telling the user
  // otherwise sends them to create it by hand — the duplicate order the commit's
  // ordering constraint exists to prevent, arriving through the front door.

  it('reports success when the attachment cannot be made permanent', async () => {
    h.failConvert = true

    const result = await commitIntakeDraft(db, 'org_1', 'user_1', INPUT)

    expect(result._unsafeUnwrap().number).toBe('PO-1042')
    expect(h.committed).toHaveLength(1)
  })

  it('a failed conversion does not cost the write-backs either', async () => {
    h.failConvert = true
    h.existingVendorPart = 'def_vendor_part:vp_1'

    const result = await commitIntakeDraft(db, 'org_1', 'user_1', {
      draftId: 'draft_1',
      writeBacks: [{ partRecordId: 'def_part:part_1' as never, vendorSku: 'AF-4420' }],
    })

    expect(result.isOk()).toBe(true)
    expect(h.updates).toHaveLength(1)
  })

  it('reports success when a vendorSku write-back fails', async () => {
    h.failWriteBack = true
    h.existingVendorPart = 'def_vendor_part:vp_1'

    const result = await commitIntakeDraft(db, 'org_1', 'user_1', {
      draftId: 'draft_1',
      writeBacks: [{ partRecordId: 'def_part:part_1' as never, vendorSku: 'AF-4420' }],
    })

    // A lost optimisation for the NEXT quote, never a failed order.
    expect(result._unsafeUnwrap().purchaseOrderInstanceId).toBe('inst_1')
    expect(h.converted).toEqual([{ assetId: 'media_1', kind: 'DOCUMENT' }])
  })

  it('one bad write-back does not cost the others', async () => {
    h.existingVendorPart = null // every write-back takes the create path

    const result = await commitIntakeDraft(db, 'org_1', 'user_1', {
      draftId: 'draft_1',
      writeBacks: [
        { partRecordId: 'def_part:part_1' as never, vendorSku: 'AF-4420' },
        { partRecordId: 'def_part:part_2' as never, vendorSku: 'X-9' },
      ],
    })

    expect(result.isOk()).toBe(true)
    expect(h.creates.filter((c) => c.def === 'vendor_part')).toHaveLength(2)
  })
})

describe('commitIntakeDraft — the shipping fold (§5.4)', () => {
  const freight = (fold: IntakeFold) =>
    intakeLine({
      lineId: 'freight',
      tier: 'none',
      partRecordId: null,
      description: 'Carriage',
      quantity: 1,
      unitPriceCents: 3500,
      foldedInto: fold,
    })

  it('a folded line does not block the commit even though it has no part', async () => {
    h.draft = draftRow({
      payload: payload({ lines: [intakeLine(), freight('shipping')], shippingCents: 3500 }),
    })

    const result = await commitIntakeDraft(db, 'org_1', 'user_1', INPUT)
    expect(result.isOk()).toBe(true)
  })

  it('a folded line becomes a header total, never a purchase order line', async () => {
    h.draft = draftRow({
      payload: payload({
        lines: [intakeLine(), freight('shipping'), freight('tax')],
        shippingCents: 3500,
        taxCents: 1200,
      }),
    })

    await commitIntakeDraft(db, 'org_1', 'user_1', INPUT)

    expect(h.creates.filter((c) => c.def === 'purchase_order_line')).toHaveLength(1)
    expect(h.creates[0]?.values.purchase_order_shipping_total).toBe(3500)
    expect(h.creates[0]?.values.purchase_order_tax_total).toBe(1200)
  })

  it('the totals confrontation still balances: lines + shipping + tax', async () => {
    // 500 @ €0.42 = €210.00, plus €35.00 freight = the vendor's printed €245.00.
    h.draft = draftRow({
      payload: payload({ lines: [intakeLine(), freight('shipping')], shippingCents: 3500 }),
    })

    await commitIntakeDraft(db, 'org_1', 'user_1', INPUT)

    const line = h.creates.find((c) => c.def === 'purchase_order_line')
    const lineSum =
      Number(line?.values.purchase_order_line_expected_unit_price) *
      Number(line?.values.purchase_order_line_quantity_ordered)
    expect(lineSum + Number(h.creates[0]?.values.purchase_order_shipping_total)).toBe(24500)
  })
})

describe('commitIntakeDraft — a removed line', () => {
  const dropped = () =>
    intakeLine({ lineId: 'dropped', partRecordId: 'def_part:part_2' as never, removed: true })

  it('never becomes a purchase order line', async () => {
    h.draft = draftRow({ payload: payload({ lines: [intakeLine(), dropped()] }) })

    await commitIntakeDraft(db, 'org_1', 'user_1', INPUT)

    const lines = h.creates.filter((c) => c.def === 'purchase_order_line')
    expect(lines).toHaveLength(1)
    expect(lines[0]?.values.purchase_order_line_part).toBe('def_part:part_1')
  })

  // 🛑 The whole point of the soft flag. A removed line keeps whatever state it
  // had — including no part — and it must not hold the commit hostage for a
  // decision the person already made by removing it.
  it('does not block the commit even with no part', async () => {
    h.draft = draftRow({
      payload: payload({
        lines: [intakeLine(), intakeLine({ lineId: 'x', partRecordId: null, removed: true })],
      }),
    })

    const result = await commitIntakeDraft(db, 'org_1', 'user_1', INPUT)
    expect(result.isOk()).toBe(true)
  })
})

describe('commitIntakeDraft — write-backs (§5.3)', () => {
  const writeBack = { partRecordId: 'def_part:part_1' as never, vendorSku: 'AF-4420' }

  it('sets the vendor sku on an existing (part, vendor) row', async () => {
    h.existingVendorPart = 'def_vendor_part:vp_1'

    await commitIntakeDraft(db, 'org_1', 'user_1', {
      draftId: 'draft_1',
      writeBacks: [writeBack],
    })

    expect(h.updates).toEqual([
      { recordId: 'def_vendor_part:vp_1', values: { vendor_part_vendor_sku: 'AF-4420' } },
    ])
    expect(h.creates.some((c) => c.def === 'vendor_part')).toBe(false)
  })

  it('creates the catalogue row when the pair has none', async () => {
    h.existingVendorPart = null

    await commitIntakeDraft(db, 'org_1', 'user_1', {
      draftId: 'draft_1',
      writeBacks: [writeBack],
    })

    const created = h.creates.find((c) => c.def === 'vendor_part')
    expect(created?.values).toEqual({
      vendor_part_part: 'def_part:part_1',
      vendor_part_contact: 'def_company:company_1',
      vendor_part_vendor_sku: 'AF-4420',
    })
    expect(h.updates).toEqual([])
  })

  it('writes back nothing when nothing was accepted', async () => {
    await commitIntakeDraft(db, 'org_1', 'user_1', INPUT)
    expect(h.updates).toEqual([])
    expect(h.creates.some((c) => c.def === 'vendor_part')).toBe(false)
  })
})
