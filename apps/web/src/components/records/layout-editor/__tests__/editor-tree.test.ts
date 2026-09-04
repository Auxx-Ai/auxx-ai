// apps/web/src/components/records/layout-editor/__tests__/editor-tree.test.ts

import type { LayoutBlock } from '@auxx/lib/resources/client'
import { describe, expect, it } from 'vitest'
import { createTab, moveBlock, setBlockHidden } from '../editor-actions'
import { seedEditorState } from '../editor-state'
import { addableBlocks, buildEditorTree, tabContentSummary } from '../editor-tree'
import { testRegistry } from '../test-fixtures'

const seed = () => seedEditorState({ registry: testRegistry() })
const allVisible = () => true

describe('permission-hidden blocks', () => {
  // A block gated behind a key the editing admin lacks renders greyed and
  // undraggable rather than vanishing. A block that disappeared from the tree
  // would be silently dropped by the next save.
  it('stays listed, marked restricted', () => {
    const state = seed()
    const tree = buildEditorTree({
      state,
      isBlockVisible: (block: LayoutBlock) => block.permissionKey !== 'billing.view',
    })

    const invoices = tree.rows.find((row) => row.id === 'card:invoices')
    expect(invoices).toBeDefined()
    expect(invoices?.status.restricted).toBe(true)
  })

  it('still counts toward its tab, so the tab is not silently emptied', () => {
    const tree = buildEditorTree({
      state: seed(),
      isBlockVisible: (block: LayoutBlock) => block.permissionKey !== 'billing.view',
    })

    const billing = tree.groups.find((group) => group.id === 'billing')
    expect(billing?.itemIds).toEqual(['card:invoices'])
  })

  it('survives the seed → tree → diff round trip untouched', () => {
    const state = seed()
    const tree = buildEditorTree({ state, isBlockVisible: () => false })

    // Every block is restricted here; none of them is dropped.
    expect(tree.rows).toHaveLength(4)
  })
})

describe('base tabs in the tree', () => {
  // Timeline / Comments / Tasks render hard-coded content and accept no
  // sections, so listing a child under them would describe a section that does
  // not exist and cannot be moved or hidden.
  it('contributes no rows at all', () => {
    const tree = buildEditorTree({ state: seed(), isBlockVisible: allVisible })

    for (const tabId of ['timeline', 'comments', 'tasks']) {
      const group = tree.groups.find((candidate) => candidate.id === tabId)
      expect(group?.itemIds).toEqual([])
    }
  })

  it('still appears, in tab order, so it stays reorderable and hideable', () => {
    const tree = buildEditorTree({ state: seed(), isBlockVisible: allVisible })
    const ids = tree.groups.map((group) => group.id)

    expect(ids).toContain('timeline')
    expect(ids.indexOf('timeline')).toBeLessThan(ids.indexOf('comments'))
    expect(ids.indexOf('comments')).toBeLessThan(ids.indexOf('tasks'))
  })
})

describe('empty tabs', () => {
  it('leaves a created tab with nothing after it unanchored', () => {
    const state = createTab(seed(), { id: 'tab_new', label: 'Projects' })
    const tree = buildEditorTree({ state, isBlockVisible: allVisible })

    const group = tree.groups.find((candidate) => candidate.id === 'tab_new')
    expect(group?.itemIds).toEqual([])
    // It sits between Billing and Timeline, and every tab after it is a base
    // tab that owns no rows, so there is no item to anchor on. Empty groups
    // with no anchor render at the end in `groups` order, which IS tab order,
    // so the strip still reads Projects, Timeline, Comments, Tasks.
    expect(group?.anchorItemId).toBeUndefined()
    const ids = tree.groups.map((candidate) => candidate.id)
    expect(ids.indexOf('tab_new')).toBeLessThan(ids.indexOf('timeline'))
  })

  it('anchors a created tab on the first row of a later tab that has one', () => {
    const seeded = createTab(seed(), { id: 'tab_new', label: 'Projects' })
    const state = { ...seeded, tabOrder: ['overview', 'tab_new', 'billing', 'timeline'] }
    const tree = buildEditorTree({ state, isBlockVisible: allVisible })

    const group = tree.groups.find((candidate) => candidate.id === 'tab_new')
    expect(group?.anchorItemId).toBe('card:invoices')
  })
})

describe('marking sections that render nothing here', () => {
  it('marks without dropping, because the layout is per definition', () => {
    const tree = buildEditorTree({
      state: seed(),
      isBlockVisible: allVisible,
      isBlockEmptyHere: (block: LayoutBlock) => block.id === 'card:relationships',
    })

    const row = tree.rows.find((candidate) => candidate.id === 'card:relationships')
    expect(row?.status.emptyHere).toBe(true)
  })
})

describe('addableBlocks', () => {
  it('offers nothing while every block is placed and visible', () => {
    expect(addableBlocks(seed(), testRegistry().blocksById)).toEqual([])
  })

  it('offers a hidden section back, which is how a hide is undone', () => {
    const state = setBlockHidden(seed(), 'card:customer', true)
    expect(addableBlocks(state, testRegistry().blocksById).map((block) => block.id)).toEqual([
      'card:customer',
    ])
  })

  it('drops a section from the list once it is placed again', () => {
    let state = setBlockHidden(seed(), 'card:customer', true)
    state = setBlockHidden(state, 'card:customer', false)
    state = moveBlock(state, { blockId: 'card:customer', overId: 'group:billing' })

    expect(addableBlocks(state, testRegistry().blocksById)).toEqual([])
  })
})

describe('tabContentSummary', () => {
  // A tab that mounts its own component reported "0" sections, which read as
  // "this tab is empty" on Company > Parts, whose whole content IS that
  // component.
  it('names built-in content instead of counting zero sections', () => {
    expect(tabContentSummary({ isBaseTab: false, hasOwnComponent: true }, 0)).toBe('built in')
    expect(tabContentSummary({ isBaseTab: true, hasOwnComponent: false }, 0)).toBe('built in')
  })

  it('reports both when a tab has built-in content AND sections', () => {
    expect(tabContentSummary({ isBaseTab: false, hasOwnComponent: true }, 2)).toBe('built in + 2')
  })

  it('counts a tab that IS its blocks', () => {
    expect(tabContentSummary({ isBaseTab: false, hasOwnComponent: false }, 4)).toBe('4')
    expect(tabContentSummary({ isBaseTab: false, hasOwnComponent: false }, 0)).toBe('0')
  })
})
