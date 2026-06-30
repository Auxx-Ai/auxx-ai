// apps/web/src/components/data-connectors/ui/mapping-view.test.ts

import { describe, expect, it } from 'vitest'
import type { SourcePath } from '../hooks/use-source-paths'
import type { DraftMapping } from '../stores/connector-draft-store'
import { computeMappingView } from './mapping-view'

/** Minimal DraftMapping with just the fields computeMappingView reads. */
function mapping(m: Partial<DraftMapping> & Pick<DraftMapping, 'id' | 'rootPath'>): DraftMapping {
  return {
    parentMappingId: null,
    linkMode: 'upsert',
    targetMode: 'contributing',
    entityDefinitionId: null,
    relationshipFieldKey: null,
    fieldMappings: [],
    ...m,
  } as DraftMapping
}

function indices(rows: DraftMapping[]) {
  const byMappingId = new Map<string, DraftMapping>()
  const childrenOf = new Map<string | null, DraftMapping[]>()
  for (const m of rows) {
    byMappingId.set(m.id, m)
    const key = m.parentMappingId ?? null
    const list = childrenOf.get(key) ?? []
    list.push(m)
    childrenOf.set(key, list)
  }
  return { byMappingId, childrenOf }
}

// The Shopify order shape: order root → line_items[] (owned child) → product_id (the FK).
const SOURCE_PATHS: SourcePath[] = [
  { path: 'line_items', type: 'array', depth: 0, isBranch: true },
  { path: 'line_items[].sku', type: 'string', depth: 0, isBranch: false },
  { path: 'line_items[].product_id', type: 'integer', depth: 0, isBranch: false },
]

describe('computeMappingView — nested reference child keying', () => {
  const root = mapping({ id: 'root', rootPath: '' })
  const line = mapping({ id: 'line', rootPath: 'line_items[]', parentMappingId: 'root' })

  it('keys a RELATIVE-rootPath reference child to its leaf node (the seeding-fix contract)', () => {
    // Correctly-seeded: the product reference under line_items[] stores rootPath
    // `product_id` (parent-relative), matching the relative leaf node in this subtree.
    const product = mapping({
      id: 'prod',
      rootPath: 'product_id',
      parentMappingId: 'line',
      linkMode: 'reference',
    })
    const { byMappingId, childrenOf } = indices([root, line, product])

    const view = computeMappingView(line, SOURCE_PATHS, byMappingId, childrenOf)

    // The line subtree exposes `sku` + `product_id` as relative leaves.
    expect(view.sourceTree.map((n) => n.path).sort()).toEqual(['product_id', 'sku'])
    // The reference child renders INLINE on the product_id leaf.
    expect(view.refChildByNodePath.get('product_id')).toBe(product)
    expect(view.orphanChildren).toEqual([])
  })

  it('does NOT match an ABSOLUTE-rootPath reference child (the bug this guards against)', () => {
    // The mis-seeded shape (payload-absolute rootPath) keys on the wrong path, so it
    // never matches the relative `product_id` leaf — the inline link silently vanishes.
    const product = mapping({
      id: 'prod',
      rootPath: 'line_items[].product_id',
      parentMappingId: 'line',
      linkMode: 'reference',
    })
    const { byMappingId, childrenOf } = indices([root, line, product])

    const view = computeMappingView(line, SOURCE_PATHS, byMappingId, childrenOf)

    expect(view.refChildByNodePath.has('product_id')).toBe(false)
    expect(view.refChildByNodePath.get('line_items[].product_id')).toBe(product)
  })
})

describe('computeMappingView — entry partitioning', () => {
  const root = mapping({
    id: 'root',
    rootPath: '',
    fieldMappings: [
      // A bare-token bind on a visible leaf → renders on the leaf, not as a formula.
      { id: 'e1', targetFieldRef: 'def:name', expression: '{line_items[].sku}', sourceFields: {} },
      // A computed (non-bare) entry → a formula row.
      { id: 'e2', targetFieldRef: 'def:total', expression: '{a} + {b}', sourceFields: {} },
    ],
  })

  it('splits leaf binds from formula rows', () => {
    const { byMappingId, childrenOf } = indices([root])
    const view = computeMappingView(root, SOURCE_PATHS, byMappingId, childrenOf)

    expect([...view.sourceToEntry.keys()]).toContain('line_items[].sku')
    expect(view.formulaEntries.map((e) => e.id)).toEqual(['e2'])
  })
})
