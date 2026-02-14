// packages/lib/src/field-values/__tests__/relationship-field.test.ts

import type { RelationshipFieldValue } from '@auxx/types/field-value'
import {
  extractRelationshipRecordIds,
  isRelationshipFieldValue,
  isRelationshipFieldValueArray,
} from '../relationship-field'

describe('extractRelationshipRecordIds', () => {
  it('handles null/undefined', () => {
    expect(extractRelationshipRecordIds(null)).toEqual([])
    expect(extractRelationshipRecordIds(undefined)).toEqual([])
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
    const result = extractRelationshipRecordIds(val)
    expect(result).toHaveLength(1)
    expect(result[0]).toBe('resource-1:abc-123')
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
    const result = extractRelationshipRecordIds(vals)
    expect(result).toEqual(['res-1:a', 'res-1:b'])
  })

  it('skips items missing entityDefinitionId', () => {
    const vals = [
      {
        type: 'relationship' as const,
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
        type: 'relationship' as const,
        relatedEntityId: 'b',
        relatedEntityDefinitionId: '', // Empty - should be skipped
        id: '2',
        entityId: 'e1',
        fieldId: 'f1',
        sortKey: '1',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
      },
    ]
    const result = extractRelationshipRecordIds(vals)
    expect(result).toEqual(['res-1:a'])
  })

  it('skips items missing relatedEntityId', () => {
    const vals = [
      {
        type: 'relationship' as const,
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
        type: 'relationship' as const,
        relatedEntityId: '', // Empty - should be skipped
        relatedEntityDefinitionId: 'res-1',
        id: '2',
        entityId: 'e1',
        fieldId: 'f1',
        sortKey: '1',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
      },
    ]
    const result = extractRelationshipRecordIds(vals)
    expect(result).toEqual(['res-1:a'])
  })

  it('returns empty array for invalid formats', () => {
    expect(extractRelationshipRecordIds('string-id')).toEqual([])
    expect(extractRelationshipRecordIds(['string-id'])).toEqual([])
    expect(extractRelationshipRecordIds(123)).toEqual([])
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
