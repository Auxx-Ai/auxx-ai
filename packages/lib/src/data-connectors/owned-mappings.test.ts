// packages/lib/src/data-connectors/owned-mappings.test.ts
// Pure-helper coverage for owned-mode app mapping materialization
// (app-fields-and-entities-plan Phase 2 §4.3). The DB orchestration in
// `createConnectorFromAppCatalog` has no vitest harness; these cover the
// ref-binding logic that's easy to get wrong.

import type {
  CatalogConnectorOwnedMappingField,
  CatalogDataConnector,
  CatalogEntity,
} from '@auxx/database'
import { describe, expect, it } from 'vitest'
import {
  appRelationshipFieldKey,
  buildAppOwnedFieldMappings,
  buildReferenceAnchor,
  ownedParentRootPath,
  projectConnectorOwnedTargets,
  relativeSourcePath,
  storedRootPath,
} from './mutations'

const FIELDS: CatalogConnectorOwnedMappingField[] = [
  { key: 'id', sourcePath: 'id', type: 'TEXT', name: 'GitHub ID' },
  { key: 'title', sourcePath: 'title', type: 'TEXT', name: 'Title' },
  // key differs from sourcePath — the late-bound ref keys on `key`, the
  // projection expression keys on `sourcePath`.
  { key: 'author', sourcePath: 'user_login', type: 'TEXT', name: 'Author' },
  {
    key: 'secret',
    sourcePath: 'secret',
    type: 'TEXT',
    name: 'Secret',
    capabilities: { hidden: true },
  },
]

describe('buildAppOwnedFieldMappings', () => {
  it('emits the late-bound @app ref per field, keyed by `key`, no provision', () => {
    const mappings = buildAppOwnedFieldMappings(FIELDS, 'github', 'github_issues')
    // Every declared field becomes an entry (nothing dropped — no DB ids needed yet).
    expect(mappings).toHaveLength(4)

    const author = mappings.find((m) => m.targetFieldRef?.endsWith(':author'))
    expect(author).toBeDefined()
    // The ref is `${ownedApiSlug}:@app:${appSlug}:${key}` — the key rides in the ref
    // so the install can rewrite it; it also resolves at sync time.
    expect(author?.targetFieldRef).toBe('github_issues:@app:github:author')
    // Option A carries no `provision` hint — install creates the column.
    expect(author?.provision).toBeUndefined()
    // Expression reads the (already mapping-relative) source path, not the key.
    expect(author?.expression).toBe('{user_login}')
    expect(author?.sourceFields).toEqual({ user_login: 'user_login' })
    expect(author?.id).toBeTruthy()
  })

  it('stamps identityRole.externalId on the identity:true field, keeping its column write', () => {
    const flagged: CatalogConnectorOwnedMappingField[] = [
      {
        key: 'shopify_id',
        sourcePath: 'id',
        type: 'TEXT',
        name: 'Shopify Order ID',
        identity: true,
      },
      { key: 'name', sourcePath: 'name', type: 'TEXT', name: 'Order Name' },
    ]
    const mappings = buildAppOwnedFieldMappings(flagged, 'shopify', 'shopify_orders')
    const idEntry = mappings.find((m) => m.targetFieldRef?.endsWith(':shopify_id'))
    // The flagged field is the External ID anchor AND still writes its own column.
    expect(idEntry?.identityRole).toEqual({ kind: 'externalId' })
    expect(idEntry?.targetFieldRef).toBe('shopify_orders:@app:shopify:shopify_id')
    expect(idEntry?.expression).toBe('{id}')
    // Unflagged fields carry no identity role.
    const nameEntry = mappings.find((m) => m.targetFieldRef?.endsWith(':name'))
    expect(nameEntry?.identityRole).toBeUndefined()
  })

  it('is inert when no field is flagged (unchanged behavior)', () => {
    const mappings = buildAppOwnedFieldMappings(FIELDS, 'github', 'github_issues')
    expect(mappings.every((m) => m.identityRole === undefined)).toBe(true)
  })

  it('first-wins when two fields are flagged identity on one owned def', () => {
    const twoFlagged: CatalogConnectorOwnedMappingField[] = [
      { key: 'a', sourcePath: 'a', type: 'TEXT', name: 'A', identity: true },
      { key: 'b', sourcePath: 'b', type: 'TEXT', name: 'B', identity: true },
    ]
    const mappings = buildAppOwnedFieldMappings(twoFlagged, 'shopify', 'shopify_orders')
    const stamped = mappings.filter((m) => m.identityRole?.kind === 'externalId')
    expect(stamped).toHaveLength(1)
    expect(stamped[0]?.targetFieldRef).toBe('shopify_orders:@app:shopify:a')
  })

  it('keys a child mapping expression on the ALREADY-RELATIVE sourcePath', () => {
    // A `line_items[]` child field: the ref keys on the stable `key`, and the
    // expression reads `{sku}` because the SDK contract already declares
    // `sourcePath` relative to the mapping's own `rootPath`.
    const childMappings = buildAppOwnedFieldMappings(
      [{ key: 'sku', sourcePath: 'sku', type: 'TEXT', name: 'SKU' }],
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
        mappings: [{ rootPath: '', target: { entityKey: 'products' } }],
      },
      {
        key: 'orders',
        mappings: [
          { rootPath: '', target: { entityKey: 'orders' } },
          // A contributing customer branch — NOT owned, must be skipped.
          { rootPath: 'customer', target: { entityKind: 'contact' } },
          // The owned line-item child — parent of the product reference below.
          { rootPath: 'line_items[]', target: { entityKey: 'line_items' } },
          // A `reference` owned mapping pointing at the SAME product key as the products
          // stream — both must surface so onComplete binds both to the one product def.
          {
            rootPath: 'line_items[].product_id',
            linkMode: 'reference',
            target: { entityKey: 'products' },
          },
        ],
      },
    ],
  } as unknown as CatalogDataConnector

  const entities: CatalogEntity[] = [
    {
      key: 'products',
      apiSlug: 'shopify_products',
      singular: 'P',
      plural: 'Ps',
      primaryDisplayField: 'title',
      fields: [],
    },
    {
      key: 'orders',
      apiSlug: 'shopify_orders',
      singular: 'O',
      plural: 'Os',
      primaryDisplayField: 'name',
      fields: [],
    },
    {
      key: 'line_items',
      apiSlug: 'shopify_line_items',
      singular: 'L',
      plural: 'Ls',
      primaryDisplayField: 'sku',
      fields: [],
    },
  ]

  const targets = projectConnectorOwnedTargets('shopify', catalog, entities)

  it('emits one entry per owned mapping, skipping contributing branches', () => {
    expect(targets).toHaveLength(4)
    expect(targets.some((t) => t.streamKey === 'orders' && t.rootPath === 'customer')).toBe(false)
  })

  it('emits the STORED (parent-relative) rootPath for a nested mapping, matching the seeder', () => {
    // The seeder stores `line_items[].product_id` relativized against its parent
    // `line_items[]` as `product_id` — the binder matches `(streamKey, rootPath)` with
    // `===` against those stored rows, so the projector MUST emit the same form. The
    // absolute manifest path here would never match anything (the production bug that
    // left every product/variant reference mapping with `entityDefinitionId: NULL`).
    const ref = targets.find((t) => t.ownedKey === 'products' && t.streamKey === 'orders')
    expect(ref?.rootPath).toBe('product_id')
    // And it agrees with the seeder's own derivation, shared via `storedRootPath`.
    const ownedRootPaths = ['', 'line_items[]', 'line_items[].product_id']
    expect(storedRootPath('line_items[].product_id', ownedRootPaths)).toBe('product_id')
    // Top-level mappings are unchanged (absolute == relative).
    const line = targets.find((t) => t.ownedKey === 'line_items')
    expect(line?.rootPath).toBe('line_items[]')
  })

  it('stamps the app:<slug>:<ownedKey> templateId + (streamKey, rootPath), reading entityKey off the mapping', () => {
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
    // The reference rootPath is the STORED parent-relative form (`product_id`).
    expect(products.map((t) => `${t.streamKey}:${t.rootPath}`).sort()).toEqual([
      'orders:product_id',
      'products:',
    ])
    // Same templateId regardless of which stream/mapping declares it.
    expect(new Set(products.map((t) => t.templateId))).toEqual(new Set(['app:shopify:products']))
  })
})

describe('relativeSourcePath (nested-child rootPath relativization)', () => {
  // The seeders relativize a child mapping's payload-absolute manifest rootPath
  // against its parent's rootPath before storing it — the shape the editor + sync
  // runtime expect. (Field sourcePath relativization is no longer needed — the SDK
  // contract already declares it relative to the field's own mapping.)
  it('strips a grandchild rootPath against its array parent', () => {
    // The product reference under line_items[]: `line_items[].product_id` must store
    // as `product_id` so it matches the relative leaf node + resolves at sync.
    expect(relativeSourcePath('line_items[].product_id', 'line_items[]')).toBe('product_id')
  })

  it('strips an object-branch child rootPath', () => {
    expect(relativeSourcePath('customer.address', 'customer')).toBe('address')
  })

  it('leaves a top-level child unchanged (parent is the root)', () => {
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
