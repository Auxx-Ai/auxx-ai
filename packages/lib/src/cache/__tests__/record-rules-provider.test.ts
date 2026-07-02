// packages/lib/src/cache/__tests__/record-rules-provider.test.ts
// Phase 7 (B2 §7c): the recordRules cache provider unions code-declared system rules
// (resolved per-org via the customFields / entityDefs projections) with the DB rules.
// Sibling providers mocked; system-rule registry + resolver run for real.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  customFieldsCompute: vi.fn(),
  slugsCompute: vi.fn(),
  defsCompute: vi.fn(),
  ensureHooksRegistered: vi.fn(),
}))

vi.mock('../providers/custom-fields-provider', () => ({
  customFieldsProvider: { compute: h.customFieldsCompute },
}))
vi.mock('../providers/entity-def-slugs-provider', () => ({
  entityDefSlugsProvider: { compute: h.slugsCompute },
}))
vi.mock('../providers/entity-defs-provider', () => ({
  entityDefsProvider: { compute: h.defsCompute },
}))
// compute() self-inits the field-hooks bootstrap (F2) — mock the registry so the real
// registerAllHooks (heavy trigger imports) never runs in this unit test.
vi.mock('../../field-hooks/registry', () => ({
  ensureHooksRegistered: h.ensureHooksRegistered,
}))

import { __clearSystemRules, declareSystemRules } from '../../record-rules/system-rules'
import { recordRulesProvider } from '../providers/record-rules-provider'

const dbRow = {
  id: 'rule_db',
  organizationId: 'org_1',
  entityDefinitionId: 'def_x',
  fieldId: 'fld_x',
  name: 'user rule',
  on: 'changed',
  condition: [],
  actions: [{ type: 'notify', userIds: ['u'], message: 'm' }],
  enabled: true,
}

function fakeDb(rows: unknown[]) {
  return {
    select: () => ({ from: () => ({ where: () => Promise.resolve(rows) }) }),
  } as never
}

beforeEach(() => {
  vi.clearAllMocks()
  h.customFieldsCompute.mockResolvedValue({
    def_vp: [{ id: 'fld_price', systemAttribute: 'vendor_part_unit_price' }],
  })
  h.slugsCompute.mockResolvedValue({ 'vendor-parts': 'def_vp' })
  h.defsCompute.mockResolvedValue({ vendor_part: 'def_vp' })
})

afterEach(() => __clearSystemRules())

describe('recordRulesProvider.compute — system-rule union', () => {
  it('returns only DB rules when no system rules are declared (no sibling compute)', async () => {
    const rules = await recordRulesProvider.compute('org_1', fakeDb([dbRow]))
    expect(rules).toHaveLength(1)
    expect(rules[0]!.id).toBe('rule_db')
    expect(h.customFieldsCompute).not.toHaveBeenCalled()
  })

  // F2 regression: a fresh process whose FIRST record-rules touch is this compute must
  // self-init the field-hooks bootstrap — otherwise the system-rule declarations are
  // still empty and a system-rule-free union gets cached org-wide for a day.
  it('self-initializes the hook registry before reading declarations', async () => {
    // Simulate the lazy bootstrap: declarations only appear when the registry inits.
    h.ensureHooksRegistered.mockImplementationOnce(() => {
      declareSystemRules([
        {
          key: 'vp-cost-boot',
          name: 'recalc',
          defSlug: 'vendor-parts',
          fieldRef: { systemAttribute: 'vendor_part_unit_price' },
          on: 'changed',
          actions: [{ type: 'native', handler: 'recalc' }],
        },
      ])
    })
    const rules = await recordRulesProvider.compute('org_1', fakeDb([dbRow]))
    expect(h.ensureHooksRegistered).toHaveBeenCalled()
    expect(rules.some((r) => r.id === 'system:vp-cost-boot')).toBe(true)
  })

  it('unions a resolvable system rule (isSystem, concrete field id)', async () => {
    declareSystemRules([
      {
        key: 'vp-cost',
        name: 'recalc',
        defSlug: 'vendor-parts',
        fieldRef: { systemAttribute: 'vendor_part_unit_price' },
        on: 'changed',
        actions: [{ type: 'native', handler: 'recalc' }],
      },
    ])
    const rules = await recordRulesProvider.compute('org_1', fakeDb([dbRow]))
    expect(rules).toHaveLength(2)
    const system = rules.find((r) => r.isSystem)
    expect(system).toMatchObject({
      id: 'system:vp-cost',
      entityDefinitionId: 'def_vp',
      fieldId: 'fld_price',
      isSystem: true,
    })
  })

  it('drops a system rule the org cannot resolve (field absent)', async () => {
    h.customFieldsCompute.mockResolvedValue({ def_vp: [] })
    declareSystemRules([
      {
        key: 'vp-cost',
        name: 'recalc',
        defSlug: 'vendor-parts',
        fieldRef: { systemAttribute: 'vendor_part_unit_price' },
        on: 'changed',
        actions: [{ type: 'native', handler: 'recalc' }],
      },
    ])
    const rules = await recordRulesProvider.compute('org_1', fakeDb([dbRow]))
    expect(rules).toHaveLength(1)
    expect(rules.some((r) => r.isSystem)).toBe(false)
  })
})
