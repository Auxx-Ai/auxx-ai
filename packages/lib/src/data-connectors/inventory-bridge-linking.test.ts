// packages/lib/src/data-connectors/inventory-bridge-linking.test.ts
// B3 linking helpers — link/unlink/apply. crud + store + source-resolver + cache are mocked;
// the db is used only for the numeric field-value reads.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  updateSpy: vi.fn(async () => ({})),
  createSpy: vi.fn(async () => ({})),
  requireDefId: vi.fn(async () => 'def_part'),
  getDefId: vi.fn(async () => 'def_mv'),
  resolveSource: vi.fn(),
  listSources: vi.fn(async () => []),
  upsertLink: vi.fn(async () => ({})),
  deleteLink: vi.fn(async () => {}),
  getLink: vi.fn(),
  advanceCAS: vi.fn(async () => true),
  setMode: vi.fn(async () => {}),
  listForPart: vi.fn(async () => []),
  // number reads: keyed test-side
  numberByField: new Map<string, number>(),
  numberBySysAttr: new Map<string, number>(),
}))

vi.mock('../cache', () => ({
  requireCachedEntityDefId: h.requireDefId,
  getCachedEntityDefId: h.getDefId,
}))
vi.mock('../resources/crud/unified-handler', () => ({
  UnifiedCrudHandler: class {
    update = h.updateSpy
    create = h.createSpy
  },
}))
vi.mock('./inventory-bridge-rule', () => ({
  resolveInventorySource: h.resolveSource,
  listInventorySources: h.listSources,
}))
vi.mock('./inventory-bridge-store', () => ({
  advanceWatermarkCAS: h.advanceCAS,
  deleteInventoryBridgeLink: h.deleteLink,
  getInventoryBridgeLink: h.getLink,
  listInventoryBridgeLinksForPart: h.listForPart,
  setInventoryBridgeLinkMode: h.setMode,
  upsertInventoryBridgeLink: h.upsertLink,
}))

import {
  applyPendingInventoryDelta,
  linkInventorySource,
  unlinkInventorySource,
} from './inventory-bridge-linking'

const ORG = 'org_1'
const USER = 'user_1'
const ENTRY = {
  dataConnectorId: 'dc_1',
  sourceDefId: 'def_variants',
  quantityFieldId: 'fld_qty',
  relationshipFieldId: 'fld_edge',
}

// db resolves FieldValue reads from the hoisted maps; branches on join presence (sysattr).
const db = {
  select() {
    let joined = false
    const chain: Record<string, unknown> = {
      from: () => chain,
      innerJoin: () => {
        joined = true
        return chain
      },
      where: () => chain,
      limit: () =>
        Promise.resolve(
          joined
            ? [...h.numberBySysAttr.values()].slice(0, 1).map((value) => ({ value }))
            : [...h.numberByField.values()].slice(0, 1).map((value) => ({ value }))
        ),
    }
    return chain
  },
} as never

beforeEach(() => {
  vi.clearAllMocks()
  h.numberByField.clear()
  h.numberBySysAttr.clear()
  h.resolveSource.mockResolvedValue(ENTRY)
  h.advanceCAS.mockResolvedValue(true)
  h.requireDefId.mockResolvedValue('def_part')
  h.getDefId.mockResolvedValue('def_mv')
})

describe('linkInventorySource', () => {
  it('sets the source→part edge + baselines the watermark to the current quantity', async () => {
    h.numberByField.set('var_1', 42)
    await linkInventorySource(db, ORG, USER, {
      partInstanceId: 'part_1',
      variantInstanceId: 'var_1',
      sourceDefId: 'def_variants',
      mode: 'auto',
    })

    expect(h.updateSpy).toHaveBeenCalledWith('def_variants:var_1', {
      inventory_bridge_part: 'def_part:part_1',
    })
    expect(h.upsertLink).toHaveBeenCalledWith(
      db,
      expect.objectContaining({
        dataConnectorId: 'dc_1',
        sourceDefId: 'def_variants',
        variantInstanceId: 'var_1',
        partInstanceId: 'part_1',
        lastSeenQuantity: 42,
        mode: 'auto',
      })
    )
    // No baseline seed ⇒ no movement.
    expect(h.createSpy).not.toHaveBeenCalled()
  })

  it('baseline seed ⇒ one adjust movement of (source − partQoH), no sub-part cascade', async () => {
    h.numberByField.set('var_1', 100) // source level
    h.numberBySysAttr.set('part_1', 30) // part QoH
    await linkInventorySource(db, ORG, USER, {
      partInstanceId: 'part_1',
      variantInstanceId: 'var_1',
      sourceDefId: 'def_variants',
      baselineSeed: true,
    })

    expect(h.createSpy).toHaveBeenCalledTimes(1)
    const [, values] = h.createSpy.mock.calls[0]
    expect(values).toMatchObject({
      stock_movement_type: 'adjust',
      stock_movement_quantity: 70,
      stock_movement_adjust_subparts: false,
    })
  })
})

describe('unlinkInventorySource', () => {
  it('clears the edge + deletes the watermark', async () => {
    await unlinkInventorySource(db, ORG, USER, {
      variantInstanceId: 'var_1',
      sourceDefId: 'def_variants',
    })
    expect(h.updateSpy).toHaveBeenCalledWith('def_variants:var_1', { inventory_bridge_part: null })
    expect(h.deleteLink).toHaveBeenCalledWith(db, 'var_1')
  })
})

describe('applyPendingInventoryDelta', () => {
  it('decrease pending ⇒ CAS-advance + sale movement of −Δ, returns Δ', async () => {
    h.getLink.mockResolvedValue({
      id: 'lnk_1',
      sourceDefId: 'def_variants',
      partInstanceId: 'part_1',
      lastSeenQuantity: 10,
      dataConnectorId: 'dc_1',
    })
    h.numberByField.set('var_1', 6)

    const applied = await applyPendingInventoryDelta(db, ORG, USER, 'var_1')

    expect(h.advanceCAS).toHaveBeenCalledWith(db, 'lnk_1', 10, 6)
    expect(h.createSpy).toHaveBeenCalledTimes(1)
    const [, values] = h.createSpy.mock.calls[0]
    expect(values).toMatchObject({
      stock_movement_type: 'sale',
      stock_movement_quantity: -4,
      stock_movement_adjust_subparts: true,
    })
    expect(applied).toBe(4)
  })

  it('no decrease ⇒ no-op, returns 0', async () => {
    h.getLink.mockResolvedValue({
      id: 'lnk_1',
      sourceDefId: 'def_variants',
      partInstanceId: 'part_1',
      lastSeenQuantity: 10,
      dataConnectorId: 'dc_1',
    })
    h.numberByField.set('var_1', 10)

    const applied = await applyPendingInventoryDelta(db, ORG, USER, 'var_1')

    expect(h.advanceCAS).not.toHaveBeenCalled()
    expect(h.createSpy).not.toHaveBeenCalled()
    expect(applied).toBe(0)
  })
})
