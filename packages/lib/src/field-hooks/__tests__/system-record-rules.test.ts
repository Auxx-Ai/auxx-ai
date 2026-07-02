// packages/lib/src/field-hooks/__tests__/system-record-rules.test.ts
// B2 §8: the manufacturing FIELD_TRIGGERS as server-declared system rules. Asserts the 7
// declarations (keys, transition, ordered actions) and that the 4 native handlers are thin
// wrappers that call the EXISTING trigger functions with an adapted event. Trigger modules
// mocked so no DB/bom/realtime is touched.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  recalculatePartCost: vi.fn(async () => {}),
  clearOtherPreferred: vi.fn(async () => {}),
  recalculateStockStatus: vi.fn(async () => {}),
}))

vi.mock('../post/bom-cost-triggers', () => ({ recalculatePartCost: h.recalculatePartCost }))
vi.mock('../post/vendor-part-triggers', () => ({ clearOtherPreferred: h.clearOtherPreferred }))
vi.mock('../post/inventory-triggers', () => ({ recalculateStockStatus: h.recalculateStockStatus }))

import { __clearNativeRuleHandlers, getNativeRuleHandler } from '../../record-rules/actions'
import { __clearSystemRules, getSystemRuleDeclarations } from '../../record-rules/system-rules'
import { __resetFieldSystemRulesLatch, registerFieldSystemRules } from '../system-record-rules'

beforeEach(() => {
  vi.clearAllMocks()
  __clearSystemRules()
  __clearNativeRuleHandlers()
  __resetFieldSystemRulesLatch()
  registerFieldSystemRules()
})

afterEach(() => {
  __clearSystemRules()
  __clearNativeRuleHandlers()
  __resetFieldSystemRulesLatch()
})

describe('registerFieldSystemRules — declarations', () => {
  it('declares exactly the 7 field triggers', () => {
    const decls = getSystemRuleDeclarations()
    expect(decls).toHaveLength(7)
    expect(decls.map((d) => d.fieldRef?.systemAttribute).sort()).toEqual(
      [
        'part_reorder_point',
        'subpart_quantity',
        'vendor_part_is_preferred',
        'vendor_part_other_cost',
        'vendor_part_shipping_cost',
        'vendor_part_tariff_rate',
        'vendor_part_unit_price',
      ].sort()
    )
    expect(decls.every((d) => d.on === 'changed')).toBe(true)
    expect(decls.every((d) => d.actions.every((a) => a.type === 'native'))).toBe(true)
  })

  it('vendor_part_is_preferred keeps ordered [recalc cost, clear other preferred]', () => {
    const decl = getSystemRuleDeclarations().find(
      (d) => d.fieldRef?.systemAttribute === 'vendor_part_is_preferred'
    )!
    expect(decl.actions.map((a) => (a as { handler: string }).handler)).toEqual([
      'recalculatePartCostFromVendorPart',
      'clearOtherPreferred',
    ])
  })

  it('maps each field to the right def slug', () => {
    const bySlug = (attr: string) =>
      getSystemRuleDeclarations().find((d) => d.fieldRef?.systemAttribute === attr)!.defSlug
    expect(bySlug('vendor_part_unit_price')).toBe('vendor-parts')
    expect(bySlug('subpart_quantity')).toBe('subparts')
    expect(bySlug('part_reorder_point')).toBe('parts')
  })

  it('is idempotent — a second call does not duplicate declarations', () => {
    __resetFieldSystemRulesLatch()
    registerFieldSystemRules()
    expect(getSystemRuleDeclarations()).toHaveLength(7)
  })
})

describe('registerFieldSystemRules — native handlers wrap the trigger fns', () => {
  const batchEvent = { recordIds: ['def_vp:i1'] as never, organizationId: 'org_1', userId: 'u1' }

  it('recalculatePartCostFromVendorPart → recalculatePartCost with a vendor_part attribute', async () => {
    await getNativeRuleHandler('recalculatePartCostFromVendorPart')!(batchEvent)
    expect(h.recalculatePartCost).toHaveBeenCalledTimes(1)
    expect(h.recalculatePartCost).toHaveBeenCalledWith({
      action: 'updated',
      systemAttribute: 'vendor_part_unit_price',
      recordIds: ['def_vp:i1'],
      organizationId: 'org_1',
      userId: 'u1',
    })
  })

  it('recalculatePartCostFromSubpart → recalculatePartCost with subpart_quantity', async () => {
    await getNativeRuleHandler('recalculatePartCostFromSubpart')!(batchEvent)
    expect(h.recalculatePartCost).toHaveBeenCalledWith(
      expect.objectContaining({ systemAttribute: 'subpart_quantity' })
    )
  })

  it('clearOtherPreferred + recalculateStockStatus wrap their functions', async () => {
    await getNativeRuleHandler('clearOtherPreferred')!(batchEvent)
    await getNativeRuleHandler('recalculateStockStatus')!(batchEvent)
    expect(h.clearOtherPreferred).toHaveBeenCalledTimes(1)
    expect(h.recalculateStockStatus).toHaveBeenCalledTimes(1)
  })

  it('defaults a missing userId to empty string for type compatibility', async () => {
    await getNativeRuleHandler('recalculatePartCostFromVendorPart')!({
      recordIds: ['def_vp:i1'] as never,
      organizationId: 'org_1',
    })
    expect(h.recalculatePartCost).toHaveBeenCalledWith(expect.objectContaining({ userId: '' }))
  })
})
