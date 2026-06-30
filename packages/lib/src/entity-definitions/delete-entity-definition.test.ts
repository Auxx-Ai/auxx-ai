// packages/lib/src/entity-definitions/delete-entity-definition.test.ts
// Pure-helper coverage for the entity-definition deep delete. The DB
// orchestration in `deleteEntityDefinitionDeep` has no vitest harness; these
// cover the relationship/CALC/connector decision logic that's easy to get wrong.

import { describe, expect, it } from 'vitest'
import {
  selectCalcFieldsToDisable,
  selectPartnerFieldIds,
  selectStreamsWithoutRoot,
} from './delete-entity-definition'

/** Build a relationship field's `options` jsonb pointing at an inverse field. */
function relField(id: string, inverseResourceFieldId: string | null) {
  return {
    id,
    options: {
      relationship: { inverseResourceFieldId, relationshipType: 'has_many', isInverse: false },
    },
  }
}

describe('selectPartnerFieldIds', () => {
  it('returns the inverse field on the OTHER entity (the opposite side to unset)', () => {
    const result = selectPartnerFieldIds({
      ownRelationshipFields: [relField('a1', 'B:pf1')],
      partnerOwnerById: new Map([['pf1', 'B']]),
      deletedDefId: 'A',
    })
    expect(result).toEqual(['pf1'])
  })

  it('skips self-referential partners (they cascade with the def)', () => {
    const result = selectPartnerFieldIds({
      ownRelationshipFields: [relField('a1', 'A:pf2')],
      partnerOwnerById: new Map([['pf2', 'A']]),
      deletedDefId: 'A',
    })
    expect(result).toEqual([])
  })

  it('skips partners that no longer exist', () => {
    const result = selectPartnerFieldIds({
      ownRelationshipFields: [relField('a1', 'B:gone')],
      partnerOwnerById: new Map(),
      deletedDefId: 'A',
    })
    expect(result).toEqual([])
  })

  it('skips relationship fields with no inverse set', () => {
    const result = selectPartnerFieldIds({
      ownRelationshipFields: [relField('a1', null), { id: 'a2', options: {} }],
      partnerOwnerById: new Map(),
      deletedDefId: 'A',
    })
    expect(result).toEqual([])
  })

  it('dedupes and collects across multiple fields', () => {
    const result = selectPartnerFieldIds({
      ownRelationshipFields: [
        relField('a1', 'B:pf1'),
        relField('a2', 'C:pf2'),
        relField('a3', 'B:pf1'), // dup
      ],
      partnerOwnerById: new Map([
        ['pf1', 'B'],
        ['pf2', 'C'],
      ]),
      deletedDefId: 'A',
    })
    expect(result.sort()).toEqual(['pf1', 'pf2'])
  })
})

describe('selectCalcFieldsToDisable', () => {
  const calcField = (id: string, entityDefinitionId: string | null, sourceFields: unknown) => ({
    id,
    entityDefinitionId,
    options: { calc: { sourceFields, expression: 'a + b' } },
  })

  it('disables a CALC field that references a deleted field via ResourceFieldId', () => {
    const result = selectCalcFieldsToDisable({
      calcFields: [calcField('c1', 'B', { x: 'A:f1' })],
      deletedFieldIds: new Set(['f1']),
      deletedDefId: 'A',
    })
    expect(result).toHaveLength(1)
    expect(result[0]?.id).toBe('c1')
    const calc = (result[0]?.options as { calc: { disabled: boolean; disabledReason: string } })
      .calc
    expect(calc.disabled).toBe(true)
    expect(calc.disabledReason).toBe('Source field was deleted')
  })

  it('matches the legacy bare-id source format', () => {
    const result = selectCalcFieldsToDisable({
      calcFields: [calcField('c1', 'B', { x: 'f1' })],
      deletedFieldIds: new Set(['f1']),
      deletedDefId: 'A',
    })
    expect(result.map((r) => r.id)).toEqual(['c1'])
  })

  it('skips CALC fields on the deleted def (they cascade)', () => {
    const result = selectCalcFieldsToDisable({
      calcFields: [calcField('c1', 'A', { x: 'A:f1' })],
      deletedFieldIds: new Set(['f1']),
      deletedDefId: 'A',
    })
    expect(result).toEqual([])
  })

  it('leaves unrelated CALC fields untouched', () => {
    const result = selectCalcFieldsToDisable({
      calcFields: [calcField('c1', 'B', { x: 'B:other' })],
      deletedFieldIds: new Set(['f1']),
      deletedDefId: 'A',
    })
    expect(result).toEqual([])
  })

  it('preserves sibling option keys when disabling', () => {
    const result = selectCalcFieldsToDisable({
      calcFields: [
        {
          id: 'c1',
          entityDefinitionId: 'B',
          options: { calc: { sourceFields: { x: 'A:f1' } }, icon: 'Hash' },
        },
      ],
      deletedFieldIds: new Set(['f1']),
      deletedDefId: 'A',
    })
    expect((result[0]?.options as { icon: string }).icon).toBe('Hash')
  })
})

describe('selectStreamsWithoutRoot', () => {
  it('returns affected streams that lost their root mapping', () => {
    const result = selectStreamsWithoutRoot({
      affectedStreamIds: ['s1', 's2'],
      streamIdsWithRoot: new Set(['s1']),
    })
    expect(result).toEqual(['s2'])
  })

  it('dedupes affected stream ids', () => {
    const result = selectStreamsWithoutRoot({
      affectedStreamIds: ['s1', 's1', 's2'],
      streamIdsWithRoot: new Set(),
    })
    expect(result).toEqual(['s1', 's2'])
  })

  it('returns nothing when every affected stream still has a root', () => {
    const result = selectStreamsWithoutRoot({
      affectedStreamIds: ['s1', 's2'],
      streamIdsWithRoot: new Set(['s1', 's2']),
    })
    expect(result).toEqual([])
  })
})
