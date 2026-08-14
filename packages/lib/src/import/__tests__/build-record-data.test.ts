// packages/lib/src/import/__tests__/build-record-data.test.ts

import { describe, expect, it } from 'vitest'
import { buildRecordData, getSourceValue } from '../execution/build-record-data'
import { hashValue } from '../hashing/hash-value'
import type { ImportMappingProperty } from '../types/mapping'
import type { ValueResolution } from '../types/resolution'

function mapping(overrides: Partial<ImportMappingProperty>): ImportMappingProperty {
  return {
    id: 'prop-1',
    importMappingId: 'mapping-1',
    sourceColumnIndex: 0,
    sourceColumnName: 'Email',
    targetType: 'particle',
    targetFieldKey: 'primary_email',
    customFieldId: null,
    resolutionType: 'email:split',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  }
}

describe('getSourceValue', () => {
  it('joins array-shaped source values with ", " instead of String() mangling', () => {
    const m = mapping({ sourceFieldKey: 'emails' })
    expect(getSourceValue({ emails: ['a@x.com', 'b@y.com'] }, m)).toBe('a@x.com, b@y.com')
  })

  it('keeps plain strings and coerces scalars', () => {
    const m = mapping({})
    expect(getSourceValue({ 0: 'a@x.com' }, m)).toBe('a@x.com')
    expect(getSourceValue({ 0: 42 as unknown as string }, m)).toBe('42')
    expect(getSourceValue({}, m)).toBe('')
  })
})

describe('buildRecordData', () => {
  it('uses the valid subset of a warning-typed resolution', () => {
    const raw = 'a@x.com, broken'
    const resolutions = new Map<string, ValueResolution>([
      [
        hashValue(raw),
        {
          id: 'res-1',
          importJobPropertyId: 'jp-1',
          hashedValue: hashValue(raw),
          rawValue: raw,
          cellCount: 1,
          resolvedValues: [{ type: 'warning', value: ['a@x.com'], warning: 'Dropped: broken' }],
          isValid: true,
        },
      ],
    ])

    const { standardFields } = buildRecordData({ 0: raw }, [mapping({})], resolutions)
    expect(standardFields.primary_email).toEqual(['a@x.com'])
  })
})
