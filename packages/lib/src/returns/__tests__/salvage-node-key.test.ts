// packages/lib/src/returns/__tests__/salvage-node-key.test.ts

/**
 * The node key is the only handle the salvage card hands back, and the write
 * paths decide "update this row" versus "create the row this node stands for"
 * purely from it. A parse that got the parent wrong would silently hang a
 * teardown row off the wrong branch, so the format is pinned here.
 */

import { describe, expect, it } from 'vitest'
import { parseSalvageNodeKey, syntheticSalvageNodeKey } from '../salvage-node-key'
import { buildSalvageTree } from '../salvage-tree'
import { ROOT_SALVAGE_KEY } from '../types'

describe('parseSalvageNodeKey', () => {
  it('reads a materialized row id', () => {
    expect(parseSalvageNodeKey('row_abc')).toEqual({ kind: 'row', rowId: 'row_abc' })
  })

  it('reads a top-level untouched node as having no parent row', () => {
    expect(parseSalvageNodeKey(`bom:${ROOT_SALVAGE_KEY}:part_1`)).toEqual({
      kind: 'bom',
      parentRowId: null,
      partId: 'part_1',
    })
  })

  it('reads a nested untouched node as hanging off its parent ROW', () => {
    expect(parseSalvageNodeKey('bom:row_parent:part_2')).toEqual({
      kind: 'bom',
      parentRowId: 'row_parent',
      partId: 'part_2',
    })
  })

  it('refuses a malformed synthetic key rather than guessing a parent', () => {
    expect(parseSalvageNodeKey('bom:')).toBeNull()
    expect(parseSalvageNodeKey('bom:root')).toBeNull()
    expect(parseSalvageNodeKey('bom:root:')).toBeNull()
    expect(parseSalvageNodeKey('')).toBeNull()
  })

  it('keeps everything after the second colon as the part id', () => {
    expect(parseSalvageNodeKey('bom:root:part:with:colons')).toEqual({
      kind: 'bom',
      parentRowId: null,
      partId: 'part:with:colons',
    })
  })

  it('round-trips what syntheticSalvageNodeKey composes', () => {
    const key = syntheticSalvageNodeKey('row_parent', 'part_9')
    expect(parseSalvageNodeKey(key)).toEqual({
      kind: 'bom',
      parentRowId: 'row_parent',
      partId: 'part_9',
    })
  })
})

describe('the keys buildSalvageTree actually emits', () => {
  /**
   * 🛑 The load-bearing one. `salvage-tree.ts` composes the synthetic key
   * inline, so this asserts the parser reads what the builder writes rather
   * than what this module believes it writes.
   */
  it('parse every key a two-level tree produces', () => {
    const graph = new Map([
      ['lift', [{ childId: 'mast', qty: 2 }]],
      ['mast', [{ childId: 'bolt', qty: 4 }]],
    ])

    const roots = buildSalvageTree({
      graph,
      rootPartId: 'lift',
      returnLineQuantity: 1,
      rows: [
        {
          id: 'row_mast',
          parentId: null,
          partId: 'mast',
          quantity: 2,
          status: 'undecided',
          salvagePercent: 100,
        },
      ],
      parts: new Map(),
    })

    const mast = roots[0]
    expect(parseSalvageNodeKey(mast?.key ?? '')).toEqual({ kind: 'row', rowId: 'row_mast' })

    const bolt = mast?.children?.[0]
    expect(parseSalvageNodeKey(bolt?.key ?? '')).toEqual({
      kind: 'bom',
      parentRowId: 'row_mast',
      partId: 'bolt',
    })
  })

  it('parses a top-level untouched node back to the return line itself', () => {
    const roots = buildSalvageTree({
      graph: new Map([['lift', [{ childId: 'mast', qty: 2 }]]]),
      rootPartId: 'lift',
      returnLineQuantity: 3,
      rows: [],
      parts: new Map(),
    })

    expect(parseSalvageNodeKey(roots[0]?.key ?? '')).toEqual({
      kind: 'bom',
      parentRowId: null,
      partId: 'mast',
    })
  })
})
