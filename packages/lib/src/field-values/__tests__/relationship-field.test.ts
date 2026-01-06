// packages/lib/src/field-values/__tests__/relationship-field.test.ts

import {
  extractRelationshipData,
  normalizeRelationshipValue,
  validateRelationshipValue,
  validateEntityDefinitionId,
  isRelationshipFieldValue,
  isRelationshipFieldValueArray,
  convertRawToRelationshipInput,
} from '../relationship-field'
import type { RelationshipFieldValue } from '@auxx/types/field-value'

describe('extractRelationshipData', () => {
  it('handles null/undefined', () => {
    expect(extractRelationshipData(null)).toEqual({ ids: [], entityDefinitionId: null })
    expect(extractRelationshipData(undefined)).toEqual({ ids: [], entityDefinitionId: null })
  })

  it('handles single RelationshipFieldValue object', () => {
    const val: RelationshipFieldValue = {
      type: 'relationship',
      relatedEntityId: 'abc-123',
      relatedEntityDefinitionId: 'resource-1',
      id: '1',
      entityId: 'e1',
      fieldId: 'f1',
      sortKey: '0',
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
    }
    expect(extractRelationshipData(val)).toEqual({
      ids: ['abc-123'],
      entityDefinitionId: 'resource-1',
    })
  })

  it('handles single string ID', () => {
    expect(extractRelationshipData('entity-xyz')).toEqual({
      ids: ['entity-xyz'],
      entityDefinitionId: null,
    })
  })

  it('handles array of RelationshipFieldValue objects', () => {
    const vals: RelationshipFieldValue[] = [
      {
        type: 'relationship',
        relatedEntityId: 'a',
        relatedEntityDefinitionId: 'res-1',
        id: '1',
        entityId: 'e1',
        fieldId: 'f1',
        sortKey: '0',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
      },
      {
        type: 'relationship',
        relatedEntityId: 'b',
        relatedEntityDefinitionId: 'res-1',
        id: '2',
        entityId: 'e1',
        fieldId: 'f1',
        sortKey: '1',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
      },
    ]
    const result = extractRelationshipData(vals)
    expect(result.ids).toEqual(['a', 'b'])
    expect(result.entityDefinitionId).toBe('res-1')
  })

  it('handles array of string IDs', () => {
    expect(extractRelationshipData(['id1', 'id2', 'id3'])).toEqual({
      ids: ['id1', 'id2', 'id3'],
      entityDefinitionId: null,
    })
  })

  it('handles mixed array (objects and strings)', () => {
    const mixed = [
      {
        type: 'relationship' as const,
        relatedEntityId: 'obj-1',
        relatedEntityDefinitionId: 'res',
        id: '1',
        entityId: 'e1',
        fieldId: 'f1',
        sortKey: '0',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
      },
      'string-id',
      {
        type: 'relationship' as const,
        relatedEntityId: 'obj-2',
        relatedEntityDefinitionId: '',
        id: '2',
        entityId: 'e1',
        fieldId: 'f1',
        sortKey: '1',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
      },
    ]
    const result = extractRelationshipData(mixed)
    expect(result.ids).toEqual(['obj-1', 'string-id', 'obj-2'])
    expect(result.entityDefinitionId).toBe('res')
  })

  it('handles empty strings in arrays', () => {
    const result = extractRelationshipData(['id1', '', 'id2'])
    expect(result.ids).toEqual(['id1', '', 'id2'])
  })
})

describe('normalizeRelationshipValue', () => {
  it('returns empty array for null/undefined', () => {
    expect(normalizeRelationshipValue(null)).toEqual([])
    expect(normalizeRelationshipValue(undefined)).toEqual([])
  })

  it('wraps single object in array', () => {
    const val: RelationshipFieldValue = {
      type: 'relationship',
      relatedEntityId: 'abc',
      relatedEntityDefinitionId: 'res',
      id: '1',
      entityId: 'e1',
      fieldId: 'f1',
      sortKey: '0',
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
    }
    const result = normalizeRelationshipValue(val)
    expect(Array.isArray(result)).toBe(true)
    expect(result.length).toBe(1)
    expect(result[0].relatedEntityId).toBe('abc')
  })

  it('converts single string ID to full object in array', () => {
    const result = normalizeRelationshipValue('my-id')
    expect(Array.isArray(result)).toBe(true)
    expect(result[0].relatedEntityId).toBe('my-id')
  })

  it('returns array as-is if already array of proper objects', () => {
    const arr: RelationshipFieldValue[] = [
      {
        type: 'relationship',
        relatedEntityId: 'a',
        relatedEntityDefinitionId: 'res',
        id: '1',
        entityId: 'e1',
        fieldId: 'f1',
        sortKey: '0',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
      },
      {
        type: 'relationship',
        relatedEntityId: 'b',
        relatedEntityDefinitionId: 'res',
        id: '2',
        entityId: 'e1',
        fieldId: 'f1',
        sortKey: '1',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
      },
    ]
    const result = normalizeRelationshipValue(arr)
    expect(result).toEqual(arr)
  })

  it('converts array of strings to array of objects', () => {
    const result = normalizeRelationshipValue(['id1', 'id2'])
    expect(result.length).toBe(2)
    expect(result[0].relatedEntityId).toBe('id1')
    expect(result[1].relatedEntityId).toBe('id2')
  })

  it('always returns array (never null/undefined/single object)', () => {
    const testValues = [null, undefined, 'string', { test: 'obj' }, [], ['arr']]
    testValues.forEach((val) => {
      const result = normalizeRelationshipValue(val)
      expect(Array.isArray(result)).toBe(true)
    })
  })
})

describe('validateRelationshipValue', () => {
  it('accepts null/undefined as valid', () => {
    expect(validateRelationshipValue(null)).toBe(true)
    expect(validateRelationshipValue(undefined)).toBe(true)
  })

  it('accepts non-empty string', () => {
    expect(validateRelationshipValue('valid-id')).toBe(true)
  })

  it('rejects empty string', () => {
    expect(validateRelationshipValue('')).toBe(false)
  })

  it('accepts object with non-empty relatedEntityId', () => {
    expect(validateRelationshipValue({ relatedEntityId: 'abc' })).toBe(true)
  })

  it('rejects object with empty/missing relatedEntityId', () => {
    expect(validateRelationshipValue({ relatedEntityId: '' })).toBe(false)
    expect(validateRelationshipValue({})).toBe(false)
  })

  it('accepts array of valid items', () => {
    expect(validateRelationshipValue(['id1', { relatedEntityId: 'id2' }])).toBe(true)
  })

  it('rejects array with invalid items', () => {
    expect(validateRelationshipValue(['id1', '', {}])).toBe(false)
  })
})

describe('validateEntityDefinitionId', () => {
  it('accepts non-empty string', () => {
    expect(validateEntityDefinitionId('resource-1')).toBe(true)
    expect(validateEntityDefinitionId('uuid-abc-123')).toBe(true)
  })

  it('rejects null', () => {
    expect(validateEntityDefinitionId(null)).toBe(false)
  })

  it('rejects empty string', () => {
    expect(validateEntityDefinitionId('')).toBe(false)
    expect(validateEntityDefinitionId('   ')).toBe(false)
  })
})

describe('type guards', () => {
  it('isRelationshipFieldValue checks structure', () => {
    const valid: RelationshipFieldValue = {
      type: 'relationship',
      relatedEntityId: 'abc',
      relatedEntityDefinitionId: 'res',
      id: '1',
      entityId: 'e1',
      fieldId: 'f1',
      sortKey: '0',
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
    }
    expect(isRelationshipFieldValue(valid)).toBe(true)
    expect(isRelationshipFieldValue({ relatedEntityId: 'abc' })).toBe(false) // Missing type
    expect(isRelationshipFieldValue('string')).toBe(false)
  })

  it('isRelationshipFieldValueArray validates all items', () => {
    const valid: RelationshipFieldValue[] = [
      {
        type: 'relationship',
        relatedEntityId: 'a',
        relatedEntityDefinitionId: 'res',
        id: '1',
        entityId: 'e1',
        fieldId: 'f1',
        sortKey: '0',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
      },
      {
        type: 'relationship',
        relatedEntityId: 'b',
        relatedEntityDefinitionId: 'res',
        id: '2',
        entityId: 'e1',
        fieldId: 'f1',
        sortKey: '1',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
      },
    ]
    expect(isRelationshipFieldValueArray(valid)).toBe(true)

    const invalid = [
      { type: 'relationship' as const, relatedEntityId: 'a', relatedEntityDefinitionId: 'res' },
      'string',
    ]
    expect(isRelationshipFieldValueArray(invalid)).toBe(false)
  })
})

describe('convertRawToRelationshipInput', () => {
  it('handles null/undefined', () => {
    expect(convertRawToRelationshipInput(null)).toBeNull()
    expect(convertRawToRelationshipInput(undefined)).toBeNull()
  })

  it('converts single string to RelationshipFieldValueInput', () => {
    const result = convertRawToRelationshipInput('my-id')
    expect(result).toEqual({
      type: 'relationship',
      relatedEntityId: 'my-id',
      relatedEntityDefinitionId: '',
    })
  })

  it('converts array of strings', () => {
    const result = convertRawToRelationshipInput(['id1', 'id2'])
    expect(Array.isArray(result)).toBe(true)
    expect(result).toEqual([
      { type: 'relationship', relatedEntityId: 'id1', relatedEntityDefinitionId: '' },
      { type: 'relationship', relatedEntityId: 'id2', relatedEntityDefinitionId: '' },
    ])
  })

  it('handles objects with relatedEntityDefinitionId', () => {
    const result = convertRawToRelationshipInput({
      relatedEntityId: 'abc',
      relatedEntityDefinitionId: 'resource-1',
    })
    expect(result).toEqual({
      type: 'relationship',
      relatedEntityId: 'abc',
      relatedEntityDefinitionId: 'resource-1',
    })
  })

  it('filters empty strings from arrays', () => {
    const result = convertRawToRelationshipInput(['id1', '', 'id2'])
    expect(Array.isArray(result)).toBe(true)
    expect(result?.length).toBe(2)
  })
})
