// packages/lib/src/data-connectors/inventory-bridge-provisioning.test.ts
// B1 provisioning — creates the source→part edge idempotently + writes the INVENTORY_BRIDGE
// config entry. Boundaries (cache, createCustomField, config upsert) are mocked; the db is
// only used for the idempotency findFirst.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  getCachedEntityDefId: vi.fn(),
  createField: vi.fn(),
  upsertConfig: vi.fn(async () => {}),
  findFirst: vi.fn(async () => undefined as { id: string } | undefined),
}))

vi.mock('../cache', () => ({ getCachedEntityDefId: h.getCachedEntityDefId }))
vi.mock('@auxx/services/custom-fields', () => ({ createCustomField: h.createField }))
vi.mock('./inventory-bridge-config', () => ({ upsertInventoryBridgeConfigEntry: h.upsertConfig }))

import {
  INVENTORY_BRIDGE_EDGE_ATTR,
  provisionInventoryBridge,
} from './inventory-bridge-provisioning'

const ORG = 'org_1'
const db = { query: { CustomField: { findFirst: h.findFirst } } } as never
const INPUT = { dataConnectorId: 'dc_1', sourceDefId: 'def_variants', quantityFieldId: 'fld_qty' }

beforeEach(() => {
  vi.clearAllMocks()
  h.getCachedEntityDefId.mockResolvedValue('def_part')
  h.findFirst.mockResolvedValue(undefined)
  h.createField.mockResolvedValue({ isErr: () => false, value: { id: 'fld_edge' } })
})

describe('provisionInventoryBridge', () => {
  it('no part def ⇒ skip silently (null, no field/config writes)', async () => {
    h.getCachedEntityDefId.mockResolvedValue(undefined)
    const r = await provisionInventoryBridge(db, ORG, INPUT)
    expect(r).toBeNull()
    expect(h.createField).not.toHaveBeenCalled()
    expect(h.upsertConfig).not.toHaveBeenCalled()
  })

  it('fresh org ⇒ creates the belongs_to→part edge + writes config with the edge field id', async () => {
    const r = await provisionInventoryBridge(db, ORG, INPUT)

    expect(h.createField).toHaveBeenCalledTimes(1)
    const [fieldInput] = h.createField.mock.calls[0]
    expect(fieldInput).toMatchObject({
      organizationId: ORG,
      entityDefinitionId: 'def_variants',
      type: 'RELATIONSHIP',
      systemAttribute: INVENTORY_BRIDGE_EDGE_ATTR,
      relationship: { relatedResourceId: 'def_part', relationshipType: 'belongs_to' },
    })
    expect(h.upsertConfig).toHaveBeenCalledWith(db, ORG, {
      dataConnectorId: 'dc_1',
      sourceDefId: 'def_variants',
      quantityFieldId: 'fld_qty',
      relationshipFieldId: 'fld_edge',
    })
    expect(r).toEqual({ relationshipFieldId: 'fld_edge' })
  })

  it('idempotent ⇒ reuses the existing edge field, does not re-create it', async () => {
    h.findFirst.mockResolvedValue({ id: 'fld_existing' })

    const r = await provisionInventoryBridge(db, ORG, INPUT)

    expect(h.createField).not.toHaveBeenCalled()
    expect(h.upsertConfig).toHaveBeenCalledWith(
      db,
      ORG,
      expect.objectContaining({ relationshipFieldId: 'fld_existing' })
    )
    expect(r).toEqual({ relationshipFieldId: 'fld_existing' })
  })

  it('createCustomField error ⇒ throws', async () => {
    h.createField.mockResolvedValue({ isErr: () => true, error: { message: 'boom' } })
    await expect(provisionInventoryBridge(db, ORG, INPUT)).rejects.toThrow(/boom/)
    expect(h.upsertConfig).not.toHaveBeenCalled()
  })
})
