// packages/lib/src/data-connectors/inventory-bridge-rule.test.ts
// ensure/remove of the MANAGED inventory rule. The record-rules store + cache invalidation
// are mocked; the db is unused (store fns are stubbed).

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  findManaged: vi.fn(),
  createManaged: vi.fn(async () => ({ id: 'rule_new' })),
  deleteForDef: vi.fn(async () => 1),
  onCacheEvent: vi.fn(async () => {}),
  getCachedRecordRules: vi.fn(async () => []),
}))

vi.mock('../record-rules', () => ({
  findManagedRecordRule: h.findManaged,
  createManagedRecordRule: h.createManaged,
  deleteManagedRecordRulesForDef: h.deleteForDef,
}))
vi.mock('../cache', () => ({
  onCacheEvent: h.onCacheEvent,
  getCachedRecordRules: h.getCachedRecordRules,
}))

import {
  ensureInventoryDeductionRule,
  listInventorySourceRules,
  removeInventoryDeductionRule,
} from './inventory-bridge-rule'

const db = {} as never
const ORG = 'org_1'

beforeEach(() => {
  vi.clearAllMocks()
  h.createManaged.mockResolvedValue({ id: 'rule_new' })
  h.deleteForDef.mockResolvedValue(1)
})

describe('ensureInventoryDeductionRule', () => {
  it('creates the managed rule on first call + busts the cache', async () => {
    h.findManaged.mockResolvedValue(undefined)

    const r = await ensureInventoryDeductionRule(db, ORG, {
      sourceDefId: 'def_variants',
      quantityFieldId: 'fld_qty',
    })

    expect(r).toEqual({ id: 'rule_new', created: true })
    expect(h.createManaged).toHaveBeenCalledWith(
      db,
      ORG,
      expect.objectContaining({
        entityDefinitionId: 'def_variants',
        fieldId: 'fld_qty',
        on: 'decreased',
        managed: 'inventory',
        actions: [{ type: 'native', handler: 'deductInventory' }],
      })
    )
    expect(h.onCacheEvent).toHaveBeenCalledWith('record-rule.changed', { orgId: ORG })
  })

  it('returns the existing rule on re-call, does not re-create', async () => {
    h.findManaged.mockResolvedValue({ id: 'rule_existing' })

    const r = await ensureInventoryDeductionRule(db, ORG, {
      sourceDefId: 'def_variants',
      quantityFieldId: 'fld_qty',
    })

    expect(r).toEqual({ id: 'rule_existing', created: false })
    expect(h.createManaged).not.toHaveBeenCalled()
    expect(h.onCacheEvent).not.toHaveBeenCalled()
  })
})

describe('removeInventoryDeductionRule', () => {
  it('busts the cache when it removed a rule', async () => {
    h.deleteForDef.mockResolvedValue(1)
    await removeInventoryDeductionRule(db, ORG, { sourceDefId: 'def_variants' })
    expect(h.onCacheEvent).toHaveBeenCalledWith('record-rule.changed', { orgId: ORG })
  })

  it('no-op (no cache bust) when nothing matched', async () => {
    h.deleteForDef.mockResolvedValue(0)
    await removeInventoryDeductionRule(db, ORG, { sourceDefId: 'def_variants' })
    expect(h.onCacheEvent).not.toHaveBeenCalled()
  })
})

describe('listInventorySourceRules', () => {
  it('projects only managed inventory rules with a fieldId', async () => {
    h.getCachedRecordRules.mockResolvedValue([
      { entityDefinitionId: 'def_variants', fieldId: 'fld_qty', managed: 'inventory' },
      { entityDefinitionId: 'def_other', fieldId: 'fld_x', managed: null },
      { entityDefinitionId: 'def_nofield', fieldId: null, managed: 'inventory' },
    ])
    const r = await listInventorySourceRules(ORG)
    expect(r).toEqual([{ sourceDefId: 'def_variants', quantityFieldId: 'fld_qty' }])
  })
})
