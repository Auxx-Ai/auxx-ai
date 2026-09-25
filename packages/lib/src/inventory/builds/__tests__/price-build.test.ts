// packages/lib/src/inventory/builds/__tests__/price-build.test.ts
//
// The last leg of a pending build is priced (111 Q18): the five cost fields
// `completeBuild` could not stamp are stamped from the frozen legs, and the
// build's one entry posts through the document poster.

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
  build: null as Record<string, unknown> | null,
  legs: [] as Leg[],
  rates: { laborCostPerUnit: 50, overheadCostPerUnit: 25 },
  update: vi.fn(async (_recordId: string, _values: Record<string, unknown>) => ({})),
  publish: vi.fn(),
  postDocument: vi.fn(async () => ({ status: 'posted' })),
}))

vi.mock('../build-queries', () => ({
  getBuild: async () => ({ isErr: () => false, value: h.build }),
  readBuildMovements: async () => h.legs,
  requireBuildContext: async () => ({ defId: 'def_build', fields: {} }),
  requireBuildMovementContext: async () => ({ defId: 'def_mv', partDefId: 'def_part', fields: {} }),
}))
vi.mock('../complete-build', () => ({ publishBuildUpdate: h.publish }))
vi.mock('../write-lane', () => ({ buildWriteSession: () => ({ kind: 'quiet' }) }))
vi.mock('../../costing/standard-cost-queries', () => ({
  loadPartAbsorptionRates: async () => h.rates,
}))
vi.mock('../../../cache', () => ({ getOrgCache: () => ({ get: async () => 'user_system' }) }))
vi.mock('../../../resources/crud/unified-handler', () => ({
  UnifiedCrudHandler: class {
    update = h.update
  },
}))
vi.mock('../../../accounting/ledger/post/post-inventory-document', () => ({
  postInventoryDocument: h.postDocument,
}))

import { finishPricedBuild } from '../price-build'

const ORG = 'org_1'
const db = {} as never
const COMPLETED = new Date('2026-08-20T09:00:00Z')

function leg(
  movementId: string,
  type: string,
  quantity: number,
  unitCost: number | null,
  extendedCost: number | null
): Leg {
  return {
    movementId,
    partId: type === 'build_produce' ? 'part_lift' : 'part_motor',
    type,
    quantity,
    unitCost,
    extendedCost,
    glAccount: type === 'build_produce' ? 'inventory_finished_goods' : 'inventory_raw_materials',
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  h.build = {
    buildId: 'build_1',
    recordId: 'def_build:build_1',
    partId: 'part_lift',
    orderId: null,
    quantityProduced: 10,
    quantityScrapped: 2,
    // Stamped at completion: an explicit labour figure, overhead left to the rate.
    laborCost: 900,
    overheadCost: 300,
    completedAt: COMPLETED,
  }
  h.legs = [
    leg('mv_c1', 'build_consume', -20, 100, -2_000),
    leg('mv_c2', 'build_consume', -10, 50, -500),
    leg('mv_p', 'build_produce', 10, 400, 4_000),
  ]
})

describe('finishPricedBuild', () => {
  it('leaves a build with a pending leg alone: nothing stamped, nothing posted', async () => {
    h.legs[0] = leg('mv_c1', 'build_consume', -20, null, null)

    const result = await finishPricedBuild(db, ORG, 'build_1')

    expect(result).toEqual({ finished: false, post: null })
    expect(h.update).not.toHaveBeenCalled()
    expect(h.postDocument).not.toHaveBeenCalled()
  })

  it('stamps the five cost fields from the frozen legs and the stamped absorption, then posts the build', async () => {
    const result = await finishPricedBuild(db, ORG, 'build_1')

    expect(result.finished).toBe(true)
    // Material 2,500 (the consume rows, un-negated); labour and overhead as completion stamped
    // them; produced 10 x 400; variance = 2,500 + 900 + 300 - 4,000.
    expect(h.update).toHaveBeenCalledWith('def_build:build_1', {
      build_material_cost: 2_500,
      build_labor_cost: 900,
      build_overhead_cost: 300,
      build_produced_value: 4_000,
      build_variance_amount: -300,
    })
    expect(h.publish).toHaveBeenCalledWith(
      ORG,
      expect.anything(),
      expect.objectContaining({
        buildId: 'build_1',
        materialCost: 2_500,
        varianceAmount: -300,
        pendingPartIds: [],
      }),
      COMPLETED
    )
    expect(h.postDocument).toHaveBeenCalledWith(
      db,
      ORG,
      [
        expect.objectContaining({ movementId: 'mv_c1', buildId: 'build_1', extendedCost: -2_000 }),
        expect.objectContaining({ movementId: 'mv_c2', buildId: 'build_1', extendedCost: -500 }),
        expect.objectContaining({ movementId: 'mv_p', buildId: 'build_1', extendedCost: 4_000 }),
      ],
      { actorUserId: 'user_system' }
    )
    // The stamps land before the post, so the poster's `absorbed` reads them back.
    expect(h.update.mock.invocationCallOrder[0]!).toBeLessThan(
      h.postDocument.mock.invocationCallOrder[0]!
    )
  })

  it('absorbs from the rates when completion stamped no explicit figure', async () => {
    h.build = { ...h.build!, laborCost: null, overheadCost: null }

    await finishPricedBuild(db, ORG, 'build_1')

    // 12 units started x 50 and x 25.
    expect(h.update).toHaveBeenCalledWith(
      'def_build:build_1',
      expect.objectContaining({ build_labor_cost: 600, build_overhead_cost: 300 })
    )
  })

  it('refuses a build with no valued produce leg', async () => {
    h.legs = [leg('mv_c1', 'build_consume', -20, 100, -2_000)]
    await expect(finishPricedBuild(db, ORG, 'build_1')).rejects.toThrow(/no valued produce leg/)
  })
})
