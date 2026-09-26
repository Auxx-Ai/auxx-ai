// packages/lib/src/inventory/receiving/__tests__/receive-purchase-order.test.ts
// The multi-line receipt. `UnifiedCrudHandler`, the org cache, the part-kind
// read, `ensureStandardCost` and the posting seam are all mocked, so nothing
// here needs a database — what is asserted is the CONTRACT: the price comes
// from the purchase order line and nowhere else, the whole set is validated
// before the first movement, nothing is allocated any more, and the WHOLE
// receipt posts ONE inventory entry with every line's movement as a member —
// never one entry per line (the bug this file now guards against).

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { BadRequestError, NotFoundError, UnprocessableEntityError } from '../../../errors'
import type { ReceivePurchaseOrderLineInput } from '../types'

const h = vi.hoisted(() => ({
  createSpy: vi.fn(async (..._args: unknown[]) => ({ instance: { id: 'mv_1' } })),
  /** One call per `readSystemRecords`, so the read stays batched. */
  readRecords: vi.fn(),
  /** systemAttributes the org has materialised. */
  materialised: new Set<string>(),
  /** entityType -> def id; a missing key models a def the org does not have. */
  defs: new Map<string, string>(),
  /** `purchase_order_line` instance id -> its stored expected unit price. */
  prices: new Map<string, number | null>(),
  /** The raw `purchase_order_line_purchase_order` relation rows the org holds. */
  orderIds: [] as (string | null)[],
  partKind: null as string | null,
  /** `part` id -> `part_kind`, as the batched kind read returns it. */
  partKinds: new Map<string, string>(),
  /** The winning supplier row's adders, per `vendor_part` id. */
  vendorTerms: new Map<string, Record<string, number | null>>(),
  /** `part` id -> its frozen standard, as `readStandardCost` returns it. */
  standardCosts: new Map<string, number>(),
  ensureSpy: vi.fn(),
  replaceSpy: vi.fn(),
  postSpy: vi.fn(async (..._args: unknown[]) => null as unknown),
  exportSpy: vi.fn(async (..._args: unknown[]) => null as unknown),
  /** The batched roll-up this door runs once the whole receipt is committed. */
  settleSpy: vi.fn(),
  /** The post-commit QoH recalculation, which the hook also performs. */
  qohSpy: vi.fn(async (..._args: unknown[]) => {}),
}))

vi.mock('../../costing/qoh', () => ({
  batchRecalculateQoH: (...args: unknown[]) => h.qohSpy(...args),
}))

// `inventory/movements` still reads the cache directly; this door does not.
vi.mock('../../../cache', () => ({
  getCachedEntityDefId: vi.fn(async (_org: string, entityType: string) => h.defs.get(entityType)),
  requireCachedEntityDefId: vi.fn(async (_org: string, entityType: string) => {
    const id = h.defs.get(entityType)
    if (!id) throw new Error(`EntityDefinition not found for entityType: ${entityType}`)
    return id
  }),
  getOrgCache: () => ({
    from: () => ({
      bySystemAttributes: async (attrs: string[]) =>
        Object.fromEntries(
          attrs.map((a) => [a, h.materialised.has(a) ? { id: `fld_${a}` } : null])
        ),
    }),
  }),
}))

// The system-records reader, standing in for the two queries this door used to
// write by hand: the purchase-order lines with their price and their order.
vi.mock('../../../resources/system-records', () => ({
  systemDefId: async (_db: unknown, _org: string, entityType: string) =>
    h.defs.get(entityType) ?? null,
  systemFields: async (_db: unknown, _org: string, entityType: string, attrs: string[]) => {
    const defId = h.defs.get(entityType)
    if (!defId) return null
    return {
      defId,
      fields: Object.fromEntries(
        attrs.map((a) => [a, h.materialised.has(a) ? { id: `fld_${a}` } : null])
      ),
    }
  },
  systemFieldMap: async (_db: unknown, _org: string, attrs: string[]) =>
    Object.fromEntries(attrs.map((a) => [a, h.materialised.has(a) ? { id: `fld_${a}` } : null])),
  readSystemRecords: (...args: unknown[]) => h.readRecords(...args),
}))

vi.mock('../../../resources/crud/unified-handler', () => ({
  UnifiedCrudHandler: class {
    create = h.createSpy
  },
}))

vi.mock('../../builds/build-queries', () => ({
  readPartKinds: vi.fn(async () => h.partKinds),
}))

vi.mock('../receipt-queries', async () => {
  const { ok } = await import('neverthrow')
  return {
    readPartKind: vi.fn(async () => ok(h.partKind)),
    readVendorPartCostInputs: vi.fn(async (_db: unknown, _org: string, vendorPartId: string) =>
      ok(h.vendorTerms.get(vendorPartId) ?? null)
    ),
  }
})

// 73 §6.2 rule 1: the movement is valued at the part's frozen standard, read
// after `setFirstStandardCostFromReceipt` has had its chance to write one.
vi.mock('../../costing/standard-cost-queries', async () => {
  const { ok } = await import('neverthrow')
  return {
    readStandardCost: vi.fn(async (_db: unknown, _org: string, partIds: string[]) => {
      const map = new Map<string, { standardCost: number }>()
      for (const id of partIds) {
        const value = h.standardCosts.get(id)
        if (value != null) map.set(id, { standardCost: value })
      }
      return ok(map)
    }),
  }
})

vi.mock('../../costing/provisional-standard', async () => {
  const { ok } = await import('neverthrow')
  return {
    replaceProvisionalStandard: (...args: unknown[]) => h.replaceSpy(...args) ?? ok({}),
  }
})

// A part's first receipt gives it a standard cost. Mocked here because the
// real one reads the standard-cost fields, and this file has no database.
vi.mock('../../costing/ensure-standard-cost', () => ({
  ensureStandardCost: h.ensureSpy,
}))
vi.mock('../../costing/roll-unvalued-ancestors', async () => {
  const { ok } = await import('neverthrow')
  return { rollUnvaluedAncestors: async () => ok([]) }
})

vi.mock('../../../field-hooks/post/purchase-order-line-rollups', () => ({
  PURCHASE_ORDER_LINE_ROLLUPS: {
    received: { targetAttr: 'purchase_order_line_quantity_received' },
  },
  recalculatePurchaseOrderLineRollups: (...args: unknown[]) => h.settleSpy(...args),
}))

// The posting seam has its own tests (`postings/__tests__/post-inventory-movement.test.ts`);
// this file is about how MANY times it is called, and with what members.
vi.mock('../../../accounting/ledger/post/post-inventory-movement', () => ({
  postInventoryMovementInTx: (...args: unknown[]) => h.postSpy(...args),
  exportInventoryMovement: (...args: unknown[]) => h.exportSpy(...args),
  inventoryTxnDate: (day: Date) => day.toISOString().slice(0, 10),
}))

import type { ReceiveAccrualInput } from '../../../accounting/ledger/builders/inventory-movement'
import { receivePurchaseOrder } from '../receive-purchase-order'

const ORG = 'org_1'
const USER = 'user_1'
const PRICE_ATTR = 'purchase_order_line_expected_unit_price'
const ORDER_ATTR = 'purchase_order_line_purchase_order'
const COST_ATTRS = ['stock_movement_unit_cost', 'stock_movement_cost_basis']

/** The write and its posting share one transaction, so the stub has to run it. */
const db = {
  transaction: async (fn: (tx: unknown) => unknown) => fn(db),
} as never

/** One `SystemRecord` per requested line that `h.prices` knows about, in request order. */
function purchaseOrderLineRecords(ids: string[]) {
  return ids
    .filter((id) => h.prices.has(id))
    .map((id, index) => ({
      id,
      number: (attr: string) => (attr === PRICE_ATTR ? (h.prices.get(id) ?? null) : null),
      related: (attr: string) =>
        attr === ORDER_ATTR && h.materialised.has(ORDER_ATTR) ? (h.orderIds[index] ?? null) : null,
    }))
}

const line = (
  overrides: Partial<ReceivePurchaseOrderLineInput> = {}
): ReceivePurchaseOrderLineInput => ({
  partId: 'part_1',
  purchaseOrderLineId: 'pol_1',
  quantity: 1,
  ...overrides,
})

beforeEach(() => {
  vi.clearAllMocks()
  h.materialised = new Set([PRICE_ATTR, ORDER_ATTR, ...COST_ATTRS])
  h.defs = new Map([
    ['part', 'def_part'],
    ['stock_movement', 'def_mv'],
    ['vendor_part', 'def_vp'],
    ['purchase_order_line', 'def_pol'],
  ])
  h.prices = new Map([
    ['pol_1', 1000],
    ['pol_2', 500],
    ['pol_3', 300],
  ])
  h.orderIds = ['po_1']
  h.readRecords.mockImplementation(
    async (_db: unknown, _org: string, _ctx: unknown, options: { ids: string[] }) =>
      purchaseOrderLineRecords(options.ids)
  )
  h.partKind = null
  h.partKinds = new Map()
  h.vendorTerms = new Map()
  h.standardCosts = new Map()
  h.replaceSpy.mockImplementation(async () => {
    const { ok } = await import('neverthrow')
    return ok({
      replaced: false,
      previousStandard: null,
      newStandard: null,
      revaluationPostedMinor: 0,
    })
  })
  h.settleSpy.mockResolvedValue(undefined)
  h.postSpy.mockResolvedValue(null)
  h.exportSpy.mockResolvedValue(null)
  h.ensureSpy.mockImplementation(async (_db: unknown, _org: string, partIds: string[]) => {
    const { ok } = await import('neverthrow')
    return ok({ writtenPartIds: partIds })
  })
  let counter = 0
  h.createSpy.mockImplementation(async () => ({ instance: { id: `mv_${++counter}` } }))
})

async function expectErr(promise: ReturnType<typeof receivePurchaseOrder>) {
  const result = await promise
  expect(result.isErr()).toBe(true)
  return result._unsafeUnwrapErr()
}

/** The values bag handed to `UnifiedCrudHandler.create` for movement `index`. */
function writtenValues(index: number): Record<string, unknown> {
  return h.createSpy.mock.calls[index]![1] as Record<string, unknown>
}

describe('receivePurchaseOrder — validation', () => {
  it('refuses a receipt with no lines', async () => {
    const error = await expectErr(receivePurchaseOrder(db, ORG, USER, { lines: [] }))
    expect(error).toBeInstanceOf(BadRequestError)
    expect(h.createSpy).not.toHaveBeenCalled()
  })

  it('refuses a line with no part', async () => {
    const error = await expectErr(
      receivePurchaseOrder(db, ORG, USER, { lines: [line({ partId: '' })] })
    )
    expect(error).toBeInstanceOf(BadRequestError)
  })

  it('refuses a line with no purchase order line', async () => {
    // Since the price moved server-side this link is not merely provenance: it
    // is the only way this door can find out what the line cost.
    const error = await expectErr(
      receivePurchaseOrder(db, ORG, USER, { lines: [line({ purchaseOrderLineId: '' })] })
    )
    expect(error).toBeInstanceOf(BadRequestError)
  })

  it.each([0, -1, Number.NaN])('refuses a line quantity of %s', async (quantity) => {
    const error = await expectErr(
      receivePurchaseOrder(db, ORG, USER, { lines: [line({ quantity })] })
    )
    expect(error).toBeInstanceOf(BadRequestError)
  })

  it('validates the WHOLE set before writing anything', async () => {
    // A partial write is worse than a rejection: there is no undo for a ledger
    // entry, only a compensating one.
    const error = await expectErr(
      receivePurchaseOrder(db, ORG, USER, {
        lines: [line(), line({ partId: 'part_2', purchaseOrderLineId: '' })],
      })
    )
    expect(error).toBeInstanceOf(BadRequestError)
    expect(h.createSpy).not.toHaveBeenCalled()
  })

  it('refuses to write before the purchase order price field is provisioned', async () => {
    h.materialised.delete(PRICE_ATTR)
    const error = await expectErr(receivePurchaseOrder(db, ORG, USER, { lines: [line()] }))
    expect(error).toBeInstanceOf(UnprocessableEntityError)
    expect(h.createSpy).not.toHaveBeenCalled()
  })

  it('refuses to write before the stock movement cost fields are provisioned', async () => {
    h.materialised.delete('stock_movement_unit_cost')
    const error = await expectErr(receivePurchaseOrder(db, ORG, USER, { lines: [line()] }))
    expect(error).toBeInstanceOf(UnprocessableEntityError)
    expect(h.createSpy).not.toHaveBeenCalled()
  })

  it('fails with NotFound when the org has no stock_movement definition', async () => {
    h.defs.delete('stock_movement')
    const error = await expectErr(receivePurchaseOrder(db, ORG, USER, { lines: [line()] }))
    expect(error).toBeInstanceOf(NotFoundError)
  })
})

describe('receivePurchaseOrder — a service is never received (107-D10)', () => {
  it('drops a service line and still receives the goods beside it', async () => {
    h.partKinds = new Map([['part_svc', 'service']])
    const result = await receivePurchaseOrder(db, ORG, USER, {
      lines: [line(), line({ partId: 'part_svc', purchaseOrderLineId: 'pol_2' })],
    })
    expect(result._unsafeUnwrap().map((record) => record.purchaseOrderLineId)).toEqual(['pol_1'])
    expect(h.createSpy).toHaveBeenCalledTimes(1)
  })

  it('refuses a receipt of services only, writing nothing', async () => {
    h.partKinds = new Map([['part_svc', 'service']])
    const error = await expectErr(
      receivePurchaseOrder(db, ORG, USER, { lines: [line({ partId: 'part_svc' })] })
    )
    expect(error).toBeInstanceOf(BadRequestError)
    expect(h.createSpy).not.toHaveBeenCalled()
  })
})

describe('receivePurchaseOrder — the price comes from the purchase order line', () => {
  it('values the movement at the stored expected unit price of its line', async () => {
    h.prices = new Map([['pol_1', 1250]])
    await receivePurchaseOrder(db, ORG, USER, { lines: [line({ quantity: 4 })] })
    expect(writtenValues(0).stock_movement_unit_cost).toBe(1250)
    expect(writtenValues(0).stock_movement_vendor_unit_price).toBe(1250)
  })

  it('🛑 ignores a price asserted by the client', async () => {
    // The defect this change exists for: receipt 3 on PO-0001 is valued at
    // $200.00 against an agreed $12.50, because somebody typed 200 into a box.
    h.prices = new Map([['pol_1', 1250]])
    await receivePurchaseOrder(db, ORG, USER, {
      // A stale client still sending the old fields. The types no longer permit
      // it; the runtime must not honour it either.
      lines: [{ ...line(), unitPrice: 20_000, weight: 12 } as ReceivePurchaseOrderLineInput],
    })
    expect(writtenValues(0).stock_movement_unit_cost).toBe(1250)
    expect(writtenValues(0).stock_movement_vendor_unit_price).toBe(1250)
  })

  it('prices each line from its OWN purchase order line', async () => {
    h.prices = new Map([
      ['pol_1', 1250],
      ['pol_2', 99],
    ])
    await receivePurchaseOrder(db, ORG, USER, {
      lines: [line(), line({ partId: 'part_2', purchaseOrderLineId: 'pol_2' })],
    })
    expect(writtenValues(0).stock_movement_unit_cost).toBe(1250)
    expect(writtenValues(1).stock_movement_unit_cost).toBe(99)
  })

  it('reads every line in ONE read, not one per line', async () => {
    await receivePurchaseOrder(db, ORG, USER, {
      lines: [
        line(),
        line({ partId: 'part_2', purchaseOrderLineId: 'pol_2' }),
        line({ partId: 'part_3', purchaseOrderLineId: 'pol_3' }),
      ],
    })
    // One read for the whole set: the price and the parent order come off the
    // same records, so neither scales with the line count.
    expect(h.readRecords).toHaveBeenCalledTimes(1)
    expect(h.createSpy).toHaveBeenCalledTimes(3)
  })

  it.each([
    ['missing entirely', undefined],
    ['stored as null', null],
    ['stored as zero', 0],
    ['stored negative', -500],
  ])('refuses a line whose agreed price is %s, writing NO movements', async (_label, stored) => {
    h.prices = new Map([['pol_1', 1000]])
    if (stored !== undefined) h.prices.set('pol_2', stored as number | null)

    const error = await expectErr(
      receivePurchaseOrder(db, ORG, USER, {
        lines: [line(), line({ partId: 'part_2', purchaseOrderLineId: 'pol_2' })],
      })
    )
    expect(error).toBeInstanceOf(UnprocessableEntityError)
    // The whole set is priced before the first movement, so the GOOD line is not
    // written either — a half-received shipment is worse than a rejected one.
    expect(h.createSpy).not.toHaveBeenCalled()
  })

  it('names the offending line in the refusal', async () => {
    h.prices = new Map([['pol_1', 1000]])
    const error = await expectErr(
      receivePurchaseOrder(db, ORG, USER, {
        lines: [line(), line({ partId: 'part_2', purchaseOrderLineId: 'pol_2' })],
      })
    )
    expect(error.message).toContain('Line 2')
    expect(error.message).toContain('pol_2')
  })

  it('does not fall back to the vendor part when the line has no price', async () => {
    // vendor_part holds standing terms that may be months newer than the order.
    // A missing agreed price is a data problem on the order, not a price to guess.
    h.prices = new Map()
    const error = await expectErr(
      receivePurchaseOrder(db, ORG, USER, { lines: [line({ vendorPartId: 'vp_1' })] })
    )
    expect(error).toBeInstanceOf(UnprocessableEntityError)
    expect(h.createSpy).not.toHaveBeenCalled()
  })
})

describe('receivePurchaseOrder — nothing is allocated at receipt', () => {
  it('capitalises nothing onto the unit cost: landed == agreed', async () => {
    // The old behaviour spread the ORDER's shipping across every receipt, so the
    // same $40.00 of freight was capitalised once per delivery. Freight is the
    // bill's number now (section 4.2).
    h.prices = new Map([['pol_1', 1000]])
    await receivePurchaseOrder(db, ORG, USER, { lines: [line({ quantity: 10 })] })
    expect(writtenValues(0).stock_movement_unit_cost).toBe(1000)
  })

  it('values two receipts of the same line identically', async () => {
    // The double-count in the plan (section 1.1) is exactly this asymmetry: four
    // receipts of one line, three of them carrying the whole freight charge.
    h.prices = new Map([['pol_1', 1250]])
    await receivePurchaseOrder(db, ORG, USER, { lines: [line({ quantity: 99_997 })] })
    const firstReceiptCost = writtenValues(0).stock_movement_unit_cost
    await receivePurchaseOrder(db, ORG, USER, { lines: [line({ quantity: 1 })] })
    expect(firstReceiptCost).toBe(1250)
    expect(writtenValues(1).stock_movement_unit_cost).toBe(1250)
  })
})

// 73 §6.2 rule 1 and §7.2. M: agreed 12.00, shipping 0.10, tariff 25%, other 0
// -> landed standard 16.00. Receiving 10 debits Raw 160.00 and owes the vendor
// 120.00, the carrier 1.00 and the broker 30.00.
describe('receivePurchaseOrder — the standard is frozen and the landed parts accrue', () => {
  beforeEach(() => {
    h.prices = new Map([['pol_1', 1_200]])
    h.vendorTerms.set('vp_1', { shippingCost: 100, otherCost: 0, tariffRate: 25 })
    h.standardCosts.set('part_1', 1_600)
  })

  it('values the movement at the STANDARD, keeping the agreed price as provenance', async () => {
    await receivePurchaseOrder(db, ORG, USER, {
      lines: [line({ quantity: 10, vendorPartId: 'vp_1' })],
    })
    expect(writtenValues(0).stock_movement_unit_cost).toBe(1_600)
    expect(writtenValues(0).stock_movement_vendor_unit_price).toBe(1_200)
    expect(writtenValues(0).stock_movement_cost_basis).toBe('standard')
  })

  it('stamps what it accrued, and the rate behind it', async () => {
    await receivePurchaseOrder(db, ORG, USER, {
      lines: [line({ quantity: 10, vendorPartId: 'vp_1' })],
    })
    expect(writtenValues(0).stock_movement_freight_accrued).toBe(1_000)
    expect(writtenValues(0).stock_movement_duties_accrued).toBe(3_000)
    expect(writtenValues(0).stock_movement_tariff_rate).toBe(25)
  })

  it('hands the posting the three credit amounts: 120 goods, 10 freight, 30 duty', async () => {
    await receivePurchaseOrder(db, ORG, USER, {
      lines: [line({ quantity: 10, vendorPartId: 'vp_1' })],
    })
    const input = h.postSpy.mock.calls[0]![1] as { movements: Array<{ accrual: unknown }> }
    expect(input.movements[0]!.accrual).toEqual({
      grniMinor: 12_000,
      freightMinor: 1_000,
      dutiesMinor: 3_000,
    })
  })

  it('accrues no duty for an org with no tariffs', async () => {
    h.vendorTerms.set('vp_1', { shippingCost: 100, otherCost: 0, tariffRate: null })
    h.standardCosts.set('part_1', 1_300)
    await receivePurchaseOrder(db, ORG, USER, {
      lines: [line({ quantity: 10, vendorPartId: 'vp_1' })],
    })
    const input = h.postSpy.mock.calls[0]![1] as { movements: Array<{ accrual: unknown }> }
    expect(input.movements[0]!.accrual).toEqual({
      grniMinor: 12_000,
      freightMinor: 1_000,
      dutiesMinor: 0,
    })
    expect(writtenValues(0).stock_movement_duties_accrued).toBeUndefined()
  })

  it('accrues nothing when the line names no supplier row', async () => {
    h.standardCosts.set('part_1', 1_200)
    await receivePurchaseOrder(db, ORG, USER, { lines: [line({ quantity: 10 })] })
    const input = h.postSpy.mock.calls[0]![1] as { movements: Array<{ accrual: unknown }> }
    expect(input.movements[0]!.accrual).toEqual({
      grniMinor: 12_000,
      freightMinor: 0,
      dutiesMinor: 0,
    })
  })

  // §6.4: the standard is replaced by today's LANDED estimate, not the agreed
  // price alone, which is what makes the receipt's `ppv` remainder zero without
  // any flag telling the builder to suppress it.
  it('hands the provisional replace the landed estimate, not the agreed price', async () => {
    await receivePurchaseOrder(db, ORG, USER, {
      lines: [line({ quantity: 10, vendorPartId: 'vp_1' })],
    })
    // 1_200 + 100 shipping + 300 duty + 0 other
    expect(h.replaceSpy.mock.calls[0]![4]).toBe(1_600)
    expect(h.ensureSpy.mock.calls[0]![3]).toEqual({ kind: 'receipt', unitCost: 1_600 })
  })

  it('posts no ppv on a provisional first receipt: standard and accruals agree', async () => {
    await receivePurchaseOrder(db, ORG, USER, {
      lines: [line({ quantity: 10, vendorPartId: 'vp_1' })],
    })
    const input = h.postSpy.mock.calls[0]![1] as {
      movements: Array<{ extendedCostMinor: number; accrual: ReceiveAccrualInput }>
    }
    const movement = input.movements[0]!
    const accrued =
      movement.accrual.grniMinor + movement.accrual.freightMinor + movement.accrual.dutiesMinor
    expect(accrued).toBe(movement.extendedCostMinor)
  })

  it('leaves the remainder in ppv when the agreed price has moved off the standard', async () => {
    // 73 §6.3: standard 12.00, agreed 14.00, 20 received -> PPV 40.00 debit.
    h.prices = new Map([['pol_1', 1_400]])
    h.vendorTerms = new Map()
    h.standardCosts.set('part_1', 1_200)
    await receivePurchaseOrder(db, ORG, USER, { lines: [line({ quantity: 20 })] })
    const input = h.postSpy.mock.calls[0]![1] as {
      movements: Array<{ extendedCostMinor: number; accrual: ReceiveAccrualInput }>
    }
    const movement = input.movements[0]!
    expect(movement.extendedCostMinor).toBe(24_000)
    expect(movement.accrual.grniMinor).toBe(28_000)
  })

  it('103 §5a - receives at a $0 standard and still posts the accruals, the price all ppv', async () => {
    h.standardCosts.set('part_1', 0)
    await receivePurchaseOrder(db, ORG, USER, {
      lines: [line({ quantity: 10, vendorPartId: 'vp_1' })],
    })
    expect(writtenValues(0).stock_movement_unit_cost).toBe(0)
    const input = h.postSpy.mock.calls[0]![1] as {
      movements: Array<{ extendedCostMinor: number; accrual: ReceiveAccrualInput }>
    }
    expect(input.movements).toHaveLength(1)
    expect(input.movements[0]!.extendedCostMinor).toBe(0)
    expect(input.movements[0]!.accrual.grniMinor).toBe(12_000)
  })

  it('falls back to the landed estimate for a part with no readable standard', async () => {
    h.standardCosts = new Map()
    await receivePurchaseOrder(db, ORG, USER, {
      lines: [line({ quantity: 10, vendorPartId: 'vp_1' })],
    })
    expect(writtenValues(0).stock_movement_unit_cost).toBe(1_600)
  })
})

describe('receivePurchaseOrder — one movement per line', () => {
  it('writes a movement for every line, each linked to its purchase order line', async () => {
    const result = await receivePurchaseOrder(db, ORG, USER, {
      lines: [
        line({ partId: 'part_1', purchaseOrderLineId: 'pol_1' }),
        line({ partId: 'part_2', purchaseOrderLineId: 'pol_2', quantity: 4 }),
      ],
    })
    expect(result.isOk()).toBe(true)
    const records = result._unsafeUnwrap()
    expect(records).toHaveLength(2)
    expect(records[0]!.purchaseOrderLineId).toBe('pol_1')
    expect(records[1]!.purchaseOrderLineId).toBe('pol_2')
    expect(writtenValues(0).stock_movement_purchase_order_line).toBe('def_pol:pol_1')
    expect(writtenValues(1).stock_movement_purchase_order_line).toBe('def_pol:pol_2')
  })

  it('stamps one shared accounting date across every line', async () => {
    const occurredAt = new Date('2026-02-11T00:00:00.000Z')
    const result = await receivePurchaseOrder(db, ORG, USER, {
      lines: [line(), line({ partId: 'part_2', purchaseOrderLineId: 'pol_2' })],
      occurredAt,
    })
    const records = result._unsafeUnwrap()
    expect(records[0]!.occurredAt).toBe(occurredAt)
    expect(records[1]!.occurredAt).toBe(occurredAt)
  })

  it('carries the reference and reason onto every movement', async () => {
    await receivePurchaseOrder(db, ORG, USER, {
      lines: [line(), line({ partId: 'part_2', purchaseOrderLineId: 'pol_2' })],
      reference: 'PS-4471',
      reason: 'Split delivery',
    })
    expect(writtenValues(1).stock_movement_reference).toBe('PS-4471')
    expect(writtenValues(1).stock_movement_reason).toBe('Split delivery')
  })

  it('passes the supplier part through when the line names one', async () => {
    await receivePurchaseOrder(db, ORG, USER, { lines: [line({ vendorPartId: 'vp_1' })] })
    expect(writtenValues(0).stock_movement_vendor_part).toBe('def_vp:vp_1')
  })

  it("stamps the GL account resolved from the line's own part kind", async () => {
    h.partKind = 'finished_good'
    await receivePurchaseOrder(db, ORG, USER, { lines: [line()] })
    expect(writtenValues(0).stock_movement_gl_account).toBe('inventory_finished_goods')
  })
})

describe('receivePurchaseOrder — failure propagation', () => {
  it('surfaces a per-line failure with its own status, not as a generic 500', async () => {
    h.createSpy.mockRejectedValueOnce(
      new UnprocessableEntityError('Refusing to write a receipt at zero cost.')
    )
    const error = await expectErr(receivePurchaseOrder(db, ORG, USER, { lines: [line()] }))
    expect(error).toBeInstanceOf(UnprocessableEntityError)
  })

  it('stops at the first failing line rather than writing or posting the rest', async () => {
    h.createSpy.mockRejectedValueOnce(new UnprocessableEntityError('nope'))
    await expectErr(
      receivePurchaseOrder(db, ORG, USER, {
        lines: [line(), line({ partId: 'part_2', purchaseOrderLineId: 'pol_2' })],
      })
    )
    expect(h.createSpy).toHaveBeenCalledTimes(1)
    expect(h.postSpy).not.toHaveBeenCalled()
    expect(h.settleSpy).not.toHaveBeenCalled()
  })
})

// 🛑 The fix this file exists to pin: `plans/accounting/STATE.md` §0(c) — a PO
// receipt used to post once PER RECEIVED LINE (by delegating to `receiveStock`,
// which opens its own transaction and posts its own entry, once per call) instead
// of once per goods receipt (TARGET §5).
describe('receivePurchaseOrder — one posting for the whole receipt', () => {
  it('posts ONCE for a multi-line receipt, with every movement linked as a member', async () => {
    await receivePurchaseOrder(db, ORG, USER, {
      lines: [
        line({ partId: 'part_1', purchaseOrderLineId: 'pol_1' }),
        line({ partId: 'part_2', purchaseOrderLineId: 'pol_2' }),
        line({ partId: 'part_3', purchaseOrderLineId: 'pol_3' }),
      ],
    })

    expect(h.postSpy).toHaveBeenCalledTimes(1)
    const input = h.postSpy.mock.calls[0]![1] as {
      kind: string
      subject: { sourceKind: string; sourceId: string }
      movements: unknown[]
    }
    expect(input.kind).toBe('receive')
    // The first movement anchors the claim; every movement — itself included —
    // is still linked as a member below.
    expect(input.subject).toEqual({ sourceKind: 'stock_movement', sourceId: 'mv_1' })
    expect(input.movements).toHaveLength(3)
  })

  it('still posts exactly once for a single-line receipt', async () => {
    await receivePurchaseOrder(db, ORG, USER, { lines: [line()] })
    expect(h.postSpy).toHaveBeenCalledTimes(1)
    const input = h.postSpy.mock.calls[0]![1] as { movements: unknown[] }
    expect(input.movements).toHaveLength(1)
  })

  it('links the purchase order every line belongs to as the posting’s parent', async () => {
    h.orderIds = ['po_1']
    await receivePurchaseOrder(db, ORG, USER, {
      lines: [
        line({ partId: 'part_1', purchaseOrderLineId: 'pol_1' }),
        line({ partId: 'part_2', purchaseOrderLineId: 'pol_2' }),
      ],
    })
    const input = h.postSpy.mock.calls[0]![1] as {
      parents?: { sourceKind: string; sourceId: string }[]
    }
    expect(input.parents).toEqual([{ sourceKind: 'purchase_order', sourceId: 'po_1' }])
  })

  it('refuses a receipt whose lines belong to more than one purchase order', async () => {
    h.orderIds = ['po_1', 'po_2']
    const error = await expectErr(
      receivePurchaseOrder(db, ORG, USER, {
        lines: [
          line({ partId: 'part_1', purchaseOrderLineId: 'pol_1' }),
          line({ partId: 'part_2', purchaseOrderLineId: 'pol_2' }),
        ],
      })
    )
    expect(error).toBeInstanceOf(BadRequestError)
    // Refused before anything is written — a receipt naming two orders has
    // nowhere honest to put a single `parent` link.
    expect(h.createSpy).not.toHaveBeenCalled()
    expect(h.postSpy).not.toHaveBeenCalled()
  })

  it('posts with no parent when the order relation is not materialised', async () => {
    h.materialised.delete(ORDER_ATTR)
    await receivePurchaseOrder(db, ORG, USER, { lines: [line()] })
    const input = h.postSpy.mock.calls[0]![1] as { parents?: unknown }
    expect(input.parents).toBeUndefined()
  })

  it('exports the posted entry once, after the transaction commits', async () => {
    h.postSpy.mockResolvedValueOnce({ status: 'posted', glPostingId: 'gl_1' })
    await receivePurchaseOrder(db, ORG, USER, {
      lines: [line(), line({ partId: 'part_2', purchaseOrderLineId: 'pol_2' })],
    })
    expect(h.exportSpy).toHaveBeenCalledTimes(1)
  })

  it('posts before the roll-up settles, both after every movement is written', async () => {
    const order: string[] = []
    h.createSpy.mockImplementation(async () => {
      order.push('movement')
      return { instance: { id: `mv_${order.length}` } }
    })
    h.postSpy.mockImplementation(async () => {
      order.push('post')
      return null
    })
    h.settleSpy.mockImplementation(async () => {
      order.push('settle')
    })

    await receivePurchaseOrder(db, ORG, USER, {
      lines: [line(), line({ partId: 'part_2', purchaseOrderLineId: 'pol_2' })],
    })

    expect(order).toEqual(['movement', 'movement', 'post', 'settle'])
  })
})

describe('receivePurchaseOrder — the roll-up is settled once, not once per line', () => {
  it('🛑 rolls the WHOLE line set up in one call after the last movement', async () => {
    // The amplifier this exists to remove: `stock_movement` create fires a
    // lifecycle rule per row, and that rule derives the entire purchase order.
    // Ten lines meant ten identical derivations. One batched call knows the
    // whole set and does it once.
    await receivePurchaseOrder(db, ORG, USER, {
      lines: [line(), line({ partId: 'part_2', purchaseOrderLineId: 'pol_2' })],
    })

    expect(h.settleSpy).toHaveBeenCalledTimes(1)
    expect(h.settleSpy).toHaveBeenCalledWith(
      ORG,
      ['pol_1', 'pol_2'],
      expect.objectContaining({ targetAttr: 'purchase_order_line_quantity_received' })
    )
  })

  it('does not settle when the receipt was refused before writing anything', async () => {
    h.prices = new Map()
    await receivePurchaseOrder(db, ORG, USER, { lines: [line()] })
    expect(h.settleSpy).not.toHaveBeenCalled()
  })

  it('🛑 still reports the receipt as written when the roll-up fails', async () => {
    // The movements are the primary fact and are already committed. Throwing
    // here would report a receipt that happened as a receipt that failed — and
    // the per-movement lifecycle rules are the fallback, so the quantity still
    // lands.
    h.settleSpy.mockRejectedValue(new Error('roll-up exploded'))

    const result = await receivePurchaseOrder(db, ORG, USER, { lines: [line()] })

    expect(result.isOk()).toBe(true)
    expect(result._unsafeUnwrap()).toHaveLength(1)
  })
})

describe('receivePurchaseOrder — the post-commit QoH recalculation', () => {
  it('🛑 still reports the receipt as written when the recalculation fails', async () => {
    // The movements are committed by then, and the per-movement hook writes the
    // same rows behind this call. The receipt that reported "failed" while the
    // order showed the goods received is the bug this pins.
    h.qohSpy.mockRejectedValue(new Error('FieldValue_entity_field_sortKey_key'))

    const result = await receivePurchaseOrder(db, ORG, USER, { lines: [line()] })

    expect(result.isOk()).toBe(true)
    expect(result._unsafeUnwrap()).toHaveLength(1)
    h.qohSpy.mockResolvedValue(undefined)
  })

  it('recalculates each received part exactly once', async () => {
    await receivePurchaseOrder(db, ORG, USER, {
      lines: [line(), line({ partId: 'part_2', purchaseOrderLineId: 'pol_2' })],
    })

    expect(h.qohSpy).toHaveBeenCalledTimes(1)
    expect(h.qohSpy).toHaveBeenCalledWith(ORG, ['part_1', 'part_2'])
  })
})
