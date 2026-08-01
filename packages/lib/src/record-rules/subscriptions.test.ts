// packages/lib/src/record-rules/subscriptions.test.ts
// Pure subscription-index bucketing: field vs lifecycle, disabled-rule exclusion.

import { describe, expect, it } from 'vitest'
import { getSyncRuleSubscriptions, subscriptionsEmpty } from './subscriptions'
import type { CachedRecordRule } from './types'

function rule(overrides: Partial<CachedRecordRule> = {}): CachedRecordRule {
  return {
    id: 'rule_1',
    organizationId: 'org_1',
    entityDefinitionId: 'def_1',
    fieldId: 'fld_a',
    name: 'r',
    on: 'changed',
    condition: [],
    actions: [],
    enabled: true,
    ...overrides,
  }
}

describe('getSyncRuleSubscriptions', () => {
  it('buckets field rules by def + fieldId', () => {
    const subs = getSyncRuleSubscriptions([
      rule({ id: 'r1', fieldId: 'fld_a', on: 'changed' }),
      rule({ id: 'r2', fieldId: 'fld_b', on: 'increased' }),
      rule({ id: 'r3', entityDefinitionId: 'def_2', fieldId: 'fld_c', on: 'set' }),
    ])
    expect([...(subs.def_1?.fieldIds ?? [])].sort()).toEqual(['fld_a', 'fld_b'])
    expect([...(subs.def_2?.fieldIds ?? [])]).toEqual(['fld_c'])
    expect(subs.def_1?.lifecycle).toEqual({ created: false, deleted: false })
  })

  it('buckets lifecycle rules (fieldId null) by transition', () => {
    const subs = getSyncRuleSubscriptions([
      rule({ id: 'r1', fieldId: null, on: 'created' }),
      rule({ id: 'r2', fieldId: null, on: 'deleted' }),
    ])
    expect(subs.def_1?.lifecycle).toEqual({ created: true, deleted: true })
    expect(subs.def_1?.fieldIds.size).toBe(0)
  })

  it('excludes disabled rules', () => {
    const subs = getSyncRuleSubscriptions([
      rule({ id: 'r1', fieldId: 'fld_a', enabled: false }),
      rule({ id: 'r2', fieldId: null, on: 'created', enabled: false }),
    ])
    expect(subscriptionsEmpty(subs)).toBe(true)
  })

  it('a field rule with fieldId null but non-lifecycle transition is ignored', () => {
    // Defensive: malformed rule (should not exist) contributes nothing.
    const subs = getSyncRuleSubscriptions([rule({ fieldId: null, on: 'changed' })])
    expect(subscriptionsEmpty(subs)).toBe(true)
  })

  it('subscriptionsEmpty true only when nothing subscribed', () => {
    expect(subscriptionsEmpty(getSyncRuleSubscriptions([]))).toBe(true)
    expect(subscriptionsEmpty(getSyncRuleSubscriptions([rule()]))).toBe(false)
  })
})
