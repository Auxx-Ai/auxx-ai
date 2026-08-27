// packages/lib/src/cache/__tests__/record-rules-provider.test.ts
// The recordRules cache holds DB rules ONLY. The code-declared system rules are
// resolved per read and unioned in by `getCachedRecordRules` — see
// `org-system-rules.test.ts` for that half.

import { describe, expect, it } from 'vitest'

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

describe('recordRulesProvider.compute', () => {
  it('returns the org DB rules', async () => {
    const rules = await recordRulesProvider.compute('org_1', fakeDb([dbRow]))
    expect(rules).toHaveLength(1)
    expect(rules[0]!.id).toBe('rule_db')
  })

  // The union is NOT this provider's job. Caching it is what let a stale entry keep
  // running a superseded action list for a day.
  it('never contributes a system rule, even when declarations exist', async () => {
    const { declareSystemRules, __clearSystemRules } = await import(
      '../../record-rules/system-rules'
    )
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
    expect(rules.some((r) => r.isSystem)).toBe(false)
    __clearSystemRules()
  })
})
