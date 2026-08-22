// packages/lib/src/data-connectors/app-catalog.test.ts
// App-catalog → setup materialization (create-sync-flow §3.1, Tier 1): building a
// Layer-A source schema from declared field paths, and preferring an exampleRecord.

import { describe, expect, it } from 'vitest'
import {
  appCatalogStreamSchema,
  buildContributingAutoBindings,
  buildContributingConnectionAppFields,
  buildContributingFieldBindings,
  buildSchemaFromFieldPaths,
  type ContributingTargetField,
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

describe('appCatalogStreamSchema', () => {
  it('unions declared field paths with exampleRecord shape (definition is the contract)', () => {
    const result = appCatalogStreamSchema({
      key: 'order',
      displayFieldKey: 'name',
      fields: [{ fieldKey: 'id', sourcePath: 'id', type: 'TEXT', name: 'ID' }],
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
      displayFieldKey: 'title',
      fields: [
        { fieldKey: 'v.option1', sourcePath: 'variants[].option1', type: 'TEXT', name: 'Option 1' },
        { fieldKey: 'v.option2', sourcePath: 'variants[].option2', type: 'TEXT', name: 'Option 2' },
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
      displayFieldKey: 'title',
      fields: [{ fieldKey: 'price', sourcePath: 'price', type: 'CURRENCY', name: 'Price' }],
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
      displayFieldKey: 'name',
      fields: [{ fieldKey: 'note', sourcePath: 'note', type: 'TEXT', name: 'Note' }],
      exampleRecord: { note: null },
    })
    const props = (result.sourceSchema as { properties: Record<string, any> }).properties
    expect(props.note.type).toBe('string')
  })

  it('falls back to field paths when there is no exampleRecord', () => {
    const result = appCatalogStreamSchema({
      key: 'order',
      displayFieldKey: 'name',
      fields: [{ fieldKey: 'name', sourcePath: 'name', type: 'TEXT', name: 'Name' }],
    })
    expect(result.sourceSchema).toEqual({
      type: 'object',
      properties: { name: { type: 'string', 'x-auxx-fieldType': 'TEXT' } },
    })
  })

  it('stamps x-auxx-fieldType on an ADDRESS_STRUCT field node (keeping its components)', () => {
    const result = appCatalogStreamSchema({
      key: 'order',
      displayFieldKey: 'name',
      fields: [
        { fieldKey: 'id', sourcePath: 'id', type: 'TEXT', name: 'ID' },
        {
          fieldKey: 'shippingAddress',
          sourcePath: 'shipping_address',
          type: 'ADDRESS_STRUCT',
          name: 'Shipping Address',
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
      { fieldKey: 'a', sourcePath: 'customer.address', type: 'ADDRESS_STRUCT', name: 'A' },
      { fieldKey: 'b', sourcePath: 'line_items[].ship', type: 'ADDRESS_STRUCT', name: 'B' },
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
      { fieldKey: 'name', sourcePath: 'name', type: 'TEXT', name: 'Name' },
      { fieldKey: 'price', sourcePath: 'price', type: 'CURRENCY', name: 'Price' },
      { fieldKey: 'gone', sourcePath: 'missing', type: 'ADDRESS_STRUCT', name: 'Gone' },
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
      { fieldKey: 'customer', sourcePath: 'customer', type: 'JSON', name: 'Customer' },
      { fieldKey: 'lines', sourcePath: 'line_items', type: 'JSON', name: 'Lines' },
      { fieldKey: 'tags', sourcePath: 'tags', type: 'TAGS', name: 'Tags' },
    ])
    // Branches keep exploding — no stamp; an array of SCALARS is a value leaf — stamped.
    expect(nodeAt(schema, 'properties.customer')).not.toHaveProperty('x-auxx-fieldType')
    expect(nodeAt(schema, 'properties.line_items')).not.toHaveProperty('x-auxx-fieldType')
    expect(nodeAt(schema, 'properties.tags')['x-auxx-fieldType']).toBe('TAGS')
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
      'shopify',
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
      'shopify',
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
      'shopify',
      'customer',
      [{ sourceFieldKey: 'missing_source', targetKey: 'first_name' }],
      sourceFields,
      defFields
    )
    expect(bindings).toHaveLength(0)
  })

  // A named array root relativizes deterministically ('variants[].sku' → 'sku'), the
  // same rule the owned partitioner syncs on; only a NESTED array leaves a digit-less
  // `[]` that `mapRecord.getByPath` cannot resolve, and that is skipped PER FIELD.
  // Worked example from plans/products/02-shopify-mapping.md §1.4.
  const partFields: ContributingTargetField[] = [
    { id: 'f_sku', name: 'SKU', systemAttribute: 'part_sku', type: 'TEXT' },
    { id: 'f_price', name: 'Price', systemAttribute: null, type: 'CURRENCY' },
    { id: 'f_inventory', name: 'Inventory', systemAttribute: null, type: 'NUMBER' },
  ]
  const variantSourceFields = [
    { fieldKey: 'variants.sku', sourcePath: 'variants[].sku', type: 'TEXT', name: 'SKU' },
    { fieldKey: 'variants.price', sourcePath: 'variants[].price', type: 'CURRENCY', name: 'Price' },
    {
      fieldKey: 'variants.inventory_quantity',
      sourcePath: 'variants[].inventory_quantity',
      type: 'NUMBER',
      name: 'Inventory quantity',
    },
    {
      fieldKey: 'variants.option_value',
      sourcePath: 'variants[].options[].value',
      type: 'TEXT',
      name: 'Option value',
    },
    { fieldKey: 'variants.id', sourcePath: 'variants[].id', type: 'TEXT', name: 'Variant ID' },
  ]

  it('binds declared fieldBindings under a named array root, subtree-relative (02 §1.4)', () => {
    const bindings = buildContributingFieldBindings(
      'def_part',
      'shopify',
      'variants[]',
      [
        { sourceFieldKey: 'variants.sku', targetKey: 'sku' },
        { sourceFieldKey: 'variants.price', targetKey: 'price' },
        { sourceFieldKey: 'variants.inventory_quantity', targetKey: 'inventory' },
      ],
      variantSourceFields,
      partFields
    )
    expect(bindings.map((b) => b.targetFieldRef)).toEqual([
      'def_part:f_sku',
      'def_part:f_price',
      'def_part:f_inventory',
    ])
    expect(bindings[0]).toMatchObject({
      expression: '{sku}', // 'variants[].' stripped
      sourceFields: { sku: 'sku' },
    })
    expect(bindings[1]!.expression).toBe('{price}')
    expect(bindings[2]!.expression).toBe('{inventory_quantity}')
  })

  it('skips a NESTED array path per field, keeping its array-root siblings', () => {
    const bindings = buildContributingFieldBindings(
      'def_part',
      'shopify',
      'variants[]',
      [
        { sourceFieldKey: 'variants.sku', targetKey: 'sku' },
        // 'options[].value' keeps a digit-less `[]` after stripping — unresolvable.
        { sourceFieldKey: 'variants.option_value', targetKey: 'price' },
      ],
      variantSourceFields,
      partFields
    )
    expect(bindings).toHaveLength(1)
    expect(bindings[0]!.targetFieldRef).toBe('def_part:f_sku')
  })

  it('stamps identityRole externalId for an identity targetAppField under an array root', () => {
    const bindings = buildContributingFieldBindings(
      'def_part',
      'shopify',
      'variants[]',
      [{ sourceFieldKey: 'variants.id', targetAppField: 'variantId' }],
      variantSourceFields,
      [
        {
          id: 'cf_variant_id',
          name: 'Shopify variant ID',
          systemAttribute: null,
          type: 'TEXT',
          appFieldKey: 'variantId',
          appSlug: 'shopify',
          isIdentity: true,
        },
      ]
    )
    expect(bindings).toHaveLength(1)
    expect(bindings[0]).toMatchObject({
      targetFieldRef: 'def_part:@app:shopify:variantId',
      expression: '{id}',
      identityRole: { kind: 'externalId' },
    })
  })

  it('does NOT claim a source outside the root subtree boundary (customer vs customer_notes)', () => {
    const bindings = buildContributingFieldBindings(
      'def_contact',
      'shopify',
      'customer',
      [{ sourceFieldKey: 'note_body', targetKey: 'first_name' }],
      [{ fieldKey: 'note_body', sourcePath: 'customer_notes.body', type: 'TEXT', name: 'Note' }],
      defFields
    )
    expect(bindings).toHaveLength(0)
  })

  it('binds at root (no prefix) with the full source path', () => {
    const bindings = buildContributingFieldBindings(
      'def_contact',
      'shopify',
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

  it('binds targetAppField to the late-bound @app: ref, stamping identityRole when the app field is identity: true', () => {
    const bindings = buildContributingFieldBindings(
      'def_contact',
      'shopify',
      '',
      [{ sourceFieldKey: 'shopify_id', targetAppField: 'customerId' }],
      [{ fieldKey: 'shopify_id', sourcePath: 'id', type: 'TEXT', name: 'Shopify ID' }],
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
    // Multiple connections of the same app → one `customerId` CustomField per connection.
    // The oldest/first copy is a stale pre-feature row (isIdentity:false); a correctly
    // stamped copy for the current connection is later in the list. Find-first would read
    // the stale row's flag and skip identityRole — the bug. `.some()` must not.
    const bindings = buildContributingFieldBindings(
      'def_contact',
      'shopify',
      '',
      [{ sourceFieldKey: 'shopify_id', targetAppField: 'customerId' }],
      [{ fieldKey: 'shopify_id', sourcePath: 'id', type: 'TEXT', name: 'Shopify ID' }],
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

  it('binds targetAppField with no identityRole when the app field is not identity: true', () => {
    const bindings = buildContributingFieldBindings(
      'def_contact',
      'shopify',
      '',
      [{ sourceFieldKey: 'domain', targetAppField: 'storeDomain' }],
      [{ fieldKey: 'domain', sourcePath: 'domain', type: 'TEXT', name: 'Domain' }],
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

  it('does NOT match a targetAppField whose row belongs to a DIFFERENT app (slug scope)', () => {
    // The org also runs Stripe, which provisioned its own `customerId` on contact.
    // Shopify's binder (appSlug 'shopify') must never bind to the Stripe row.
    const bindings = buildContributingFieldBindings(
      'def_contact',
      'shopify',
      '',
      [{ sourceFieldKey: 'shopify_id', targetAppField: 'customerId' }],
      [{ fieldKey: 'shopify_id', sourcePath: 'id', type: 'TEXT', name: 'Shopify ID' }],
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

  it('does NOT match a targetAppField whose row has a null appSlug (fails closed)', () => {
    const bindings = buildContributingFieldBindings(
      'def_contact',
      'shopify',
      '',
      [{ sourceFieldKey: 'shopify_id', targetAppField: 'customerId' }],
      [{ fieldKey: 'shopify_id', sourcePath: 'id', type: 'TEXT', name: 'Shopify ID' }],
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

  it('drops a targetAppField binding whose appFieldKey is not declared', () => {
    const bindings = buildContributingFieldBindings(
      'def_contact',
      'shopify',
      '',
      [{ sourceFieldKey: 'shopify_id', targetAppField: 'noSuchField' }],
      [{ fieldKey: 'shopify_id', sourcePath: 'id', type: 'TEXT', name: 'Shopify ID' }],
      defFields
    )
    expect(bindings).toHaveLength(0)
  })
})

describe('buildContributingConnectionAppFields', () => {
  it('builds a connectionMetaKey-flagged FieldMapping per entry, never carrying identityRole', () => {
    const bindings = buildContributingConnectionAppFields('def_contact', 'shopify', [
      { appFieldKey: 'storeDomain', from: 'shopDomain' },
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

  it('name-matches leaf source fields to writable targets at root, no identityRole', () => {
    const bindings = buildContributingAutoBindings(
      'def_contact',
      '',
      [
        { fieldKey: 'firstName', sourcePath: 'first_name', type: 'TEXT', name: 'First Name' },
        { fieldKey: 'lastName', sourcePath: 'last_name', type: 'TEXT', name: 'Last Name' },
        { fieldKey: 'phone', sourcePath: 'phone', type: 'TEXT', name: 'Phone' },
      ],
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
      [
        { fieldKey: 'id', sourcePath: 'id', type: 'TEXT', name: 'Shopify ID' },
        { fieldKey: 'createdAt', sourcePath: 'created_at', type: 'DATETIME', name: 'Created' },
        { fieldKey: 'fullName', sourcePath: 'full_name', type: 'TEXT', name: 'Name' },
      ],
      contactFields
    )
    expect(bindings).toHaveLength(0)
  })

  it('skips a target two source fields both resolve to (ambiguous)', () => {
    const bindings = buildContributingAutoBindings(
      'def_contact',
      '',
      [
        { fieldKey: 'firstName', sourcePath: 'first_name', type: 'TEXT', name: 'First Name' },
        { fieldKey: 'givenName', sourcePath: 'First Name', type: 'TEXT', name: 'Given' },
      ],
      contactFields
    )
    expect(bindings).toHaveLength(0)
  })

  it('skips nested + array-element source paths, keeps only direct leaves', () => {
    const bindings = buildContributingAutoBindings(
      'def_contact',
      'customer',
      [
        {
          fieldKey: 'firstName',
          sourcePath: 'customer.first_name',
          type: 'TEXT',
          name: 'First Name',
        },
        { fieldKey: 'city', sourcePath: 'customer.address.phone', type: 'TEXT', name: 'Nested' },
        { fieldKey: 'tag', sourcePath: 'customer.tags[].phone', type: 'TEXT', name: 'Array' },
      ],
      contactFields
    )
    expect(bindings).toHaveLength(1)
    expect(bindings[0]).toMatchObject({
      targetFieldRef: 'def_contact:f_first',
      expression: '{first_name}',
    })
  })

  it('binds direct leaves under a named array root, still skipping nested-array leaves', () => {
    // 'line_items[].first_name' relativizes to 'first_name' — deterministic, binds;
    // 'line_items[].options[].value' keeps a digit-less `[]` — skipped per field.
    const bindings = buildContributingAutoBindings(
      'def_contact',
      'line_items[]',
      [
        {
          fieldKey: 'firstName',
          sourcePath: 'line_items[].first_name',
          type: 'TEXT',
          name: 'First Name',
        },
        {
          fieldKey: 'optionValue',
          sourcePath: 'line_items[].options[].value',
          type: 'TEXT',
          name: 'Option value',
        },
      ],
      contactFields
    )
    expect(bindings).toHaveLength(1)
    expect(bindings[0]).toMatchObject({
      targetFieldRef: 'def_contact:f_first',
      expression: '{first_name}',
      sourceFields: { first_name: 'first_name' },
    })
  })
})
