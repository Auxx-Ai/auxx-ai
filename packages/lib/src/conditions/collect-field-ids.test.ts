// packages/lib/src/conditions/collect-field-ids.test.ts

import { describe, expect, it } from 'vitest'
import { collectConditionFieldIds } from './collect-field-ids'
import type { ConditionGroup } from './types'

function group(conditions: ConditionGroup['conditions']): ConditionGroup {
  return { id: 'g1', logicalOperator: 'AND', conditions }
}

describe('collectConditionFieldIds', () => {
  it('collects direct field refs across multiple groups', () => {
    const result = collectConditionFieldIds([
      group([
        { id: 'c1', fieldId: 'fld_a', operator: 'is', value: 1 },
        { id: 'c2', fieldId: 'fld_b', operator: 'is', value: 2 },
      ]),
      group([{ id: 'c3', fieldId: 'fld_a', operator: 'is', value: 3 }]),
    ])
    expect(result.fieldRefs.sort()).toEqual(['fld_a', 'fld_b'])
    expect(result.hasRelationshipPath).toBe(false)
  })

  it('walks sub-conditions', () => {
    const result = collectConditionFieldIds([
      group([
        {
          id: 'c1',
          fieldId: 'fld_a',
          operator: 'is',
          value: 1,
          subConditions: [{ id: 'c2', fieldId: 'fld_nested', operator: 'is', value: 2 }],
        },
      ]),
    ])
    expect(result.fieldRefs.sort()).toEqual(['fld_a', 'fld_nested'])
  })

  it('flags relationship-path (array) fieldIds', () => {
    const result = collectConditionFieldIds([
      group([
        { id: 'c1', fieldId: ['product:vendor', 'vendor:name'], operator: 'is', value: 'Acme' },
        { id: 'c2', fieldId: 'fld_direct', operator: 'is', value: 1 },
      ]),
    ])
    expect(result.hasRelationshipPath).toBe(true)
    expect(result.fieldRefs).toEqual(['fld_direct'])
  })

  it('handles empty conditions / empty groups', () => {
    expect(collectConditionFieldIds([])).toEqual({ fieldRefs: [], hasRelationshipPath: false })
    expect(collectConditionFieldIds([group([])])).toEqual({
      fieldRefs: [],
      hasRelationshipPath: false,
    })
  })
})
