// apps/web/src/components/data-connectors/lib/bind-installed-owned-defs.test.ts

import { describe, expect, it } from 'vitest'
import type { FieldMapping } from '../hooks/use-stream-mutations'
import type { DraftMapping, DraftStream } from '../stores/connector-draft-store'
import {
  bindInstalledOwnedDefs,
  type InstallResultLike,
  type OwnedTargetMeta,
} from './bind-installed-owned-defs'

/** An Option-A seeded owned field mapping: a late-bound `@app:` ref, no provision. */
function ownedField(ownedApiSlug: string, fieldKey: string, srcPath: string): FieldMapping {
  return {
    id: `fm_${fieldKey}`,
    targetFieldRef: `${ownedApiSlug}:@app:shopify:${fieldKey}`,
    expression: `{${srcPath}}`,
    sourceFields: { [srcPath]: srcPath },
  }
}

function ownedMapping(over: Partial<DraftMapping>): DraftMapping {
  return {
    id: 'm',
    parentMappingId: null,
    rootPath: '',
    relationshipFieldKey: null,
    linkMode: 'upsert',
    targetMode: 'owned',
    entityDefinitionId: null,
    orphanBehavior: 'ignore',
    fieldMappings: [],
    ...over,
  }
}

function stream(id: string, streamKey: string, mappings: DraftMapping[]): DraftStream {
  return {
    id,
    streamKey,
    enabled: true,
    syncMode: 'snapshot',
    requestConfig: {},
    sourceSchema: null,
    schemaSource: null,
    recordFilter: null,
    mappings,
  }
}

const OWNED_TARGETS: OwnedTargetMeta[] = [
  {
    ownedKey: 'orders',
    apiSlug: 'shopify_orders',
    streamKey: 'orders',
    rootPath: '',
    templateId: 'app:shopify:orders',
  },
  {
    ownedKey: 'products',
    apiSlug: 'shopify_products',
    streamKey: 'products',
    rootPath: '',
    templateId: 'app:shopify:products',
  },
  // The reference mapping for the same product key, in the orders stream. Its rootPath
  // is the STORED parent-relative form (`product_id`, relativized against its
  // `line_items[]` parent) — `projectConnectorOwnedTargets` emits exactly this via
  // `storedRootPath`, matching what `seedAppOwnedMappings` writes. The absolute
  // manifest form (`line_items[].product_id`) is NEVER stored, so a target carrying it
  // would silently bind nothing (the production bug: every nested reference mapping
  // sat with `entityDefinitionId: NULL`). Projector↔seeder consistency is covered in
  // packages/lib/src/data-connectors/owned-mappings.test.ts.
  {
    ownedKey: 'products',
    apiSlug: 'shopify_products',
    streamKey: 'orders',
    rootPath: 'product_id',
    templateId: 'app:shopify:products',
  },
]

describe('bindInstalledOwnedDefs', () => {
  it('binds an owned mapping to its installed def + keeps refs late-bound', () => {
    const draftStreams = [
      stream('s_orders', 'orders', [
        ownedMapping({
          id: 'm_orders',
          fieldMappings: [
            ownedField('shopify_orders', 'name', 'name'),
            ownedField('shopify_orders', 'total', 'total_price'),
          ],
        }),
      ]),
    ]
    const result: InstallResultLike = {
      created: [
        {
          templateId: 'app:shopify:orders',
          entityDefinitionId: 'def_orders',
          apiSlug: 'shopify_orders',
        },
      ],
    }

    const bindings = bindInstalledOwnedDefs({
      appSlug: 'shopify',
      result,
      ownedTargets: OWNED_TARGETS,
      draftStreams,
    })

    const orders = bindings.find((b) => b.mappingId === 'm_orders')
    expect(orders).toBeDefined()
    expect(orders?.streamId).toBe('s_orders')
    expect(orders?.entityDefinitionId).toBe('def_orders')
    // Refs stay late-bound (resolved at sync via appFieldKey), not concretized.
    expect(orders?.fieldMappings.map((f) => f.targetFieldRef)).toEqual([
      'shopify_orders:@app:shopify:name',
      'shopify_orders:@app:shopify:total',
    ])
    // Expression / sourceFields are preserved.
    expect(orders?.fieldMappings[0]?.expression).toBe('{name}')
  })

  it('binds BOTH the upsert def mapping and a reference mapping sharing the owned key', () => {
    const draftStreams = [
      stream('s_products', 'products', [
        ownedMapping({
          id: 'm_products',
          fieldMappings: [ownedField('shopify_products', 'sku', 'sku')],
        }),
      ]),
      stream('s_orders', 'orders', [
        // The reference mapping owns no columns. Stored rootPath is PARENT-RELATIVE
        // (`product_id`), the form the seeder writes — the binder's `===` match against
        // the projected target must succeed on exactly this.
        ownedMapping({
          id: 'm_ref',
          rootPath: 'product_id',
          linkMode: 'reference',
          fieldMappings: [],
        }),
      ]),
    ]
    const result: InstallResultLike = {
      created: [
        {
          templateId: 'app:shopify:products',
          entityDefinitionId: 'def_products',
          apiSlug: 'shopify_products',
        },
      ],
    }

    const bindings = bindInstalledOwnedDefs({
      appSlug: 'shopify',
      result,
      ownedTargets: OWNED_TARGETS,
      draftStreams,
    })

    expect(bindings.map((b) => b.mappingId).sort()).toEqual(['m_products', 'm_ref'])
    const ref = bindings.find((b) => b.mappingId === 'm_ref')
    // The reference mapping gets the def but keeps its empty field list.
    expect(ref?.entityDefinitionId).toBe('def_products')
    expect(ref?.fieldMappings).toEqual([])
    const upsert = bindings.find((b) => b.mappingId === 'm_products')
    expect(upsert?.fieldMappings[0]?.targetFieldRef).toBe('shopify_products:@app:shopify:sku')
  })

  it('repoints the ref slug to the ACTUAL installed slug on a slug conflict', () => {
    const draftStreams = [
      stream('s_orders', 'orders', [
        ownedMapping({
          id: 'm_orders',
          fieldMappings: [ownedField('shopify_orders', 'name', 'name')],
        }),
      ]),
    ]
    const result: InstallResultLike = {
      // The def landed on a `-2` suffix because `shopify_orders` was taken.
      created: [
        {
          templateId: 'app:shopify:orders',
          entityDefinitionId: 'def_orders',
          apiSlug: 'shopify_orders-2',
        },
      ],
    }

    const bindings = bindInstalledOwnedDefs({
      appSlug: 'shopify',
      result,
      ownedTargets: OWNED_TARGETS,
      draftStreams,
    })
    // The slug segment is rewritten so the late-bound ref resolves to the right def.
    expect(bindings[0]?.fieldMappings[0]?.targetFieldRef).toBe('shopify_orders-2:@app:shopify:name')
  })

  it('skips owned targets whose template was not installed (deselected)', () => {
    const draftStreams = [
      stream('s_orders', 'orders', [ownedMapping({ id: 'm_orders' })]),
      stream('s_products', 'products', [ownedMapping({ id: 'm_products' })]),
    ]
    const result: InstallResultLike = {
      created: [
        {
          templateId: 'app:shopify:orders',
          entityDefinitionId: 'def_orders',
          apiSlug: 'shopify_orders',
        },
      ],
    }

    const bindings = bindInstalledOwnedDefs({
      appSlug: 'shopify',
      result,
      ownedTargets: OWNED_TARGETS,
      draftStreams,
    })
    // Only the orders def was installed → only its mapping binds.
    expect(bindings.map((b) => b.mappingId)).toEqual(['m_orders'])
  })

  it('ignores tombstoned mappings', () => {
    const draftStreams = [
      stream('s_orders', 'orders', [ownedMapping({ id: 'm_orders', _deleted: true })]),
    ]
    const result: InstallResultLike = {
      created: [
        {
          templateId: 'app:shopify:orders',
          entityDefinitionId: 'def_orders',
          apiSlug: 'shopify_orders',
        },
      ],
    }
    const bindings = bindInstalledOwnedDefs({
      appSlug: 'shopify',
      result,
      ownedTargets: OWNED_TARGETS,
      draftStreams,
    })
    expect(bindings).toEqual([])
  })
})
