// packages/lib/src/data-connectors/app-catalog.test.ts
// App-catalog → setup materialization (create-sync-flow §3.1, Tier 1): building a
// Layer-A source schema from declared field paths, and preferring an exampleRecord.

import { describe, expect, it } from 'vitest'
import {
  appCatalogStreamSchema,
  buildContributingFieldBindings,
  buildSchemaFromFieldPaths,
  type ContributingTargetField,
} from './app-catalog'

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

describe('buildContributingFieldBindings', () => {
  const defFields: ContributingTargetField[] = [
    { id: 'f_first', name: 'First Name', systemAttribute: 'first_name', type: 'TEXT' },
    { id: 'f_last', name: 'Last Name', systemAttribute: null, type: 'TEXT' },
  ]
  const sourceFields = [
    { fieldKey: 'first_name', sourcePath: 'customer.first_name', type: 'TEXT', name: 'First' },
    { fieldKey: 'last_name', sourcePath: 'customer.last_name', type: 'TEXT', name: 'Last' },
    { fieldKey: 'unknown', sourcePath: 'customer.unknown', type: 'TEXT', name: 'Unknown' },
  ]

  it('binds by systemAttribute and by normalized name, subtree-relative, no identityRole', () => {
    const bindings = buildContributingFieldBindings(
      'def_contact',
      'customer',
      [
        { sourceFieldKey: 'first_name', targetKey: 'first_name' }, // → by systemAttribute
        { sourceFieldKey: 'last_name', targetKey: 'Last Name' }, // → by name (no systemAttribute)
      ],
      sourceFields,
      defFields
    )
    expect(bindings).toHaveLength(2)
    expect(bindings[0]).toMatchObject({
      targetFieldRef: 'def_contact:f_first',
      expression: '{first_name}', // rootPath prefix stripped
      sourceFields: { first_name: 'first_name' },
    })
    expect(bindings[0]!.identityRole).toBeUndefined()
    expect(bindings[1]!.targetFieldRef).toBe('def_contact:f_last')
  })

  it('drops a binding whose target key does not resolve', () => {
    const bindings = buildContributingFieldBindings(
      'def_contact',
      'customer',
      [{ sourceFieldKey: 'unknown', targetKey: 'no_such_field' }],
      sourceFields,
      defFields
    )
    expect(bindings).toHaveLength(0)
  })

  it('drops a binding whose source field key is unknown', () => {
    const bindings = buildContributingFieldBindings(
      'def_contact',
      'customer',
      [{ sourceFieldKey: 'missing_source', targetKey: 'first_name' }],
      sourceFields,
      defFields
    )
    expect(bindings).toHaveLength(0)
  })

  it('drops everything for an array-rooted mapping', () => {
    const bindings = buildContributingFieldBindings(
      'def_contact',
      'line_items[]',
      [{ sourceFieldKey: 'first_name', targetKey: 'first_name' }],
      sourceFields,
      defFields
    )
    expect(bindings).toHaveLength(0)
  })

  it('binds at root (no prefix) with the full source path', () => {
    const bindings = buildContributingFieldBindings(
      'def_contact',
      '',
      [{ sourceFieldKey: 'email', targetKey: 'email' }],
      [{ fieldKey: 'email', sourcePath: 'email', type: 'EMAIL', name: 'Email' }],
      [{ id: 'f_email', name: 'Email', systemAttribute: 'email', type: 'EMAIL' }]
    )
    expect(bindings).toHaveLength(1)
    expect(bindings[0]).toMatchObject({
      targetFieldRef: 'def_contact:f_email',
      expression: '{email}',
    })
  })
})
