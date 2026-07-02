// packages/lib/src/field-hooks/system-entity-rules.test.ts
// B2 §9 (Option A): the migrated ENTITY_TRIGGERS as native lifecycle system rules. Verifies
// the declarations cover the right (defSlug, on) pairs and that each native handler adapts the
// batch event (`eventDataByRecordId` + `action`) back to the legacy per-record handler shape —
// with cost recalc batched. The wrapped trigger modules are mocked (they pull bom/http/db).

import type { RecordId } from '@auxx/types/resource'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  explodeBomMovement: vi.fn(async () => {}),
  recalculatePartQoH: vi.fn(async () => {}),
  enrichCompanyOnCreate: vi.fn(async () => {}),
  recalculatePartCostForEntityBatch: vi.fn(async () => {}),
}))

vi.mock('./post/bom-movement-triggers', () => ({ explodeBomMovement: h.explodeBomMovement }))
vi.mock('./post/inventory-triggers', () => ({ recalculatePartQoH: h.recalculatePartQoH }))
vi.mock('./post/company-triggers', () => ({ enrichCompanyOnCreate: h.enrichCompanyOnCreate }))
vi.mock('./post/bom-cost-triggers', () => ({
  recalculatePartCostForEntityBatch: h.recalculatePartCostForEntityBatch,
}))

import { __clearNativeRuleHandlers, getNativeRuleHandler } from '../record-rules/actions'
import { __clearSystemRules, getSystemRuleDeclarations } from '../record-rules/system-rules'
import { __resetEntitySystemRulesLatch, registerEntitySystemRules } from './system-entity-rules'

const RID = (s: string) => s as RecordId

beforeEach(() => {
  vi.clearAllMocks()
  __clearNativeRuleHandlers()
  __clearSystemRules()
  __resetEntitySystemRulesLatch()
  registerEntitySystemRules()
})

afterEach(() => {
  __clearNativeRuleHandlers()
  __clearSystemRules()
  __resetEntitySystemRulesLatch()
})

describe('registerEntitySystemRules — declarations', () => {
  it('declares one rule per (defSlug, on) pair the legacy registry covered', () => {
    const pairs = getSystemRuleDeclarations().map((d) => `${d.defSlug}:${d.on}`)
    expect(pairs).toEqual(
      expect.arrayContaining([
        'vendor-parts:created',
        'vendor-parts:deleted',
        'subparts:created',
        'subparts:deleted',
        'stock-movements:created',
        'stock-movements:deleted',
        'companies:created',
      ])
    )
    // No lifecycle rule declares a fieldRef.
    expect(getSystemRuleDeclarations().every((d) => !d.fieldRef)).toBe(true)
  })

  it('keeps explode BEFORE qoh on stock-movement create', () => {
    const smCreated = getSystemRuleDeclarations().find(
      (d) => d.defSlug === 'stock-movements' && d.on === 'created'
    )!
    const handlers = smCreated.actions.map((a) => (a as { handler?: string }).handler)
    expect(handlers).toEqual(['explodeBomMovement', 'recalculatePartQoH'])
  })
})

describe('native handlers — fan-out + batch adaptation', () => {
  it('company enrich fans out per record with the threaded values + action', async () => {
    const handler = getNativeRuleHandler('enrichCompanyOnCreate')!
    await handler({
      recordIds: [RID('companyDef:c1'), RID('companyDef:c2')],
      organizationId: 'org_1',
      userId: 'u1',
      action: 'created',
      eventDataByRecordId: {
        [RID('companyDef:c1')]: { company_domain: 'a.com' },
        [RID('companyDef:c2')]: { company_domain: 'b.com' },
      },
    })
    expect(h.enrichCompanyOnCreate).toHaveBeenCalledTimes(2)
    expect(h.enrichCompanyOnCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'created',
        entityDefinitionId: 'companyDef',
        entityInstanceId: 'c1',
        organizationId: 'org_1',
        userId: 'u1',
        values: { company_domain: 'a.com' },
      })
    )
  })

  it('a record with no threaded values fans out with empty values', async () => {
    const handler = getNativeRuleHandler('recalculatePartQoH')!
    await handler({
      recordIds: [RID('smDef:s1')],
      organizationId: 'org_1',
      action: 'deleted',
    })
    expect(h.recalculatePartQoH).toHaveBeenCalledTimes(1)
    expect(h.recalculatePartQoH).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'deleted', entityInstanceId: 's1', values: {} })
    )
  })

  it('ignores a firing with no lifecycle action (field-change firing)', async () => {
    const handler = getNativeRuleHandler('explodeBomMovement')!
    await handler({ recordIds: [RID('smDef:s1')], organizationId: 'org_1' })
    expect(h.explodeBomMovement).not.toHaveBeenCalled()
  })

  it('cost recalc BATCHES the whole firing (one call, records mapped from recordIds+values)', async () => {
    const handler = getNativeRuleHandler('entityCostRecalcVendor')!
    await handler({
      recordIds: [RID('vpDef:v1'), RID('vpDef:v2')],
      organizationId: 'org_1',
      action: 'created',
      eventDataByRecordId: { [RID('vpDef:v1')]: { vendor_part_part: 'p1' } },
    })
    expect(h.recalculatePartCostForEntityBatch).toHaveBeenCalledTimes(1)
    expect(h.recalculatePartCostForEntityBatch).toHaveBeenCalledWith({
      organizationId: 'org_1',
      relationshipAttr: 'vendor_part_part',
      action: 'created',
      records: [
        { entityInstanceId: 'v1', values: { vendor_part_part: 'p1' } },
        { entityInstanceId: 'v2', values: undefined },
      ],
    })
  })

  it('subpart cost recalc uses the subpart relationship attr', async () => {
    const handler = getNativeRuleHandler('entityCostRecalcSubpart')!
    await handler({
      recordIds: [RID('spDef:s1')],
      organizationId: 'org_1',
      action: 'deleted',
    })
    expect(h.recalculatePartCostForEntityBatch).toHaveBeenCalledWith(
      expect.objectContaining({ relationshipAttr: 'subpart_parent_part', action: 'deleted' })
    )
  })
})
