// packages/lib/src/data-connectors/owned-mappings.test.ts
// Pure-helper coverage for owned-mode app default-mapping materialization
// (step-11 gap 2). The DB orchestration in `createConnectorFromAppCatalog` has no
// vitest harness; these cover the ref-binding logic that's easy to get wrong.

import { describe, expect, it } from 'vitest'
import {
  buildLazyOwnedFieldMappings,
  type OwnedFieldEntry,
  ownedParentRootPath,
  partitionOwnedFields,
} from './mutations'

type CatalogField = OwnedFieldEntry['field']

const FIELDS: CatalogField[] = [
  { fieldKey: 'id', sourcePath: 'id', type: 'TEXT', name: 'GitHub ID' },
  { fieldKey: 'title', sourcePath: 'title', type: 'TEXT', name: 'Title' },
  // fieldKey differs from sourcePath — the provisioned column keys on fieldKey,
  // the projection expression keys on sourcePath.
  { fieldKey: 'author', sourcePath: 'user_login', type: 'TEXT', name: 'Author' },
  {
    fieldKey: 'secret',
    sourcePath: 'secret',
    type: 'TEXT',
    name: 'Secret',
    capabilities: { hidden: true },
  },
]

describe('buildLazyOwnedFieldMappings', () => {
  // Root-level fields: the subtree-relative path equals the sourcePath.
  const entries = FIELDS.map((field) => ({ field, relativeSourcePath: field.sourcePath }))

  it('emits a provision spec + null ref per field, keyed by appFieldKey, name as display', () => {
    const mappings = buildLazyOwnedFieldMappings(entries)
    // Every declared field becomes a lazy entry (nothing dropped — no DB ids needed yet).
    expect(mappings).toHaveLength(4)

    const author = mappings.find((m) => m.provision?.appFieldKey === 'author')
    expect(author).toBeDefined()
    expect(author?.targetFieldRef).toBeNull()
    expect(author?.provision).toEqual({
      name: 'Author',
      appFieldKey: 'author',
      type: 'TEXT',
      isHidden: false,
    })
    // Expression reads the relative source path, not the fieldKey.
    expect(author?.expression).toBe('{user_login}')
    expect(author?.sourceFields).toEqual({ user_login: 'user_login' })
    expect(author?.id).toBeTruthy()
  })

  it('honors hidden capabilities in the provision spec', () => {
    const mappings = buildLazyOwnedFieldMappings(entries)
    const secret = mappings.find((m) => m.provision?.appFieldKey === 'secret')
    expect(secret?.provision?.isHidden).toBe(true)
  })

  it('keys a child mapping expression on the SUBTREE-relative path, not the full sourcePath', () => {
    // A `line_items[]` child: the provision key stays the stable fieldKey, but the
    // expression must read `{sku}` (the subtree is one line item), not `{line_items[].sku}`.
    const childMappings = buildLazyOwnedFieldMappings([
      {
        field: { fieldKey: 'sku', sourcePath: 'line_items[].sku', type: 'TEXT', name: 'SKU' },
        relativeSourcePath: 'sku',
      },
    ])
    expect(childMappings).toHaveLength(1)
    expect(childMappings[0]?.expression).toBe('{sku}')
    expect(childMappings[0]?.sourceFields).toEqual({ sku: 'sku' })
    expect(childMappings[0]?.provision?.appFieldKey).toBe('sku')
    expect(childMappings[0]?.targetFieldRef).toBeNull()
  })
})

describe('partitionOwnedFields', () => {
  // The multi-level Shopify order fan-out: order root + customer (contributing) +
  // line_items[] (owned child) + line_items[].product_id (reference).
  const FIELDS = [
    { fieldKey: 'id', sourcePath: 'id', type: 'TEXT', name: 'Order ID' },
    { fieldKey: 'name', sourcePath: 'name', type: 'TEXT', name: 'Order Name' },
    { fieldKey: 'customer.email', sourcePath: 'customer.email', type: 'EMAIL', name: 'Email' },
    { fieldKey: 'lineItems.sku', sourcePath: 'line_items[].sku', type: 'TEXT', name: 'SKU' },
    { fieldKey: 'lineItems.qty', sourcePath: 'line_items[].quantity', type: 'NUMBER', name: 'Qty' },
    {
      fieldKey: 'lineItems.productId',
      sourcePath: 'line_items[].product_id',
      type: 'TEXT',
      name: 'Product ID',
    },
  ]
  const MAPPINGS = [
    {
      rootPath: '',
      target: {
        mode: 'owned' as const,
        entity: { apiSlug: 'shopify_orders', singular: 'O', plural: 'Os' },
      },
    },
    { rootPath: 'customer', target: { mode: 'contributing' as const, entityKind: 'contact' } },
    {
      rootPath: 'line_items[]',
      target: {
        mode: 'owned' as const,
        entity: { apiSlug: 'shopify_line_items', singular: 'L', plural: 'Ls' },
      },
    },
    {
      rootPath: 'line_items[].product_id',
      linkMode: 'reference' as const,
      target: {
        mode: 'owned' as const,
        entity: { apiSlug: 'shopify_products', singular: 'P', plural: 'Ps' },
      },
    },
  ]

  const result = partitionOwnedFields(FIELDS, MAPPINGS)

  it('assigns root fields to the order def', () => {
    expect(result['']?.map((e) => e.field.fieldKey)).toEqual(['id', 'name'])
  })

  it('assigns line fields to the line-item def, rewritten subtree-relative', () => {
    const line = result['line_items[]'] ?? []
    expect(line.map((e) => e.field.fieldKey)).toEqual(['lineItems.sku', 'lineItems.qty'])
    expect(line.map((e) => e.relativeSourcePath)).toEqual(['sku', 'quantity'])
  })

  it('excludes a field owned by a contributing branch (customer.email is not an order column)', () => {
    expect(result['']?.some((e) => e.field.fieldKey === 'customer.email')).toBe(false)
  })

  it('excludes the reference id field — it is the edge FK, not a line-item column', () => {
    const line = result['line_items[]'] ?? []
    expect(line.some((e) => e.field.fieldKey === 'lineItems.productId')).toBe(false)
    // The reference mapping (shopify_products) owns no columns at all.
    expect(result['line_items[].product_id']).toBeUndefined()
  })
})

describe('ownedParentRootPath', () => {
  // The fan-out's `parentRelation` only forms when each child mapping carries a
  // `parentMappingId` — derived from rootPath nesting at materialization.
  const ALL = ['', 'line_items[]', 'line_items[].variants[]']

  it('a root mapping has no parent', () => {
    expect(ownedParentRootPath('', ALL)).toBeNull()
  })

  it('a one-level child parents to the root', () => {
    expect(ownedParentRootPath('line_items[]', ALL)).toBe('')
  })

  it('a nested child parents to the LONGEST proper prefix, not the root', () => {
    expect(ownedParentRootPath('line_items[].variants[]', ALL)).toBe('line_items[]')
  })

  it('rejects a bare prefix that does not end on a path boundary', () => {
    // `line_items` is a textual prefix of `line_items_extra[]` but not a path parent.
    expect(ownedParentRootPath('line_items_extra[]', ['', 'line_items[]'])).toBe('')
  })

  it('returns null when no candidate prefix exists (no root declared)', () => {
    expect(ownedParentRootPath('orders[].lines[]', ['orders[].lines[]', 'customers[]'])).toBeNull()
  })
})
