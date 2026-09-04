// apps/web/src/components/records/layout-editor/__tests__/editor-actions.test.ts

import { describe, expect, it } from 'vitest'
import {
  addBlockToTab,
  createTab,
  deleteCreatedBlock,
  deleteCreatedTab,
  isLastVisibleBlockOfTab,
  isTabVisibilityLocked,
  moveBlock,
  moveTab,
  setBlockHidden,
  setTabHidden,
} from '../editor-actions'
import { blocksOfTab, seedEditorState } from '../editor-state'
import { testRegistry } from '../test-fixtures'

const seed = () => seedEditorState({ registry: testRegistry() })

describe('base tabs reject section drops', () => {
  it('refuses a drop on a base tab header', () => {
    const state = seed()
    const next = moveBlock(state, { blockId: 'card:customer', overId: 'group:timeline' })

    // Returned by reference: the drop was refused outright, not applied and
    // then undone.
    expect(next).toBe(state)
    expect(next.tabOfBlock['card:customer']).toBe('overview')
  })

  it('still lets a base tab be REORDERED', () => {
    const state = seed()
    const next = moveTab(state, { tabId: 'tasks', overId: 'overview', overIsGroup: true })

    expect(next.tabOrder[0]).toBe('tasks')
  })

  it('refuses to add a section to a base tab', () => {
    const state = seed()
    const block = state.blocks['card:customer']
    expect(block).toBeDefined()
    const next = addBlockToTab(state, {
      block: { ...(block as NonNullable<typeof block>), id: 'blk_new' },
      tabId: 'timeline',
    })

    expect(next).toBe(state)
  })
})

describe('the strip can never empty out', () => {
  it('locks Overview on, because it is what the surface falls back to', () => {
    const state = seed()
    expect(isTabVisibilityLocked(state, 'overview')).toBe(true)
    expect(setTabHidden(state, 'overview', true)).toBe(state)
  })

  it('locks the LAST visible tab on', () => {
    let state = seed()
    // Overview is un-hideable, so hide everything else and then try the one
    // hideable tab that is left.
    for (const tabId of ['billing', 'timeline', 'comments', 'tasks']) {
      state = setTabHidden(state, tabId, true)
    }
    expect(state.hiddenTabs).toHaveLength(4)

    // Overview is the only visible tab now, and it is locked twice over.
    expect(isTabVisibilityLocked(state, 'overview')).toBe(true)
  })

  it('locks the last visible tab even when it IS hideable', () => {
    // A layout whose first tab is hideable: drop Overview's un-hideable flag by
    // seeding a registry where every tab can be hidden.
    let state = seed()
    state = {
      ...state,
      tabs: { ...state.tabs, overview: { ...state.tabs.overview!, hideable: true } },
    }
    for (const tabId of ['overview', 'billing', 'timeline', 'comments']) {
      state = setTabHidden(state, tabId, true)
    }

    expect(state.hiddenTabs).toHaveLength(4)
    expect(isTabVisibilityLocked(state, 'tasks')).toBe(true)
    expect(setTabHidden(state, 'tasks', true)).toBe(state)
  })
})

describe('a tab whose sections are all hidden is an empty tab', () => {
  it('locks the last visible section of a tab that IS its blocks', () => {
    const state = createTab(seed(), { id: 'tab_new', label: 'Projects' })
    const moved = moveBlock(state, { blockId: 'card:customer', overId: 'group:tab_new' })

    expect(isLastVisibleBlockOfTab(moved, 'card:customer')).toBe(true)
    expect(setBlockHidden(moved, 'card:customer', true)).toBe(moved)
  })

  it('does not lock a tab that mounts a component of its own', () => {
    // `billing` is an additional registry tab, so it renders with no blocks.
    const state = seed()
    expect(blocksOfTab(state, 'billing')).toEqual(['card:invoices'])
    expect(isLastVisibleBlockOfTab(state, 'card:invoices')).toBe(false)
    expect(setBlockHidden(state, 'card:invoices', true).hiddenBlocks).toEqual(['card:invoices'])
  })
})

describe('block moves', () => {
  it('keeps every tab’s run contiguous after a cross-tab move', () => {
    const state = moveBlock(seed(), { blockId: 'card:customer', overId: 'group:billing' })

    const tabRuns = state.blockOrder.map((id) => state.tabOfBlock[id])
    const firstIndexOf = new Map<string, number>()
    tabRuns.forEach((tab, index) => {
      if (tab !== undefined && !firstIndexOf.has(tab)) firstIndexOf.set(tab, index)
    })
    for (const [tab, first] of firstIndexOf) {
      const last = tabRuns.lastIndexOf(tab)
      for (let i = first; i <= last; i++) expect(tabRuns[i]).toBe(tab)
    }
  })

  it('lands a header drop at the head of the target tab’s run', () => {
    const state = moveBlock(seed(), { blockId: 'card:customer', overId: 'group:billing' })
    expect(blocksOfTab(state, 'billing')).toEqual(['card:customer', 'card:invoices'])
  })

  it('honours the edge the insert line promised', () => {
    const after = moveBlock(seed(), {
      blockId: 'card:relationships',
      overId: 'card:customer',
      edge: 'after',
    })
    expect(blocksOfTab(after, 'overview')).toEqual([
      'card:customer',
      'card:relationships',
      'core:details',
    ])
  })
})

describe('created tabs and blocks', () => {
  it('places a new tab before the first base tab', () => {
    const state = createTab(seed(), { id: 'tab_new', label: 'Projects' })
    expect(state.tabOrder).toEqual([
      'overview',
      'billing',
      'tab_new',
      'timeline',
      'comments',
      'tasks',
    ])
    expect(state.tabs.tab_new?.anchorTabId).toBe('timeline')
  })

  it('moves a deleted tab’s sections rather than losing them', () => {
    let state = createTab(seed(), { id: 'tab_new', label: 'Projects' })
    state = moveBlock(state, { blockId: 'card:customer', overId: 'group:tab_new' })
    state = deleteCreatedTab(state, 'tab_new')

    expect(state.tabs.tab_new).toBeUndefined()
    expect(state.tabOfBlock['card:customer']).toBe('overview')
  })

  it('refuses to delete a registry tab', () => {
    const state = seed()
    expect(deleteCreatedTab(state, 'billing')).toBe(state)
  })

  it('refuses to delete a registry block, which can only be hidden', () => {
    const state = seed()
    expect(deleteCreatedBlock(state, 'card:customer')).toBe(state)
  })
})
