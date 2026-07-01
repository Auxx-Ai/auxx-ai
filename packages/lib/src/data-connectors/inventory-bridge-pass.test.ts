// packages/lib/src/data-connectors/inventory-bridge-pass.test.ts
// The v9 inventory→part watermark pass. Function-level tests with the store/config/crud
// boundaries mocked (Drizzle column refs are undefined under vitest — project memory), so
// only the pass's decision logic is exercised. The db is used solely by the two batch reads
// (quantity cell + relationship edge); everything else is a spy.

import type { InventoryBridgeLinkEntity } from '@auxx/database'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  createSpy: vi.fn(async () => ({ recordId: 'rec_mv' })),
  getSystemUser: vi.fn(async () => 'sys_user'),
  getCachedEntityDefId: vi.fn(async (_org: string, slug: string) =>
    slug === 'part' ? 'def_part' : slug === 'stock_movement' ? 'def_mv' : undefined
  ),
  readConfig: vi.fn(),
  listLinks: vi.fn(),
  advanceCAS: vi.fn(async () => true),
  upsertLink: vi.fn(async () => ({}) as InventoryBridgeLinkEntity),
  deleteLink: vi.fn(async () => {}),
}))

vi.mock('../cache', () => ({ getCachedEntityDefId: h.getCachedEntityDefId }))
vi.mock('../users/system-user-service', () => ({
  SystemUserService: { getSystemUserForActions: h.getSystemUser },
}))
vi.mock('../resources/crud/unified-handler', () => ({
  UnifiedCrudHandler: class {
    create = h.createSpy
  },
}))
vi.mock('./inventory-bridge-config', () => ({ readInventoryBridgeConfig: h.readConfig }))
vi.mock('./inventory-bridge-store', () => ({
  listInventoryBridgeLinksForConnector: h.listLinks,
  advanceWatermarkCAS: h.advanceCAS,
  upsertInventoryBridgeLink: h.upsertLink,
  deleteInventoryBridgeLink: h.deleteLink,
}))

import { runInventoryBridgePass } from './inventory-bridge-pass'

const ORG = 'org_1'
const DC = 'dc_1'
const SOURCE_DEF = 'def_variants'
const ENTRY = {
  sourceDefId: SOURCE_DEF,
  quantityFieldId: 'fld_qty',
  relationshipFieldId: 'fld_rel',
}

function link(over: Partial<InventoryBridgeLinkEntity> = {}): InventoryBridgeLinkEntity {
  return {
    id: 'lnk_1',
    organizationId: ORG,
    dataConnectorId: DC,
    sourceDefId: SOURCE_DEF,
    variantInstanceId: 'var_1',
    partInstanceId: 'part_1',
    lastSeenQuantity: 10,
    mode: 'auto',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  }
}

/**
 * Fake db whose only job is to answer the two batch reads. It branches on the projection
 * shape: `{ entityId, value }` → quantities, `{ entityId, relatedEntityId }` → edges.
 */
function fakeDb(quantities: Map<string, number>, parts: Map<string, string | null>) {
  return {
    select(projection: Record<string, unknown>) {
      const isQty = 'value' in projection
      const chain = {
        from() {
          return chain
        },
        where() {
          const rows = isQty
            ? [...quantities.entries()].map(([entityId, value]) => ({ entityId, value }))
            : [...parts.entries()]
                .filter(([, p]) => p != null)
                .map(([entityId, relatedEntityId]) => ({ entityId, relatedEntityId }))
          return Promise.resolve(rows)
        },
      }
      return chain
    },
  } as never
}

beforeEach(() => {
  vi.clearAllMocks()
  h.getCachedEntityDefId.mockImplementation(async (_org: string, slug: string) =>
    slug === 'part' ? 'def_part' : slug === 'stock_movement' ? 'def_mv' : undefined
  )
  h.advanceCAS.mockResolvedValue(true)
  h.readConfig.mockResolvedValue([ENTRY])
})

describe('runInventoryBridgePass', () => {
  it('no config ⇒ early return, no reads', async () => {
    h.readConfig.mockResolvedValue([])
    const db = fakeDb(new Map(), new Map())
    const r = await runInventoryBridgePass(db, ORG, DC, [SOURCE_DEF])
    expect(r).toEqual({ movements: 0, pending: 0, advanced: 0 })
    expect(h.listLinks).not.toHaveBeenCalled()
  })

  it('config not among target defs ⇒ early return', async () => {
    const db = fakeDb(new Map(), new Map())
    const r = await runInventoryBridgePass(db, ORG, DC, ['def_unrelated'])
    expect(r.movements).toBe(0)
    expect(h.listLinks).not.toHaveBeenCalled()
  })

  it('decrease (auto) ⇒ one sale movement of −Δ with adjustSubparts + watermark advanced', async () => {
    h.listLinks.mockResolvedValue([link({ lastSeenQuantity: 10, mode: 'auto' })])
    const db = fakeDb(new Map([['var_1', 7]]), new Map([['var_1', 'part_1']]))

    const r = await runInventoryBridgePass(db, ORG, DC, [SOURCE_DEF])

    expect(h.advanceCAS).toHaveBeenCalledWith(db, 'lnk_1', 10, 7)
    expect(h.createSpy).toHaveBeenCalledTimes(1)
    const [defId, values] = h.createSpy.mock.calls[0]
    expect(defId).toBe('def_mv')
    expect(values).toMatchObject({
      stock_movement_part: 'def_part:part_1',
      stock_movement_type: 'sale',
      stock_movement_quantity: -3,
      stock_movement_adjust_subparts: true,
    })
    expect(r).toEqual({ movements: 1, pending: 0, advanced: 0 })
  })

  it('increase ⇒ watermark advanced, no movement', async () => {
    h.listLinks.mockResolvedValue([link({ lastSeenQuantity: 10, mode: 'auto' })])
    const db = fakeDb(new Map([['var_1', 15]]), new Map([['var_1', 'part_1']]))

    const r = await runInventoryBridgePass(db, ORG, DC, [SOURCE_DEF])

    expect(h.advanceCAS).toHaveBeenCalledWith(db, 'lnk_1', 10, 15)
    expect(h.createSpy).not.toHaveBeenCalled()
    expect(r).toEqual({ movements: 0, pending: 0, advanced: 1 })
  })

  it('equal ⇒ no-op', async () => {
    h.listLinks.mockResolvedValue([link({ lastSeenQuantity: 10 })])
    const db = fakeDb(new Map([['var_1', 10]]), new Map([['var_1', 'part_1']]))

    const r = await runInventoryBridgePass(db, ORG, DC, [SOURCE_DEF])

    expect(h.advanceCAS).not.toHaveBeenCalled()
    expect(h.createSpy).not.toHaveBeenCalled()
    expect(r).toEqual({ movements: 0, pending: 0, advanced: 0 })
  })

  it('confirm mode decrease ⇒ pending, no movement, no advance', async () => {
    h.listLinks.mockResolvedValue([link({ lastSeenQuantity: 10, mode: 'confirm' })])
    const db = fakeDb(new Map([['var_1', 4]]), new Map([['var_1', 'part_1']]))

    const r = await runInventoryBridgePass(db, ORG, DC, [SOURCE_DEF])

    expect(h.advanceCAS).not.toHaveBeenCalled()
    expect(h.createSpy).not.toHaveBeenCalled()
    expect(r).toEqual({ movements: 0, pending: 1, advanced: 0 })
  })

  it('CAS lost ⇒ no movement', async () => {
    h.listLinks.mockResolvedValue([link({ lastSeenQuantity: 10, mode: 'auto' })])
    h.advanceCAS.mockResolvedValue(false)
    const db = fakeDb(new Map([['var_1', 6]]), new Map([['var_1', 'part_1']]))

    const r = await runInventoryBridgePass(db, ORG, DC, [SOURCE_DEF])

    expect(h.advanceCAS).toHaveBeenCalled()
    expect(h.createSpy).not.toHaveBeenCalled()
    expect(r).toEqual({ movements: 0, pending: 0, advanced: 0 })
  })

  it('re-pointed link ⇒ re-baseline (upsert) to current cell, no movement', async () => {
    h.listLinks.mockResolvedValue([link({ partInstanceId: 'part_OLD', lastSeenQuantity: 10 })])
    const db = fakeDb(new Map([['var_1', 8]]), new Map([['var_1', 'part_NEW']]))

    const r = await runInventoryBridgePass(db, ORG, DC, [SOURCE_DEF])

    expect(h.upsertLink).toHaveBeenCalledWith(
      db,
      expect.objectContaining({ partInstanceId: 'part_NEW', lastSeenQuantity: 8 })
    )
    expect(h.createSpy).not.toHaveBeenCalled()
    expect(r).toEqual({ movements: 0, pending: 0, advanced: 1 })
  })

  it('cleared edge ⇒ delete the stale watermark, no movement', async () => {
    h.listLinks.mockResolvedValue([link({ lastSeenQuantity: 10 })])
    const db = fakeDb(new Map([['var_1', 3]]), new Map([['var_1', null]]))

    const r = await runInventoryBridgePass(db, ORG, DC, [SOURCE_DEF])

    expect(h.deleteLink).toHaveBeenCalledWith(db, 'var_1')
    expect(h.createSpy).not.toHaveBeenCalled()
    expect(r).toEqual({ movements: 0, pending: 0, advanced: 0 })
  })

  it('no synced quantity yet ⇒ skip (no movement, no advance)', async () => {
    h.listLinks.mockResolvedValue([link({ lastSeenQuantity: 10 })])
    const db = fakeDb(new Map(), new Map([['var_1', 'part_1']]))

    const r = await runInventoryBridgePass(db, ORG, DC, [SOURCE_DEF])

    expect(h.createSpy).not.toHaveBeenCalled()
    expect(r).toEqual({ movements: 0, pending: 0, advanced: 0 })
  })

  it('missing part/movement def ⇒ early return', async () => {
    h.getCachedEntityDefId.mockResolvedValue(undefined)
    h.listLinks.mockResolvedValue([link()])
    const db = fakeDb(new Map([['var_1', 5]]), new Map([['var_1', 'part_1']]))

    const r = await runInventoryBridgePass(db, ORG, DC, [SOURCE_DEF])

    expect(r).toEqual({ movements: 0, pending: 0, advanced: 0 })
    expect(h.createSpy).not.toHaveBeenCalled()
  })

  it('scopes links to the active config — a link for an unconfigured source def is never processed', async () => {
    // Only ENTRY (def_variants) is configured, but the store holds a link for a foreign
    // source def too. That foreign link must not be read, deleted, or deducted — otherwise
    // its (absent) edge under the wrong relationship field would look like a cleared link.
    h.readConfig.mockResolvedValue([ENTRY])
    h.listLinks.mockResolvedValue([
      link({
        id: 'lnk_A',
        variantInstanceId: 'var_A',
        sourceDefId: SOURCE_DEF,
        lastSeenQuantity: 10,
      }),
      link({
        id: 'lnk_B',
        variantInstanceId: 'var_B',
        sourceDefId: 'def_other',
        lastSeenQuantity: 10,
      }),
    ])
    const db = fakeDb(new Map([['var_A', 7]]), new Map([['var_A', 'part_1']]))

    const r = await runInventoryBridgePass(db, ORG, DC, [SOURCE_DEF, 'def_other'])

    // var_B's foreign link is never touched.
    expect(h.deleteLink).not.toHaveBeenCalled()
    expect(h.createSpy).toHaveBeenCalledTimes(1)
    expect(r.movements).toBe(1)
  })
})
