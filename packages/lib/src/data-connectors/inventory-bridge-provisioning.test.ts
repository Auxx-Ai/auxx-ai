// packages/lib/src/data-connectors/inventory-bridge-provisioning.test.ts
// B1 provisioning — creates the source→part edge idempotently + ensures the MANAGED inventory
// rule. Boundaries (cache, createCustomField, ensure-rule) are mocked; the db is only used for
// the idempotency findFirst.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  getCachedEntityDefId: vi.fn(),
  createField: vi.fn(),
  ensureRule: vi.fn(async () => ({ id: 'rule_1', created: true })),
  findFirst: vi.fn(async () => undefined as { id: string } | undefined),
}))

vi.mock('../cache', () => ({ getCachedEntityDefId: h.getCachedEntityDefId }))
vi.mock('@auxx/services/custom-fields', () => ({ createCustomField: h.createField }))
vi.mock('./inventory-bridge-rule', () => ({ ensureInventoryDeductionRule: h.ensureRule }))

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
  it('no part def ⇒ skip silently (null, no field/rule writes)', async () => {
    h.getCachedEntityDefId.mockResolvedValue(undefined)
    const r = await provisionInventoryBridge(db, ORG, INPUT)
    expect(r).toBeNull()
    expect(h.createField).not.toHaveBeenCalled()
    expect(h.ensureRule).not.toHaveBeenCalled()
  })

  it('fresh org ⇒ creates the belongs_to→part edge + ensures the managed rule', async () => {
    const r = await provisionInventoryBridge(db, ORG, INPUT)

    expect(h.createField).toHaveBeenCalledTimes(1)
    const [fieldInput] = h.createField.mock.calls[0]! // guarded by the call-count assertion above
    expect(fieldInput).toMatchObject({
      organizationId: ORG,
      entityDefinitionId: 'def_variants',
      type: 'RELATIONSHIP',
      systemAttribute: INVENTORY_BRIDGE_EDGE_ATTR,
      relationship: { relatedResourceId: 'def_part', relationshipType: 'belongs_to' },
    })
    expect(h.ensureRule).toHaveBeenCalledWith(db, ORG, {
      sourceDefId: 'def_variants',
      quantityFieldId: 'fld_qty',
    })
    expect(r).toEqual({ relationshipFieldId: 'fld_edge' })
  })

  it('idempotent ⇒ reuses the existing edge field, does not re-create it', async () => {
    h.findFirst.mockResolvedValue({ id: 'fld_existing' })

    const r = await provisionInventoryBridge(db, ORG, INPUT)

    expect(h.createField).not.toHaveBeenCalled()
    expect(h.ensureRule).toHaveBeenCalledWith(
      db,
      ORG,
      expect.objectContaining({ sourceDefId: 'def_variants', quantityFieldId: 'fld_qty' })
    )
    expect(r).toEqual({ relationshipFieldId: 'fld_existing' })
  })

  it('createCustomField error ⇒ throws', async () => {
    h.createField.mockResolvedValue({ isErr: () => true, error: { message: 'boom' } })
    await expect(provisionInventoryBridge(db, ORG, INPUT)).rejects.toThrow(/boom/)
    expect(h.ensureRule).not.toHaveBeenCalled()
  })
})
