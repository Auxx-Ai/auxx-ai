// packages/lib/src/accounting/ledger/post/__tests__/post-inventory-document.test.ts
//
// One definition of how a row posts once its writer is gone (111 X3): the kind,
// subject and parents derived from the rows' links. `postInventoryMovementInTx`
// is stubbed - its own test covers the source set and the cutover floor.

import { beforeEach, describe, expect, it, vi } from 'vitest'

interface Leg {
  movementId: string
  partId: string
  type: string
  quantity: number
  unitCost: number | null
  extendedCost: number | null
  glAccount: string | null
}

const h = vi.hoisted(() => ({
  postSpy: vi.fn(async (..._args: unknown[]) => ({ status: 'posted', glPostingId: 'gp_1' })),
  exportSpy: vi.fn(async (_db: unknown, post: unknown) => post),
  build: null as Record<string, unknown> | null,
  legs: [] as Leg[],
  standards: new Map<string, Record<string, number | null>>(),
  /** `fulfillment_line` id -> fulfillment id, and fulfillment id -> order id. */
  lineFulfillment: new Map<string, string>(),
  fulfillmentOrder: new Map<string, string>(),
}))

vi.mock('../post-inventory-movement', () => ({
  postInventoryMovementInTx: (...args: unknown[]) => h.postSpy(...args),
  exportInventoryMovement: (db: unknown, post: unknown) => h.exportSpy(db, post),
}))
vi.mock('../../../../inventory/builds/build-queries', () => ({
  getBuild: async () => ({ isErr: () => false, value: h.build }),
  readBuildMovements: async () => h.legs,
  requireBuildMovementContext: async () => ({ defId: 'def_mv', partDefId: 'def_part', fields: {} }),
}))
vi.mock('../../../../inventory/costing/standard-cost-queries', () => ({
  readStandardCost: async (_db: unknown, _org: string, partIds: string[]) => ({
    isErr: () => false,
    value: new Map(
      partIds.flatMap((id) => (h.standards.has(id) ? [[id, h.standards.get(id)!]] : []))
    ),
  }),
}))
vi.mock('../../../sales/fulfillments/fields', () => ({
  loadFulfillmentFieldContext: async () => ({
    fulfillment: { defId: 'def_ful', fields: {} },
    line: { defId: 'def_line', fields: {} },
  }),
}))
vi.mock('../../../../resources/system-records', () => ({
  systemFields: async () => ({ defId: 'def_mv', fields: {} }),
  readSystemRecords: async (
    _db: unknown,
    _org: string,
    ctx: { defId: string },
    options: { ids: string[] }
  ) =>
    options.ids.flatMap((id) => {
      if (ctx.defId === 'def_line') {
        const fulfillmentId = h.lineFulfillment.get(id)
        return fulfillmentId ? [{ id, related: () => fulfillmentId }] : []
      }
      if (ctx.defId === 'def_ful') {
        const orderId = h.fulfillmentOrder.get(id)
        return orderId ? [{ id, related: () => orderId }] : []
      }
      return []
    }),
}))

import {
  inventoryDocumentKind,
  postInventoryDocument,
  postInventoryDocumentInTx,
} from '../post-inventory-document'

const ORG = 'org_1'
const TX = {} as never
const SHIPPED = new Date('2026-08-18T12:00:00Z')

function row(
  movementId: string,
  extra: Partial<{
    partInstanceId: string
    type: string
    quantity: number
    extendedCost: number
    glAccount: string | null
    fulfillmentLineId: string | null
    buildId: string | null
    vendorUnitPrice: number | null
    freightAccrued: number | null
    dutiesAccrued: number | null
  }> = {}
) {
  return {
    movementId,
    partInstanceId: 'part_1',
    type: 'sale',
    quantity: -2,
    extendedCost: -2_000,
    glAccount: 'inventory_finished_goods',
    occurredAt: SHIPPED,
    ...extra,
  }
}

function lastInput(): Record<string, unknown> {
  return h.postSpy.mock.calls.at(-1)![1] as Record<string, unknown>
}

beforeEach(() => {
  vi.clearAllMocks()
  h.build = null
  h.legs = []
  h.standards = new Map([
    ['part_1', { standardCost: 1_000, standardLaborCost: 200, standardOverheadCost: 100 }],
  ])
  h.lineFulfillment = new Map([['line_1', 'ful_1']])
  h.fulfillmentOrder = new Map([['ful_1', 'ord_1']])
})

describe('inventoryDocumentKind', () => {
  it('reads the links ahead of the type, then the type', () => {
    expect(inventoryDocumentKind([row('a', { type: 'build_consume', buildId: 'b1' })])).toBe(
      'build'
    )
    expect(inventoryDocumentKind([row('a', { fulfillmentLineId: 'line_1' })])).toBe('sale')
    expect(inventoryDocumentKind([row('a', { type: 'adjust' })])).toBe('adjust')
    expect(inventoryDocumentKind([row('a', { type: 'initial' })])).toBe('opening')
    expect(inventoryDocumentKind([row('a', { type: 'scrap' })])).toBe('scrap')
    expect(inventoryDocumentKind([row('a', { type: 'return_in' })])).toBe('return')
    expect(inventoryDocumentKind([row('a', { type: 'receive' })])).toBe('receive')
    expect(inventoryDocumentKind([row('a', { type: 'revalue' })])).toBe('revalue')
  })

  it('refuses a return to the vendor - its entry is the credit document', () => {
    expect(() => inventoryDocumentKind([row('a', { type: 'return_out' })])).toThrow(/vendor credit/)
  })
})

describe('a relief pass', () => {
  it('posts kind sale, claims the FIRST row of the pass, parents the dispatch and its order, dated the ship date', async () => {
    await postInventoryDocumentInTx(
      TX,
      ORG,
      [
        row('mv_2', { fulfillmentLineId: 'line_1' }),
        row('mv_3', { fulfillmentLineId: 'line_1', quantity: -1, extendedCost: -1_000 }),
      ],
      { actorUserId: 'user_1' }
    )
    expect(lastInput()).toMatchObject({
      organizationId: ORG,
      kind: 'sale',
      subject: { sourceKind: 'stock_movement', sourceId: 'mv_2' },
      parents: [
        { sourceKind: 'fulfillment', sourceId: 'ful_1' },
        { sourceKind: 'order', sourceId: 'ord_1' },
      ],
      occurredAt: SHIPPED,
      actorUserId: 'user_1',
      movements: [
        { id: 'mv_2', extendedCostMinor: -2_000, glAccountRole: 'inventory_finished_goods' },
        { id: 'mv_3', extendedCostMinor: -1_000, glAccountRole: 'inventory_finished_goods' },
      ],
    })
  })

  it("splits COGS by each part's standard composition, exactly as relief does", async () => {
    await postInventoryDocumentInTx(TX, ORG, [
      row('mv_2', { fulfillmentLineId: 'line_1', quantity: -2, extendedCost: -2_000 }),
    ])
    // 2 units x (labour 200, overhead 100), signed like the COGS debit.
    expect(lastInput().cogsSplit).toEqual({ laborMinor: 400, overheadMinor: 200 })
  })

  it('posts with no parents when the line no longer resolves, rather than refusing', async () => {
    h.lineFulfillment.clear()
    await postInventoryDocumentInTx(TX, ORG, [row('mv_2', { fulfillmentLineId: 'line_x' })])
    expect(lastInput()).not.toHaveProperty('parents')
    expect(lastInput().kind).toBe('sale')
  })
})

describe('a build', () => {
  const COMPLETED = new Date('2026-08-20T09:00:00Z')

  beforeEach(() => {
    h.build = {
      buildId: 'build_1',
      recordId: 'def_build:build_1',
      orderId: 'ord_9',
      laborCost: 500,
      overheadCost: 250,
      completedAt: COMPLETED,
    }
    h.legs = [
      leg('mv_c', 'build_consume', -20, 100, -2_000, 'inventory_raw_materials'),
      leg('mv_p', 'build_produce', 10, 300, 3_000, 'inventory_finished_goods'),
    ]
  })

  it('claims the build id, parents its order, absorbs the stamped labour and overhead, and books every leg', async () => {
    await postInventoryDocumentInTx(TX, ORG, [
      row('mv_p', { type: 'build_produce', buildId: 'build_1' }),
    ])
    expect(lastInput()).toMatchObject({
      kind: 'build',
      subject: { sourceKind: 'build', sourceId: 'build_1' },
      parents: [{ sourceKind: 'order', sourceId: 'ord_9' }],
      absorbed: { laborMinor: 500, overheadMinor: 250 },
      occurredAt: COMPLETED,
      movements: [
        { id: 'mv_c', extendedCostMinor: -2_000, glAccountRole: 'inventory_raw_materials' },
        { id: 'mv_p', extendedCostMinor: 3_000, glAccountRole: 'inventory_finished_goods' },
      ],
    })
  })

  it('refuses while any leg is still pending: the build id can be claimed once', async () => {
    h.legs[0] = leg('mv_c', 'build_consume', -20, null, null, 'inventory_raw_materials')
    await expect(
      postInventoryDocumentInTx(TX, ORG, [
        row('mv_p', { type: 'build_produce', buildId: 'build_1' }),
      ])
    ).rejects.toThrow(/waiting for a standard cost/)
    expect(h.postSpy).not.toHaveBeenCalled()
  })
})

describe('the single-row documents', () => {
  it('an adjust claims its own movement and posts kind adjust', async () => {
    await postInventoryDocumentInTx(
      TX,
      ORG,
      [row('mv_a', { type: 'adjust', quantity: 3, extendedCost: 3_000 })],
      {
        memo: 'Cycle count',
      }
    )
    expect(lastInput()).toMatchObject({
      kind: 'adjust',
      subject: { sourceKind: 'stock_movement', sourceId: 'mv_a' },
      memo: 'Cycle count',
      movements: [{ id: 'mv_a', extendedCostMinor: 3_000 }],
    })
    expect(lastInput()).not.toHaveProperty('cogsSplit')
  })

  it('an initial posts kind opening; a scrap posts scrap; a salvage return_in posts return', async () => {
    await postInventoryDocumentInTx(TX, ORG, [
      row('mv_i', { type: 'initial', quantity: 5, extendedCost: 5_000 }),
    ])
    expect(lastInput().kind).toBe('opening')
    await postInventoryDocumentInTx(TX, ORG, [
      row('mv_s', { type: 'scrap', quantity: -1, extendedCost: -1_000 }),
    ])
    expect(lastInput().kind).toBe('scrap')
    await postInventoryDocumentInTx(TX, ORG, [
      row('mv_r', { type: 'return_in', quantity: 1, extendedCost: 1_000 }),
    ])
    expect(lastInput().kind).toBe('return')
  })

  it('a receipt against a supplier row carries its accrual split, one against none carries no accrual', async () => {
    await postInventoryDocumentInTx(TX, ORG, [
      row('mv_rc', {
        type: 'receive',
        quantity: 4,
        extendedCost: 4_000,
        vendorUnitPrice: 900,
        freightAccrued: 80,
        dutiesAccrued: 40,
      }),
    ])
    expect(lastInput().movements).toEqual([
      expect.objectContaining({
        id: 'mv_rc',
        accrual: { grniMinor: 3_600, freightMinor: 80, dutiesMinor: 40 },
      }),
    ])
    await postInventoryDocumentInTx(TX, ORG, [
      row('mv_rc2', { type: 'receive', quantity: 4, extendedCost: 4_000 }),
    ])
    expect((lastInput().movements as unknown[])[0]).not.toHaveProperty('accrual')
  })

  it('drops a zero-cost row from the entry and posts nothing for an empty document', async () => {
    await postInventoryDocumentInTx(TX, ORG, [
      row('mv_z', { type: 'adjust', extendedCost: 0 }),
      row('mv_a', { type: 'adjust', quantity: 3, extendedCost: 3_000 }),
    ])
    expect(lastInput().movements).toEqual([expect.objectContaining({ id: 'mv_a' })])
    expect(await postInventoryDocumentInTx(TX, ORG, [])).toBeNull()
  })

  it('refuses a row with no frozen account', async () => {
    await expect(
      postInventoryDocumentInTx(TX, ORG, [row('mv_a', { type: 'adjust', glAccount: null })])
    ).rejects.toThrow(/no frozen inventory account/)
  })
})

describe('postInventoryDocument', () => {
  it('opens its own transaction and hands the entry to the export', async () => {
    const tx = { marker: 'tx' }
    const db = { transaction: vi.fn(async (run: (tx: unknown) => unknown) => run(tx)) } as never
    const result = await postInventoryDocument(db, ORG, [row('mv_a', { type: 'adjust' })])
    expect(h.postSpy.mock.calls[0]![0]).toBe(tx)
    expect(h.exportSpy).toHaveBeenCalledWith(db, { status: 'posted', glPostingId: 'gp_1' })
    expect(result).toEqual({ status: 'posted', glPostingId: 'gp_1' })
  })
})

function leg(
  movementId: string,
  type: string,
  quantity: number,
  unitCost: number | null,
  extendedCost: number | null,
  glAccount: string
): Leg {
  return { movementId, partId: 'part_x', type, quantity, unitCost, extendedCost, glAccount }
}
