// packages/lib/src/cache/__tests__/org-system-rules.test.ts
// System rules are declared in CODE, so they are resolved per read and never cached.
// The org-cache projections they resolve against are mocked; the system-rule registry
// and resolver run for real.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  get: vi.fn(),
  ensureHooksRegistered: vi.fn(),
}))

vi.mock('../singletons', () => ({
  getOrgCache: () => ({ get: h.get }),
}))
// Lazily imported by the resolver to self-init the bootstrap — mocked so the real
// registerAllHooks (heavy trigger imports) never runs in this unit test.
vi.mock('../../field-hooks/registry', () => ({
  ensureHooksRegistered: h.ensureHooksRegistered,
}))

import { __clearSystemRules, declareSystemRules } from '../../record-rules/system-rules'
import { resolveOrgSystemRules } from '../org-system-rules'

const FIELD_RULE = {
  key: 'vp-cost',
  name: 'recalc',
  defSlug: 'vendor-parts',
  fieldRef: { systemAttribute: 'vendor_part_unit_price' },
  on: 'changed' as const,
  actions: [{ type: 'native' as const, handler: 'recalc' }],
}

beforeEach(() => {
  vi.clearAllMocks()
  h.get.mockImplementation((_orgId: string, key: string) => {
    if (key === 'customFields') {
      return Promise.resolve({
        def_vp: [{ id: 'fld_price', systemAttribute: 'vendor_part_unit_price' }],
      })
    }
    if (key === 'entityDefSlugs') return Promise.resolve({ 'vendor-parts': 'def_vp' })
    if (key === 'entityDefs') return Promise.resolve({ vendor_part: 'def_vp' })
    return Promise.resolve({})
  })
})

afterEach(() => __clearSystemRules())

describe('resolveOrgSystemRules', () => {
  it('resolves a declaration to a concrete field id for the org', async () => {
    declareSystemRules([FIELD_RULE])
    const rules = await resolveOrgSystemRules('org_1')
    expect(rules).toHaveLength(1)
    expect(rules[0]).toMatchObject({
      id: 'system:vp-cost',
      entityDefinitionId: 'def_vp',
      fieldId: 'fld_price',
      isSystem: true,
    })
  })

  it('reads no projections when nothing is declared', async () => {
    expect(await resolveOrgSystemRules('org_1')).toEqual([])
    expect(h.get).not.toHaveBeenCalled()
  })

  it('drops a declaration whose field the org lacks', async () => {
    h.get.mockImplementation((_orgId: string, key: string) => {
      if (key === 'customFields') return Promise.resolve({ def_vp: [] })
      if (key === 'entityDefSlugs') return Promise.resolve({ 'vendor-parts': 'def_vp' })
      return Promise.resolve({})
    })
    declareSystemRules([FIELD_RULE])
    expect(await resolveOrgSystemRules('org_1')).toEqual([])
  })

  it('resolves a lifecycle rule by def slug, falling back to the entityType map', async () => {
    declareSystemRules([
      {
        key: 'sm-created',
        name: 'lifecycle',
        defSlug: 'vendor_part',
        on: 'created',
        actions: [{ type: 'native', handler: 'a' }],
      },
    ])
    const rules = await resolveOrgSystemRules('org_1')
    expect(rules[0]).toMatchObject({ id: 'system:sm-created', entityDefinitionId: 'def_vp' })
  })

  it('self-initializes the hook registry before reading declarations', async () => {
    h.ensureHooksRegistered.mockImplementationOnce(() => declareSystemRules([FIELD_RULE]))
    const rules = await resolveOrgSystemRules('org_1')
    expect(h.ensureHooksRegistered).toHaveBeenCalled()
    expect(rules.some((r) => r.id === 'system:vp-cost')).toBe(true)
  })

  // THE regression this design exists for. When the union was cached, adding an action
  // to a system rule left every org running the OLD action list until the entry expired
  // — silently, because the rule still fired and only the new action was missing. This
  // is what made a purchase order's received quantity stay at zero while the stock
  // movements underneath it were written correctly.
  it('reflects a changed declaration on the next read, with no invalidation', async () => {
    declareSystemRules([{ ...FIELD_RULE, actions: [{ type: 'native', handler: 'first' }] }])
    const before = await resolveOrgSystemRules('org_1')
    expect(before[0]!.actions).toEqual([{ type: 'native', handler: 'first' }])

    // Same key, extra action — exactly the shape of a deploy adding a roll-up.
    declareSystemRules([
      {
        ...FIELD_RULE,
        actions: [
          { type: 'native', handler: 'first' },
          { type: 'native', handler: 'second' },
        ],
      },
    ])
    const after = await resolveOrgSystemRules('org_1')
    expect(after[0]!.actions).toEqual([
      { type: 'native', handler: 'first' },
      { type: 'native', handler: 'second' },
    ])
  })
})
