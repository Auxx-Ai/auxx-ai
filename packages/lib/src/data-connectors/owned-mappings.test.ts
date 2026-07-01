// packages/lib/src/data-connectors/owned-mappings.test.ts
// Pure-helper coverage for owned-mode app default-mapping materialization
// (step-11 gap 2). The DB orchestration in `createConnectorFromAppCatalog` has no
// vitest harness; these cover the ref-binding logic that's easy to get wrong.

import type { CatalogDataConnector } from '@auxx/database'
import { describe, expect, it } from 'vitest'
import {
  appRelationshipFieldKey,
  buildAppOwnedFieldMappings,
  buildReferenceAnchor,
  type OwnedFieldEntry,
  ownedParentRootPath,
  partitionOwnedFields,
  projectConnectorOwnedTargets,
  relativeSourcePath,
} from './mutations'

type CatalogField = OwnedFieldEntry['field']

const FIELDS: CatalogField[] = [
  { fieldKey: 'id', sourcePath: 'id', type: 'TEXT', name: 'GitHub ID' },
  { fieldKey: 'title', sourcePath: 'title', type: 'TEXT', name: 'Title' },
  // fieldKey differs from sourcePath — the late-bound ref keys on fieldKey,
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

describe('buildAppOwnedFieldMappings', () => {
  // Root-level fields: the subtree-relative path equals the sourcePath.
  const entries = FIELDS.map((field) => ({ field, relativeSourcePath: field.sourcePath }))

  it('emits the late-bound @app ref per field, keyed by fieldKey, no provision', () => {
    const mappings = buildAppOwnedFieldMappings(entries, 'github', 'github_issues')
    // Every declared field becomes an entry (nothing dropped — no DB ids needed yet).
    expect(mappings).toHaveLength(4)

    const author = mappings.find((m) => m.targetFieldRef?.endsWith(':author'))
    expect(author).toBeDefined()
    // The ref is `${ownedApiSlug}:@app:${appSlug}:${fieldKey}` — the fieldKey rides
    // in the ref so the install can rewrite it; it also resolves at sync time.
    expect(author?.targetFieldRef).toBe('github_issues:@app:github:author')
    // Option A carries no `provision` hint — install creates the column.
    expect(author?.provision).toBeUndefined()
    // Expression reads the relative source path, not the fieldKey.
    expect(author?.expression).toBe('{user_login}')
    expect(author?.sourceFields).toEqual({ user_login: 'user_login' })
    expect(author?.id).toBeTruthy()
  })

  it('keys a child mapping expression on the SUBTREE-relative path, not the full sourcePath', () => {
    // A `line_items[]` child: the ref keys on the stable fieldKey, but the expression
    // must read `{sku}` (the subtree is one line item), not `{line_items[].sku}`.
    const childMappings = buildAppOwnedFieldMappings(
      [
        {
          field: { fieldKey: 'sku', sourcePath: 'line_items[].sku', type: 'TEXT', name: 'SKU' },
          relativeSourcePath: 'sku',
        },
      ],
      'shopify',
      'shopify_line_items'
    )
    expect(childMappings).toHaveLength(1)
    expect(childMappings[0]?.expression).toBe('{sku}')
    expect(childMappings[0]?.sourceFields).toEqual({ sku: 'sku' })
    expect(childMappings[0]?.targetFieldRef).toBe('shopify_line_items:@app:shopify:sku')
  })
})

describe('projectConnectorOwnedTargets', () => {
  // Two streams: a products stream that OWNS the product def, and an orders stream that
  // owns the order def AND references the product def (the line→product edge).
  const catalog = {
    streams: [
      {
        key: 'products',
        defaultMappings: [
          {
            rootPath: '',
            target: {
              mode: 'owned',
              entity: { key: 'products', apiSlug: 'shopify_products', singular: 'P', plural: 'Ps' },
            },
          },
        ],
      },
      {
        key: 'orders',
        defaultMappings: [
          {
            rootPath: '',
            target: {
              mode: 'owned',
              entity: { key: 'orders', apiSlug: 'shopify_orders', singular: 'O', plural: 'Os' },
            },
          },
          // A contributing customer branch — NOT owned, must be skipped.
          { rootPath: 'customer', target: { mode: 'contributing', entityKind: 'contact' } },
          // A `reference` owned mapping pointing at the SAME product key as the products
          // stream — both must surface so onComplete binds both to the one product def.
          {
            rootPath: 'line_items[].product_id',
            linkMode: 'reference',
            target: {
              mode: 'owned',
              entity: { key: 'products', apiSlug: 'shopify_products', singular: 'P', plural: 'Ps' },
            },
          },
        ],
      },
    ],
  } as unknown as CatalogDataConnector

  const targets = projectConnectorOwnedTargets('shopify', catalog)

  it('emits one entry per owned mapping, skipping contributing branches', () => {
    expect(targets).toHaveLength(3)
    expect(targets.some((t) => t.streamKey === 'orders' && t.rootPath === 'customer')).toBe(false)
  })

  it('stamps the app:<slug>:<ownedKey> templateId + (streamKey, rootPath)', () => {
    const orders = targets.find((t) => t.ownedKey === 'orders')
    expect(orders).toEqual({
      ownedKey: 'orders',
      apiSlug: 'shopify_orders',
      streamKey: 'orders',
      rootPath: '',
      templateId: 'app:shopify:orders',
    })
  })

  it('surfaces the reference mapping under the same ownedKey as its upsert def', () => {
    const products = targets.filter((t) => t.ownedKey === 'products')
    expect(products).toHaveLength(2)
    expect(products.map((t) => `${t.streamKey}:${t.rootPath}`).sort()).toEqual([
      'orders:line_items[].product_id',
      'products:',
    ])
    // Same templateId regardless of which stream/mapping declares it.
    expect(new Set(products.map((t) => t.templateId))).toEqual(new Set(['app:shopify:products']))
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
        entity: { key: 'orders', apiSlug: 'shopify_orders', singular: 'O', plural: 'Os' },
      },
    },
    { rootPath: 'customer', target: { mode: 'contributing' as const, entityKind: 'contact' } },
    {
      rootPath: 'line_items[]',
      target: {
        mode: 'owned' as const,
        entity: { key: 'line_items', apiSlug: 'shopify_line_items', singular: 'L', plural: 'Ls' },
      },
    },
    {
      rootPath: 'line_items[].product_id',
      linkMode: 'reference' as const,
      target: {
        mode: 'owned' as const,
        entity: { key: 'products', apiSlug: 'shopify_products', singular: 'P', plural: 'Ps' },
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

describe('relativeSourcePath (nested-child rootPath relativization)', () => {
  // The seeders relativize a child mapping's payload-absolute manifest rootPath
  // against its parent's rootPath before storing it — the shape the editor + sync
  // runtime expect. Same helper that strips a field's sourcePath against its owner.
  it('strips a grandchild rootPath against its array parent', () => {
    // The product reference under line_items[]: `line_items[].product_id` must store
    // as `product_id` so it matches the relative leaf node + resolves at sync.
    expect(relativeSourcePath('line_items[].product_id', 'line_items[]')).toBe('product_id')
  })

  it('strips an object-branch child rootPath', () => {
    expect(relativeSourcePath('customer.address', 'customer')).toBe('address')
  })

  it('leaves a top-level child unchanged (parent is the root)', () => {
    // A one-level child parents to `''` → absolute == relative (accidentally correct
    // before the fix, which is why only depth-≥2 children regressed).
    expect(relativeSourcePath('line_items[]', '')).toBe('line_items[]')
    expect(relativeSourcePath('customer', '')).toBe('customer')
  })
})

describe('appRelationshipFieldKey', () => {
  it('wraps a bare manifest key in the parent-scoped @app: envelope', () => {
    // The edge field lives on the parent (line_item) def, so the leading segment is the
    // parent slug; resolution keys on `@app:<appSlug>:<key>` (the leading slug is cosmetic).
    expect(appRelationshipFieldKey('product', 'shopify', 'shopify_line_items')).toBe(
      'shopify_line_items:@app:shopify:product'
    )
  })

  it('passes null/undefined through (no edge to namespace)', () => {
    expect(appRelationshipFieldKey(null, 'shopify', 'shopify_line_items')).toBeNull()
    expect(appRelationshipFieldKey(undefined, 'shopify', 'shopify_line_items')).toBeNull()
  })

  it('never emits a bare token a ref slot could mistake for an apiSlug/field id', () => {
    const ref = appRelationshipFieldKey('lineItems', 'shopify', 'shopify_orders')!
    expect(ref).toContain(':@app:')
  })
})

describe('buildReferenceAnchor', () => {
  it('synthesizes the {source} External-ID anchor a reference edge needs', () => {
    const anchor = buildReferenceAnchor()
    // Matches the interactive linkRelationship shape exactly: target-less, the FK value
    // ({source}) IS the related record's external id.
    expect(anchor.targetFieldRef).toBeNull()
    expect(anchor.expression).toBe('{source}')
    expect(anchor.sourceFields).toEqual({})
    expect(anchor.identityRole).toEqual({ kind: 'externalId' })
    expect(anchor.id).toBeTruthy()
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
