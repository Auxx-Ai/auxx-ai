// apps/web/src/components/data-connectors/lib/source-path-fields.test.ts
import { describe, expect, it } from 'vitest'
import type { SourcePath } from '../hooks/use-source-paths'
import { buildSourceFieldDefinitions, inferFieldType } from './source-path-fields'

const leaf = (path: string, type: string, over: Partial<SourcePath> = {}): SourcePath => ({
  path,
  type,
  depth: 0,
  isBranch: false,
  ...over,
})

describe('inferFieldType', () => {
  it('a detected format wins over the segment-name heuristic', () => {
    // `contact_at` would hit the `_at` → DATE heuristic; the format must win.
    expect(inferFieldType('contact_at', 'string', 'email')).toBe('EMAIL')
    expect(inferFieldType('updated_at', 'string', 'date-time')).toBe('DATETIME')
  })

  it('maps JSON types before falling back to the name', () => {
    expect(inferFieldType('orders_count', 'integer')).toBe('NUMBER')
    expect(inferFieldType('verified', 'boolean')).toBe('CHECKBOX')
    expect(inferFieldType('tags', 'array')).toBe('TAGS')
    expect(inferFieldType('created_at', 'string')).toBe('DATE')
    expect(inferFieldType('note', 'string')).toBe('TEXT')
  })
})

describe('buildSourceFieldDefinitions', () => {
  it('offers leaves only, keyed by the SOURCE PATH (not a ResourceFieldId)', () => {
    const fields = buildSourceFieldDefinitions([
      leaf('orders_count', 'integer'),
      leaf('default_address', 'object', { isBranch: true }),
      leaf('default_address.country', 'string', { depth: 1 }),
    ])
    expect(fields.map((f) => f.id)).toEqual(['orders_count', 'default_address.country'])
    expect(fields[0]).toMatchObject({ label: 'orders_count', fieldType: 'NUMBER' })
  })

  it("a declared struct fieldType wins over the JSON type's inference", () => {
    const [field] = buildSourceFieldDefinitions([
      leaf('billing', 'object', { fieldType: 'ADDRESS_STRUCT' }),
    ])
    expect(field?.fieldType).toBe('ADDRESS_STRUCT')
  })

  it('carries over a referenced path the schema no longer describes', () => {
    // A re-inferred schema can drop a path a live filter is built on — without the
    // carry-over the row's field chip would silently read "Select field".
    const fields = buildSourceFieldDefinitions(
      [leaf('orders_count', 'integer')],
      ['orders_count', 'legacy.total_spent']
    )
    expect(fields.map((f) => f.id)).toEqual(['orders_count', 'legacy.total_spent'])
  })
})
