// packages/lib/src/data-connectors/async-export/restitch.test.ts
// The __parentId restitch helper: re-nest a flat, unordered bulk-export JSONL set.

import { describe, expect, it } from 'vitest'
import { restitchByParentId } from './restitch'

describe('restitchByParentId', () => {
  it('nests children under their parent (default __children key)', () => {
    const tops = restitchByParentId([
      { id: 'o1', name: 'Order 1' },
      { id: 'li1', __parentId: 'o1', title: 'Widget' },
      { id: 'li2', __parentId: 'o1', title: 'Gadget' },
    ])
    expect(tops).toEqual([
      {
        id: 'o1',
        name: 'Order 1',
        __children: [
          { id: 'li1', __parentId: 'o1', title: 'Widget' },
          { id: 'li2', __parentId: 'o1', title: 'Gadget' },
        ],
      },
    ])
  })

  it('restitches regardless of order — a child can precede its parent', () => {
    const tops = restitchByParentId([
      { id: 'li1', __parentId: 'o1', title: 'Widget' },
      { id: 'o1', name: 'Order 1' },
    ])
    expect(tops).toHaveLength(1)
    expect((tops[0]!.__children as unknown[]).length).toBe(1)
  })

  it('groups children by a provider childKey (line items vs. fulfillments)', () => {
    const childKey = (c: Record<string, unknown>) =>
      String(c.id).includes('LineItem') ? 'lineItems' : 'fulfillments'
    const tops = restitchByParentId(
      [
        { id: 'gid://shopify/Order/1' },
        { id: 'gid://shopify/LineItem/1', __parentId: 'gid://shopify/Order/1' },
        { id: 'gid://shopify/Fulfillment/1', __parentId: 'gid://shopify/Order/1' },
      ],
      { childKey }
    )
    expect(tops[0]!.lineItems).toHaveLength(1)
    expect(tops[0]!.fulfillments).toHaveLength(1)
  })

  it('nests grandchildren (multi-level) via shared references', () => {
    const tops = restitchByParentId([
      { id: 'o1' },
      { id: 'li1', __parentId: 'o1' },
      { id: 'tax1', __parentId: 'li1' }, // grandchild of the order
    ])
    const order = tops[0]!
    const lineItem = (order.__children as Record<string, unknown>[])[0]!
    expect((lineItem.__children as unknown[]).length).toBe(1)
    expect(tops).toHaveLength(1)
  })

  it('surfaces a child with a dangling parent ref as a top-level record (no data loss)', () => {
    const tops = restitchByParentId([{ id: 'o1' }, { id: 'orphan', __parentId: 'missing' }])
    expect(tops).toHaveLength(2)
    expect(tops.map((t) => t.id)).toContain('orphan')
  })

  it('ignores non-object rows', () => {
    const tops = restitchByParentId([{ id: 'o1' }, null, 42, 'nope'])
    expect(tops).toEqual([{ id: 'o1' }])
  })
})
