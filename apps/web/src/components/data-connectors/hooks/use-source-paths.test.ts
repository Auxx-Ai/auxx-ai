// apps/web/src/components/data-connectors/hooks/use-source-paths.test.ts

import { describe, expect, it } from 'vitest'
import {
  absolutePrefix,
  flattenSourceSchema,
  joinPaths,
  leafPathsUnder,
  subtreeUnder,
} from './use-source-paths'

const SCHEMA = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    customer: {
      type: 'object',
      properties: { email: { type: 'string' }, name: { type: 'string' } },
    },
    line_items: {
      type: 'array',
      items: {
        type: 'object',
        properties: { sku: { type: 'string' }, price: { type: 'number' } },
      },
    },
  },
}

describe('flattenSourceSchema', () => {
  it('emits dotted leaf + branch paths, arrays under `[]`', () => {
    const paths = flattenSourceSchema(SCHEMA).map((p) => p.path)
    expect(paths).toContain('customer.email')
    expect(paths).toContain('line_items[].sku')
    expect(paths).toContain('line_items[].price')
  })
})

describe('leafPathsUnder', () => {
  it('returns root leaves unchanged (relative == absolute)', () => {
    const leaves = leafPathsUnder(flattenSourceSchema(SCHEMA), '').map((p) => p.path)
    expect(leaves).toContain('id')
    expect(leaves).toContain('customer.email')
    // branches are excluded
    expect(leaves).not.toContain('customer')
    expect(leaves).not.toContain('line_items')
  })

  it('strips an object rootPath prefix', () => {
    const leaves = leafPathsUnder(flattenSourceSchema(SCHEMA), 'customer').map((p) => p.path)
    expect(leaves.sort()).toEqual(['email', 'name'])
  })

  it('strips an array rootPath prefix (the `[]` segment too)', () => {
    const leaves = leafPathsUnder(flattenSourceSchema(SCHEMA), 'line_items[]').map((p) => p.path)
    expect(leaves.sort()).toEqual(['price', 'sku'])
  })

  it('flattens an array-of-objects ROOT and strips the `[]` root prefix', () => {
    // The generic-rest raw-response case: the source schema IS the array.
    const arrayRoot = {
      type: 'array',
      items: {
        type: 'object',
        properties: { id: { type: 'number' }, title: { type: 'string' } },
      },
    }
    expect(
      flattenSourceSchema(arrayRoot)
        .map((p) => p.path)
        .sort()
    ).toEqual(['[].id', '[].title'])
    const leaves = leafPathsUnder(flattenSourceSchema(arrayRoot), '[]').map((p) => p.path)
    expect(leaves.sort()).toEqual(['id', 'title'])
  })
})

describe('subtreeUnder', () => {
  it('strips the `[].` prefix for an array ROOT (matches leafPathsUnder)', () => {
    // The generic-rest array response: root mapping rootPath is `[]`. Node paths
    // must come back RELATIVE (`draft`, `draft.title`) — never `[].draft`.
    const arrayRoot = {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          draft: { type: 'object', properties: { title: { type: 'string' } } },
        },
      },
    }
    const paths = flattenSourceSchema(arrayRoot)
    expect(
      subtreeUnder(paths, '[]')
        .map((p) => p.path)
        .sort()
    ).toEqual(['draft', 'draft.title', 'id'])
  })

  it('returns object-root paths unchanged (already relative)', () => {
    const paths = flattenSourceSchema(SCHEMA)
    expect(subtreeUnder(paths, '').map((p) => p.path)).toContain('customer.email')
    expect(subtreeUnder(paths, '').map((p) => p.path)).not.toContain('[].customer.email')
  })
})

describe('joinPaths', () => {
  it('joins array + object segments, dropping empty ones', () => {
    expect(joinPaths(['[]', 'line_items[]'])).toBe('[].line_items[]')
    expect(joinPaths(['orders[]', 'line_items[]'])).toBe('orders[].line_items[]')
    expect(joinPaths(['', 'customer'])).toBe('customer')
    expect(joinPaths([])).toBe('')
  })
})

describe('absolutePrefix', () => {
  // root (`[]`) → child (`line_items[]`) → grandchild (`tax_lines[]`)
  const root = { id: 'r', rootPath: '[]', parentMappingId: null }
  const child = { id: 'c', rootPath: 'line_items[]', parentMappingId: 'r' }
  const grandchild = { id: 'g', rootPath: 'tax_lines[]', parentMappingId: 'c' }
  const byId = new Map([root, child, grandchild].map((m) => [m.id, m]))

  it('returns the root rootPath unchanged for a root mapping', () => {
    expect(absolutePrefix(root, byId)).toBe('[]')
  })

  it('concatenates parent rootPaths for nested mappings', () => {
    expect(absolutePrefix(child, byId)).toBe('[].line_items[]')
    expect(absolutePrefix(grandchild, byId)).toBe('[].line_items[].tax_lines[]')
  })

  it('slices the correct relative subtree at depth (the bug fix)', () => {
    // A deeply-nested payload: orders[] → line_items[] → { sku, price }.
    const schema = {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          line_items: {
            type: 'array',
            items: {
              type: 'object',
              properties: { sku: { type: 'string' }, price: { type: 'number' } },
            },
          },
        },
      },
    }
    const paths = flattenSourceSchema(schema)
    // The child mapping (`line_items[]`) must see `sku`/`price` RELATIVE — not an
    // empty tree, which is what indexing absolute paths by the bare rootPath gave.
    const prefix = absolutePrefix(child, byId)
    expect(
      subtreeUnder(paths, prefix)
        .map((p) => p.path)
        .sort()
    ).toEqual(['price', 'sku'])
    expect(
      leafPathsUnder(paths, prefix)
        .map((p) => p.path)
        .sort()
    ).toEqual(['price', 'sku'])
  })

  it('tolerates a broken parent chain without looping forever', () => {
    const orphan = { id: 'o', rootPath: 'x[]', parentMappingId: 'missing' }
    expect(absolutePrefix(orphan, new Map([['o', orphan]]))).toBe('x[]')
  })
})
