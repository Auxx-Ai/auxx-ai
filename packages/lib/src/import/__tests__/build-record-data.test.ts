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

describe('buildRecordData on a file:url column', () => {
  const image = mapping({
    id: 'prop-img',
    sourceColumnName: 'Image',
    targetFieldKey: 'product_image',
    resolutionType: 'file:url',
  })
  const url = 'https://cdn.example.com/a.png'
  const withResolution = (resolved: ValueResolution['resolvedValues'], errorMessage?: string) =>
    new Map<string, ValueResolution>([
      [
        resolutionKey('prop-img', url),
        {
          id: 'res-img',
          importJobPropertyId: 'jp-img',
          hashedValue: hashValue(url),
          rawValue: url,
          cellCount: 1,
          resolvedValues: resolved,
          isValid: resolved[0]?.type !== 'error',
          errorMessage,
        },
      ],
    ])

  it('writes a downloaded image as a one-element { ref, sourceUrl } array', () => {
    const value = { ref: 'asset:a1', sourceUrl: url }
    const built = buildRecordData({ 0: url }, [image], withResolution([{ type: 'value', value }]))
    expect(built.standardFields).toEqual({ product_image: [value] })
    expect(built.warnings).toEqual([])
  })

  it('omits the key on a failed download and reports it, so an update keeps the stored image', () => {
    const built = buildRecordData(
      { 0: url },
      [image],
      withResolution([{ type: 'error', error: 'Fetch failed: HTTP 404' }], 'Fetch failed: HTTP 404')
    )
    expect(built.standardFields).not.toHaveProperty('product_image')
    expect(built.warnings).toEqual(['Column "Image": Image not imported: Fetch failed: HTTP 404'])
  })

  it('omits the key for a URL the resolver skipped, without repeating the planning warning', () => {
    const built = buildRecordData(
      { 0: url },
      [image],
      withResolution([
        { type: 'warning', value: null, warning: 'Invalid image URL — image skipped: x' },
      ])
    )
    expect(built.standardFields).not.toHaveProperty('product_image')
    expect(built.warnings).toEqual([])
  })

  it('never writes an undownloaded URL string', () => {
    const built = buildRecordData(
      { 0: url },
      [image],
      withResolution([{ type: 'create', value: url, fileFetch: { url } }])
    )
    expect(built.standardFields).not.toHaveProperty('product_image')
    expect(built.warnings).toHaveLength(1)
  })

  it('passes a blank cell through as null and a skipped value silently', () => {
    expect(buildRecordData({ 0: '' }, [image], new Map()).standardFields).toEqual({
      product_image: null,
    })
    const skipped = buildRecordData({ 0: url }, [image], withResolution([]))
    expect(skipped.standardFields).toEqual({})
    expect(skipped.warnings).toEqual([])
  })
})
