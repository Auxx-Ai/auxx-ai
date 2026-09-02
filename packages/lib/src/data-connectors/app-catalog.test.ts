// packages/lib/src/data-connectors/app-catalog.test.ts
// App-catalog → setup materialization (app-fields-and-entities-plan Phase 2 §4.3):
// building a Layer-A source schema from the union of every mapping's declared
// field paths, and the contributing binders now fed straight from one mapping
// `fields` list (no more stream-wide flat map / matchFieldKeys / fieldBindings).

import type { CatalogConnectorStream } from '@auxx/database'
import { describe, expect, it } from 'vitest'
import { BadRequestError } from '../errors'
import {
  appCatalogStreamSchema,
  assertContributingTargetWritable,
  buildContributingAutoBindings,
  buildContributingConnectionAppFields,
  buildContributingFieldBindings,
  buildContributingMatchBindings,
  buildSchemaFromFieldPaths,
  type ContributingTargetField,
  collectStreamSourceFields,
  overlayDeclaredFieldTypes,
} from './app-catalog'

/**
 * Walk a JSON-schema tree by dotted path and return the node there, failing loudly
 * when a segment is missing. Keeps the schema assertions below free of the
 * `Record<string, …>` casts that only ever hid a typo in the path.
 */
function nodeAt(root: unknown, path: string): Record<string, unknown> {
  let current: unknown = root
  const walked: string[] = []
  for (const segment of path.split('.')) {
    if (typeof current !== 'object' || current === null) {
      throw new Error(`not an object at "${walked.join('.')}" while walking "${path}"`)
    }
    current = (current as Record<string, unknown>)[segment]
    walked.push(segment)
  }
  if (typeof current !== 'object' || current === null) {
    throw new Error(`no schema node at "${path}"`)
  }
  return current as Record<string, unknown>
}

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

describe('collectStreamSourceFields', () => {
  it('joins each mapping rootPath + field sourcePath into an absolute path', () => {
    const stream: CatalogConnectorStream = {
      key: 'order',
      mappings: [
        {
          rootPath: '',
          target: { entityKey: 'orders' },
          fields: [{ key: 'shopifyId', sourcePath: 'id', type: 'TEXT', name: 'ID' }],
        },
        {
          rootPath: 'customer',
          target: { entityKind: 'contact' },
          fields: [{ sourcePath: 'email', target: 'primary_email' }],
        },
      ],
    }
    expect(collectStreamSourceFields(stream)).toEqual([
      { sourcePath: 'id', type: 'TEXT' },
      { sourcePath: 'customer.email', type: undefined },
    ])
  })

  it('carries a contributing source-only field its declared type', () => {
    const stream: CatalogConnectorStream = {
      key: 'order',
      mappings: [
        {
          rootPath: '',
          target: { entityKind: 'order' },
          fields: [{ sourcePath: 'note', type: 'TEXT', name: 'Note' }],
        },
      ],
    }
    expect(collectStreamSourceFields(stream)).toEqual([{ sourcePath: 'note', type: 'TEXT' }])
  })
})

describe('appCatalogStreamSchema', () => {
  it('unions declared field paths with exampleRecord shape (definition is the contract)', () => {
    const result = appCatalogStreamSchema({
      key: 'order',
      mappings: [
        {
          rootPath: '',
          target: { entityKey: 'orders' },
          fields: [{ key: 'shopifyId', sourcePath: 'id', type: 'TEXT', name: 'ID' }],
        },
      ],
      exampleRecord: { id: 'o1', customer: { email: 'a@b.com' } },
    })
    expect(result.schemaSource).toBe('catalog')
    // Example-only shape survives alongside the declared field.
    const props = (result.sourceSchema as { properties: Record<string, unknown> }).properties
    expect(props).toHaveProperty('id')
    expect(props).toHaveProperty('customer')
  })

  it('keeps a declared field the exampleRecord omits (nested under an array fan-out)', () => {
    const result = appCatalogStreamSchema({
      key: 'product',
      mappings: [
        {
          rootPath: 'variants[]',
          target: { entityKey: 'variants' },
          fields: [
            { key: 'option1', sourcePath: 'option1', type: 'TEXT', name: 'Option 1' },
            { key: 'option2', sourcePath: 'option2', type: 'TEXT', name: 'Option 2' },
          ],
        },
      ],
      // The example variant only carries option1 — option2 must still exist.
      exampleRecord: { variants: [{ option1: 'Medium' }] },
    })
    const props = (result.sourceSchema as { properties: Record<string, any> }).properties
    const variantProps = props.variants.items.properties
    expect(variantProps.option1).toMatchObject({ type: 'string' })
    expect(variantProps.option2).toMatchObject({ type: 'string' })
  })

  it('refines a leaf with the example wire type and stamps the declared field type', () => {
    const result = appCatalogStreamSchema({
      key: 'product',
      mappings: [
        {
          rootPath: '',
          target: { entityKey: 'products' },
          fields: [{ key: 'price', sourcePath: 'price', type: 'CURRENCY', name: 'Price' }],
        },
      ],
      // Shopify sends money as a string — the wire type wins over the CURRENCY→number guess.
      exampleRecord: { price: '19.99' },
    })
    const props = (result.sourceSchema as { properties: Record<string, any> }).properties
    expect(props.price.type).toBe('string')
    expect(props.price['x-auxx-fieldType']).toBe('CURRENCY')
  })

  it('keeps the declared type when the example value is null', () => {
    const result = appCatalogStreamSchema({
      key: 'order',
      mappings: [
        {
          rootPath: '',
          target: { entityKey: 'orders' },
          fields: [{ key: 'note', sourcePath: 'note', type: 'TEXT', name: 'Note' }],
        },
      ],
      exampleRecord: { note: null },
    })
    const props = (result.sourceSchema as { properties: Record<string, any> }).properties
    expect(props.note.type).toBe('string')
  })

  it('falls back to field paths when there is no exampleRecord', () => {
    const result = appCatalogStreamSchema({
      key: 'order',
      mappings: [
        {
          rootPath: '',
          target: { entityKey: 'orders' },
          fields: [{ key: 'name', sourcePath: 'name', type: 'TEXT', name: 'Name' }],
        },
      ],
    })
    expect(result.sourceSchema).toEqual({
      type: 'object',
      properties: { name: { type: 'string', 'x-auxx-fieldType': 'TEXT' } },
    })
  })

  it('stamps x-auxx-fieldType on an ADDRESS_STRUCT field node (keeping its components)', () => {
    const result = appCatalogStreamSchema({
      key: 'order',
      mappings: [
        {
          rootPath: '',
          target: { entityKey: 'orders' },
          fields: [
            { key: 'shopifyId', sourcePath: 'id', type: 'TEXT', name: 'ID' },
            {
              key: 'shippingAddress',
              sourcePath: 'shipping_address',
              type: 'ADDRESS_STRUCT',
              name: 'Shipping Address',
            },
          ],
        },
      ],
      exampleRecord: {
        id: 'o1',
        shipping_address: { street1: '123 Main St', city: 'Austin', country: 'US' },
      },
    })
    const addr = nodeAt(result.sourceSchema, 'properties.shipping_address')
    expect(addr['x-auxx-fieldType']).toBe('ADDRESS_STRUCT')
    // Components survive in the schema — only the CLIENT flatten stops descending.
    expect(addr.properties).toHaveProperty('city')
  })
})

describe('overlayDeclaredFieldTypes', () => {
  it('stamps a nested + array-element struct path', () => {
    const schema = {
      type: 'object',
      properties: {
        customer: {
          type: 'object',
          properties: { address: { type: 'object', properties: { city: { type: 'string' } } } },
        },
        line_items: {
          type: 'array',
          items: {
            type: 'object',
            properties: { ship: { type: 'object', properties: { zip: { type: 'string' } } } },
          },
        },
      },
    }
    overlayDeclaredFieldTypes(schema, [
      { sourcePath: 'customer.address', type: 'ADDRESS_STRUCT' },
      { sourcePath: 'line_items[].ship', type: 'ADDRESS_STRUCT' },
    ])
    expect(nodeAt(schema, 'properties.customer.properties.address')['x-auxx-fieldType']).toBe(
      'ADDRESS_STRUCT'
    )
    expect(nodeAt(schema, 'properties.line_items.items.properties.ship')['x-auxx-fieldType']).toBe(
      'ADDRESS_STRUCT'
    )
  })

  it('stamps non-struct declared types on scalar leaves, ignores absent paths', () => {
    const schema = {
      type: 'object',
      properties: { name: { type: 'string' }, price: { type: 'string' } },
    }
    overlayDeclaredFieldTypes(schema, [
      { sourcePath: 'name', type: 'TEXT' },
      { sourcePath: 'price', type: 'CURRENCY' },
      { sourcePath: 'missing', type: 'ADDRESS_STRUCT' },
    ])
    expect(nodeAt(schema, 'properties.name')['x-auxx-fieldType']).toBe('TEXT')
    expect(nodeAt(schema, 'properties.price')['x-auxx-fieldType']).toBe('CURRENCY')
    expect(nodeAt(schema, 'properties')).not.toHaveProperty('missing')
  })

  it('never stamps a non-struct type on a branch (object or array-of-objects)', () => {
    const schema = {
      type: 'object',
      properties: {
        customer: { type: 'object', properties: { email: { type: 'string' } } },
        line_items: {
          type: 'array',
          items: { type: 'object', properties: { sku: { type: 'string' } } },
        },
        tags: { type: 'array', items: { type: 'string' } },
      },
    }
    overlayDeclaredFieldTypes(schema, [
      { sourcePath: 'customer', type: 'JSON' },
      { sourcePath: 'line_items', type: 'JSON' },
      { sourcePath: 'tags', type: 'TAGS' },
    ])
    // Branches keep exploding — no stamp; an array of SCALARS is a value leaf — stamped.
    expect(nodeAt(schema, 'properties.customer')).not.toHaveProperty('x-auxx-fieldType')
    expect(nodeAt(schema, 'properties.line_items')).not.toHaveProperty('x-auxx-fieldType')
    expect(nodeAt(schema, 'properties.tags')['x-auxx-fieldType']).toBe('TAGS')
  })
})

describe('assertContributingTargetWritable (reserved-target guard)', () => {
  const recordId: ContributingTargetField = {
    id: 'f_record_id',
    name: 'ID',
    systemAttribute: 'record_id',
    type: 'TEXT',
    isCreatable: false,
    isUpdatable: false,
  }
  const orderTotal: ContributingTargetField = {
    id: 'f_order_total',
    name: 'Total',
    systemAttribute: 'order_total',
    type: 'CURRENCY',
    isCreatable: false,
    isUpdatable: false,
  }
  const fullName: ContributingTargetField = {
    id: 'f_full_name',
    name: 'Name',
    systemAttribute: 'full_name',
    type: 'TEXT',
    isComputed: true,
  }
  const firstName: ContributingTargetField = {
    id: 'f_first',
    name: 'First Name',
    systemAttribute: 'first_name',
    type: 'TEXT',
  }

  it('refuses a computed-field-flagged-off target (record_id)', () => {
    expect(() => assertContributingTargetWritable('record_id', recordId)).toThrow(BadRequestError)
  })

  it('refuses a computed field (full_name)', () => {
    expect(() => assertContributingTargetWritable('full_name', fullName)).toThrow(BadRequestError)
  })

  it('accepts the sell-side totals allow-list despite isCreatable/isUpdatable both false (order_total)', () => {
    expect(() => assertContributingTargetWritable('order_total', orderTotal)).not.toThrow()
  })

  it('accepts an ordinary writable target', () => {
    expect(() => assertContributingTargetWritable('first_name', firstName)).not.toThrow()
  })
})

describe('buildContributingMatchBindings', () => {
  const contactFields: ContributingTargetField[] = [
    { id: 'fld_email', name: 'Email', systemAttribute: 'primary_email', type: 'EMAIL' },
    { id: 'fld_phone', name: 'Phone', systemAttribute: 'primary_phone', type: 'PHONE_INTL' },
  ]

  it('binds a match key when the target resolves, path already relative', () => {
    const [binding, ...rest] = buildContributingMatchBindings(
      'def_contact',
      [{ sourcePath: 'email', target: 'email', match: true }],
      contactFields
    )
    expect(rest).toHaveLength(0)
    expect(binding).toMatchObject({
      targetFieldRef: 'def_contact:fld_email',
      expression: '{email}',
      sourceFields: { email: 'email' },
      identityRole: { kind: 'match', normalize: 'email' },
    })
  })

  it('drops a match field with no matching target field', () => {
    expect(
      buildContributingMatchBindings(
        'def_contact',
        [{ sourcePath: 'nope', target: 'nope', match: true }],
        contactFields
      )
    ).toEqual([])
  })

  it('ignores a non-match field entirely', () => {
    expect(
      buildContributingMatchBindings(
        'def_contact',
        [{ sourcePath: 'email', target: 'email' }],
        contactFields
      )
    ).toEqual([])
  })

  it('returns nothing for an empty fields list', () => {
    expect(buildContributingMatchBindings('def_contact', [], contactFields)).toEqual([])
  })

  it('throws refusing a match binding onto a reserved, non-writable target', () => {
    const reserved: ContributingTargetField[] = [
      {
        id: 'f_id',
        name: 'ID',
        systemAttribute: 'record_id',
        type: 'TEXT',
        isCreatable: false,
        isUpdatable: false,
      },
    ]
    expect(() =>
      buildContributingMatchBindings(
        'def_contact',
        [{ sourcePath: 'id', target: 'record_id', match: true }],
        reserved
      )
    ).toThrow(BadRequestError)
  })
})

describe('buildContributingFieldBindings', () => {
  const defFields: ContributingTargetField[] = [
    { id: 'f_first', name: 'First Name', systemAttribute: 'first_name', type: 'TEXT' },
    { id: 'f_last', name: 'Last Name', systemAttribute: null, type: 'TEXT' },
  ]

  it('binds by systemAttribute and by normalized name, carrying the declared mergeStrategy', () => {
    const bindings = buildContributingFieldBindings(
      'def_contact',
      'shopify',
      [
        { sourcePath: 'first_name', target: 'first_name', mergeStrategy: 'fill_blank' },
        { sourcePath: 'last_name', target: 'Last Name' },
      ],
      defFields
    )
    expect(bindings).toHaveLength(2)
    expect(bindings[0]).toMatchObject({
      targetFieldRef: 'def_contact:f_first',
      expression: '{first_name}',
      sourceFields: { first_name: 'first_name' },
      mergeStrategy: 'fill_blank',
    })
    expect(bindings[0]!.identityRole).toBeUndefined()
    expect(bindings[1]!.targetFieldRef).toBe('def_contact:f_last')
    expect(bindings[1]!.mergeStrategy).toBeUndefined()
  })

  it('drops a binding whose target key does not resolve', () => {
    const bindings = buildContributingFieldBindings(
      'def_contact',
      'shopify',
      [{ sourcePath: 'unknown', target: 'no_such_field' }],
      defFields
    )
    expect(bindings).toHaveLength(0)
  })

  it('skips a match field (handled by buildContributingMatchBindings)', () => {
    const bindings = buildContributingFieldBindings(
      'def_contact',
      'shopify',
      [{ sourcePath: 'first_name', target: 'first_name', match: true }],
      defFields
    )
    expect(bindings).toHaveLength(0)
  })

  it('skips a source-only field (no target/appField)', () => {
    const bindings = buildContributingFieldBindings(
      'def_contact',
      'shopify',
      [{ sourcePath: 'raw', type: 'JSON', name: 'Raw' }],
      defFields
    )
    expect(bindings).toHaveLength(0)
  })

  it('throws refusing an explicit target that resolves to a reserved, non-writable field', () => {
    const reserved: ContributingTargetField[] = [
      {
        id: 'f_id',
        name: 'ID',
        systemAttribute: 'record_id',
        type: 'TEXT',
        isCreatable: false,
        isUpdatable: false,
      },
    ]
    expect(() =>
      buildContributingFieldBindings(
        'def_contact',
        'shopify',
        [{ sourcePath: 'id', target: 'record_id' }],
        reserved
      )
    ).toThrow(BadRequestError)
  })

  it('accepts an explicit target in the sell-side totals allow-list', () => {
    const totals: ContributingTargetField[] = [
      {
        id: 'f_total',
        name: 'Total',
        systemAttribute: 'order_total',
        type: 'CURRENCY',
        isCreatable: false,
        isUpdatable: false,
      },
    ]
    const bindings = buildContributingFieldBindings(
      'def_order',
      'shopify',
      [{ sourcePath: 'total_price', target: 'order_total' }],
      totals
    )
    expect(bindings).toHaveLength(1)
    expect(bindings[0]?.targetFieldRef).toBe('def_order:f_total')
  })

  it('binds appField to the late-bound @app: ref, stamping identityRole when the app field is identity: true', () => {
    const bindings = buildContributingFieldBindings(
      'def_contact',
      'shopify',
      [{ sourcePath: 'id', appField: 'customerId' }],
      [
        {
          id: 'cf_cust_us',
          name: 'Shopify customer ID',
          systemAttribute: null,
          type: 'TEXT',
          appFieldKey: 'customerId',
          appSlug: 'shopify',
          isIdentity: true,
        },
      ]
    )
    expect(bindings).toHaveLength(1)
    expect(bindings[0]).toMatchObject({
      targetFieldRef: 'def_contact:@app:shopify:customerId',
      expression: '{id}',
      identityRole: { kind: 'externalId' },
    })
  })

  it('stamps identityRole when ANY connection-scoped copy of the app field is identity (not find-first)', () => {
    const bindings = buildContributingFieldBindings(
      'def_contact',
      'shopify',
      [{ sourcePath: 'id', appField: 'customerId' }],
      [
        {
          id: 'cf_cust_stale',
          name: 'Shopify customer ID',
          systemAttribute: null,
          type: 'TEXT',
          appFieldKey: 'customerId',
          appSlug: 'shopify',
          isIdentity: false,
        },
        {
          id: 'cf_cust_current',
          name: 'Shopify customer ID',
          systemAttribute: null,
          type: 'TEXT',
          appFieldKey: 'customerId',
          appSlug: 'shopify',
          isIdentity: true,
        },
      ]
    )
    expect(bindings).toHaveLength(1)
    expect(bindings[0]).toMatchObject({
      targetFieldRef: 'def_contact:@app:shopify:customerId',
      identityRole: { kind: 'externalId' },
    })
  })

  it('binds appField with no identityRole when the app field is not identity: true', () => {
    const bindings = buildContributingFieldBindings(
      'def_contact',
      'shopify',
      [{ sourcePath: 'domain', appField: 'storeDomain' }],
      [
        {
          id: 'cf_domain',
          name: 'Shopify store',
          systemAttribute: null,
          type: 'TEXT',
          appFieldKey: 'storeDomain',
          appSlug: 'shopify',
          isIdentity: false,
        },
      ]
    )
    expect(bindings).toHaveLength(1)
    expect(bindings[0]!.targetFieldRef).toBe('def_contact:@app:shopify:storeDomain')
    expect(bindings[0]!.identityRole).toBeUndefined()
  })

  it('does NOT match an appField whose row belongs to a DIFFERENT app (slug scope)', () => {
    const bindings = buildContributingFieldBindings(
      'def_contact',
      'shopify',
      [{ sourcePath: 'id', appField: 'customerId' }],
      [
        {
          id: 'cf_cust_stripe',
          name: 'Stripe customer ID',
          systemAttribute: null,
          type: 'TEXT',
          appFieldKey: 'customerId',
          appSlug: 'stripe',
          isIdentity: true,
        },
      ]
    )
    expect(bindings).toHaveLength(0)
  })

  it('does NOT match an appField whose row has a null appSlug (fails closed)', () => {
    const bindings = buildContributingFieldBindings(
      'def_contact',
      'shopify',
      [{ sourcePath: 'id', appField: 'customerId' }],
      [
        {
          id: 'cf_cust_legacy',
          name: 'Shopify customer ID',
          systemAttribute: null,
          type: 'TEXT',
          appFieldKey: 'customerId',
          appSlug: null,
          isIdentity: true,
        },
      ]
    )
    expect(bindings).toHaveLength(0)
  })

  it('drops an appField binding whose appFieldKey is not declared', () => {
    const bindings = buildContributingFieldBindings(
      'def_contact',
      'shopify',
      [{ sourcePath: 'id', appField: 'noSuchField' }],
      defFields
    )
    expect(bindings).toHaveLength(0)
  })
})

describe('buildContributingConnectionAppFields', () => {
  it('builds a connectionMetaKey-flagged FieldMapping per entry, never carrying identityRole', () => {
    const bindings = buildContributingConnectionAppFields('def_contact', 'shopify', [
      { appField: 'storeDomain', from: 'shopDomain' },
    ])
    expect(bindings).toHaveLength(1)
    expect(bindings[0]).toMatchObject({
      targetFieldRef: 'def_contact:@app:shopify:storeDomain',
      connectionMetaKey: 'shopDomain',
      expression: '',
      sourceFields: {},
    })
    expect(bindings[0]!.identityRole).toBeUndefined()
  })

  it('returns an empty array for no entries', () => {
    expect(buildContributingConnectionAppFields('def_contact', 'shopify', [])).toEqual([])
  })
})

describe('buildContributingAutoBindings (zero-config heuristic)', () => {
  // Mirrors the system `contact` def: writable first/last/phone, non-writable `id` +
  // `created_at`, computed `fullName`.
  const contactFields: ContributingTargetField[] = [
    {
      id: 'f_id',
      name: 'ID',
      systemAttribute: 'id',
      type: 'TEXT',
      isCreatable: false,
      isUpdatable: false,
    },
    { id: 'f_first', name: 'First Name', systemAttribute: 'first_name', type: 'TEXT' },
    { id: 'f_last', name: 'Last Name', systemAttribute: 'last_name', type: 'TEXT' },
    { id: 'f_phone', name: 'Phone', systemAttribute: 'phone', type: 'PHONE_INTL' },
    { id: 'f_full', name: 'Name', systemAttribute: 'full_name', type: 'TEXT', isComputed: true },
    {
      id: 'f_created',
      name: 'Created',
      systemAttribute: 'created_at',
      type: 'DATETIME',
      isCreatable: false,
      isUpdatable: false,
    },
  ]

  it('name-matches leaf keys of the sampled root to writable targets, no identityRole', () => {
    const bindings = buildContributingAutoBindings(
      'def_contact',
      '',
      { first_name: 'Ada', last_name: 'Lovelace', phone: '+1' },
      contactFields
    )
    expect(bindings.map((b) => b.targetFieldRef).sort()).toEqual([
      'def_contact:f_first',
      'def_contact:f_last',
      'def_contact:f_phone',
    ])
    expect(bindings.every((b) => b.identityRole === undefined)).toBe(true)
  })

  it('skips non-writable (id, created_at) and computed (fullName) targets', () => {
    const bindings = buildContributingAutoBindings(
      'def_contact',
      '',
      { id: '1', created_at: '2024-01-01', full_name: 'Ada' },
      contactFields
    )
    expect(bindings).toHaveLength(0)
  })

  it('skips a target two source keys both resolve to (ambiguous)', () => {
    const bindings = buildContributingAutoBindings(
      'def_contact',
      '',
      { first_name: 'Ada', 'First Name': 'Ada2' },
      contactFields
    )
    expect(bindings).toHaveLength(0)
  })

  it('skips nested object / array values, keeps only scalar leaves', () => {
    const bindings = buildContributingAutoBindings(
      'def_contact',
      'customer',
      { customer: { first_name: 'Ada', address: { city: 'X' }, tags: ['a'] } },
      contactFields
    )
    expect(bindings).toHaveLength(1)
    expect(bindings[0]).toMatchObject({
      targetFieldRef: 'def_contact:f_first',
      expression: '{first_name}',
    })
  })

  it('samples the FIRST element of an array root', () => {
    const bindings = buildContributingAutoBindings(
      'def_contact',
      'line_items[]',
      { line_items: [{ first_name: 'Ada' }, { first_name: 'Grace' }] },
      contactFields
    )
    expect(bindings).toHaveLength(1)
    expect(bindings[0]).toMatchObject({
      targetFieldRef: 'def_contact:f_first',
      expression: '{first_name}',
      sourceFields: { first_name: 'first_name' },
    })
  })

  it('returns nothing when there is no exampleRecord', () => {
    expect(buildContributingAutoBindings('def_contact', '', undefined, contactFields)).toEqual([])
  })
})
