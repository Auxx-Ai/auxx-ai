// packages/lib/src/import/__tests__/build-record-data.test.ts

import { describe, expect, it } from 'vitest'
import { buildRecordData, getSourceValue } from '../execution/build-record-data'
import { hashValue } from '../hashing/hash-value'
import { resolutionKey } from '../hashing/resolution-key'
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
        resolutionKey('prop-1', raw),
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

  it('resolves the same text per column, not across columns', () => {
    const resolved = (jobPropertyId: string, value: number): ValueResolution => ({
      id: `res-${jobPropertyId}`,
      importJobPropertyId: jobPropertyId,
      hashedValue: hashValue('12'),
      rawValue: '12',
      cellCount: 1,
      resolvedValues: [{ type: 'value', value }],
      isValid: true,
    })
    const price = mapping({ id: 'prop-price', targetFieldKey: 'unit_price' })
    const quantity = mapping({
      id: 'prop-qty',
      sourceColumnIndex: 1,
      targetFieldKey: 'minimum_quantity',
    })
    const resolutions = new Map<string, ValueResolution>([
      [resolutionKey('prop-price', '12'), resolved('jp-price', 1200)],
      [resolutionKey('prop-qty', '12'), resolved('jp-qty', 12)],
    ])

    const { standardFields } = buildRecordData({ 0: '12', 1: '12' }, [price, quantity], resolutions)
    expect(standardFields).toEqual({ unit_price: 1200, minimum_quantity: 12 })
  })
})
