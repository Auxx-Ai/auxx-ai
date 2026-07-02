// packages/lib/src/record-rules/system-rules.test.ts
// Phase 7 (B2 §7c): system-rule declaration validation + per-org resolution against the
// customFields / entityDefs lookups. Pure — no DB, no cache.

import { afterEach, describe, expect, it } from 'vitest'
import {
  __clearSystemRules,
  declareSystemRules,
  getSystemRuleDeclarations,
  resolveSystemRules,
  type SystemRuleLookup,
} from './system-rules'

afterEach(() => __clearSystemRules())

describe('declareSystemRules — validation', () => {
  it('rejects a non-native action', () => {
    expect(() =>
      declareSystemRules([
        {
          key: 'k',
          name: 'n',
          defSlug: 'vendor-parts',
          fieldRef: { systemAttribute: 'vendor_part_unit_price' },
          on: 'changed',
          actions: [{ type: 'notify', userIds: ['u'], message: 'm' }],
        },
      ])
    ).toThrow(/native/)
  })

  it('rejects mixed native + non-native actions', () => {
    expect(() =>
      declareSystemRules([
        {
          key: 'k',
          name: 'n',
          defSlug: 'vendor-parts',
          fieldRef: { systemAttribute: 'vendor_part_unit_price' },
          on: 'changed',
          actions: [
            { type: 'native', handler: 'recalc' },
            { type: 'notify', userIds: ['u'], message: 'm' },
          ],
        },
      ])
    ).toThrow(/native/)
  })

  it('rejects a lifecycle rule that declares a fieldRef', () => {
    expect(() =>
      declareSystemRules([
        {
          key: 'k',
          name: 'n',
          defSlug: 'companies',
          fieldRef: { systemAttribute: 'x' },
          on: 'created',
          actions: [{ type: 'native', handler: 'enrich' }],
        },
      ])
    ).toThrow(/fieldRef/)
  })

  it('rejects a field rule with no fieldRef', () => {
    expect(() =>
      declareSystemRules([
        {
          key: 'k',
          name: 'n',
          defSlug: 'vendor-parts',
          on: 'changed',
          actions: [{ type: 'native', handler: 'recalc' }],
        },
      ])
    ).toThrow(/fieldRef/)
  })

  it('replaces a declaration re-registered under the same key', () => {
    const decl = (name: string) => ({
      key: 'k',
      name,
      defSlug: 'vendor-parts',
      fieldRef: { systemAttribute: 'vendor_part_unit_price' },
      on: 'changed' as const,
      actions: [{ type: 'native' as const, handler: 'recalc' }],
    })
    declareSystemRules([decl('first')])
    declareSystemRules([decl('second')])
    expect(getSystemRuleDeclarations()).toHaveLength(1)
    expect(getSystemRuleDeclarations()[0]!.name).toBe('second')
  })
})

describe('resolveSystemRules', () => {
  const lookup: SystemRuleLookup = {
    defIdBySlug: (slug) => (slug === 'vendor-parts' ? 'def_vp' : undefined),
    fieldIdBySystemAttribute: (defId, attr) =>
      defId === 'def_vp' && attr === 'vendor_part_unit_price' ? 'fld_price' : undefined,
  }

  it('resolves a field rule to the concrete field row id (isSystem, enabled)', () => {
    const [resolved] = resolveSystemRules(
      'org_1',
      [
        {
          key: 'vp-cost',
          name: 'recalc part cost',
          defSlug: 'vendor-parts',
          fieldRef: { systemAttribute: 'vendor_part_unit_price' },
          on: 'changed',
          actions: [{ type: 'native', handler: 'recalc' }],
        },
      ],
      lookup
    )

    expect(resolved).toMatchObject({
      id: 'system:vp-cost',
      organizationId: 'org_1',
      entityDefinitionId: 'def_vp',
      fieldId: 'fld_price',
      on: 'changed',
      enabled: true,
      isSystem: true,
    })
  })

  it('drops a rule whose def the org lacks', () => {
    const resolved = resolveSystemRules(
      'org_1',
      [
        {
          key: 'k',
          name: 'n',
          defSlug: 'missing-slug',
          fieldRef: { systemAttribute: 'vendor_part_unit_price' },
          on: 'changed',
          actions: [{ type: 'native', handler: 'recalc' }],
        },
      ],
      lookup
    )
    expect(resolved).toHaveLength(0)
  })

  it('drops a field rule whose field the org lacks', () => {
    const resolved = resolveSystemRules(
      'org_1',
      [
        {
          key: 'k',
          name: 'n',
          defSlug: 'vendor-parts',
          fieldRef: { systemAttribute: 'not_provisioned' },
          on: 'changed',
          actions: [{ type: 'native', handler: 'recalc' }],
        },
      ],
      lookup
    )
    expect(resolved).toHaveLength(0)
  })

  it('resolves a lifecycle rule with a null fieldId', () => {
    const [resolved] = resolveSystemRules(
      'org_1',
      [
        {
          key: 'vp-created',
          name: 'on create',
          defSlug: 'vendor-parts',
          on: 'created',
          actions: [{ type: 'native', handler: 'recalc' }],
        },
      ],
      lookup
    )
    expect(resolved).toMatchObject({ entityDefinitionId: 'def_vp', fieldId: null, isSystem: true })
  })
})
