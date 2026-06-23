// packages/lib/src/data-connectors/app-catalog.test.ts
// App-catalog → setup materialization (create-sync-flow §3.1, Tier 1): building a
// Layer-A source schema from declared field paths, and preferring an exampleRecord.

import { describe, expect, it } from 'vitest'
import { appCatalogStreamSchema, buildSchemaFromFieldPaths } from './app-catalog'

describe('buildSchemaFromFieldPaths', () => {
  it('nests dotted + array paths into an object/array schema with scalar leaf types', () => {
    const schema = buildSchemaFromFieldPaths([
      { sourcePath: 'id', type: 'TEXT' },
      { sourcePath: 'total_price', type: 'CURRENCY' },
      { sourcePath: 'paid', type: 'CHECKBOX' },
      { sourcePath: 'customer.email', type: 'EMAIL' },
      { sourcePath: 'line_items[].sku', type: 'TEXT' },
      { sourcePath: 'line_items[].qty', type: 'NUMBER' },
    ])
    expect(schema).toEqual({
      type: 'object',
      properties: {
        id: { type: 'string' },
        total_price: { type: 'number' },
        paid: { type: 'boolean' },
        customer: { type: 'object', properties: { email: { type: 'string' } } },
        line_items: {
          type: 'array',
          items: {
            type: 'object',
            properties: { sku: { type: 'string' }, qty: { type: 'number' } },
          },
        },
      },
    })
  })

  it('handles an array of scalars (trailing []) as a leaf', () => {
    const schema = buildSchemaFromFieldPaths([{ sourcePath: 'tags[]', type: 'TEXT' }])
    expect(schema).toEqual({
      type: 'object',
      properties: { tags: { type: 'array', items: { type: 'string' } } },
    })
  })
})

describe('appCatalogStreamSchema', () => {
  it('prefers exampleRecord (inferred) over field paths', () => {
    const result = appCatalogStreamSchema({
      key: 'order',
      displayFieldKey: 'name',
      fields: [{ fieldKey: 'id', sourcePath: 'id', type: 'TEXT', name: 'ID' }],
      exampleRecord: { id: 'o1', customer: { email: 'a@b.com' } },
    })
    expect(result.schemaSource).toBe('catalog')
    // Inferred from the sample → carries the nested customer object.
    const props = (result.sourceSchema as { properties: Record<string, unknown> }).properties
    expect(props).toHaveProperty('customer')
  })

  it('falls back to field paths when there is no exampleRecord', () => {
    const result = appCatalogStreamSchema({
      key: 'order',
      displayFieldKey: 'name',
      fields: [{ fieldKey: 'name', sourcePath: 'name', type: 'TEXT', name: 'Name' }],
    })
    expect(result.sourceSchema).toEqual({
      type: 'object',
      properties: { name: { type: 'string' } },
    })
  })
})
