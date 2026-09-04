// packages/lib/src/record-layout/tab-visibility.test.ts

import { describe, expect, it } from 'vitest'
import type { LayoutBlock } from '../resources/registry/block-types'
import type { ResolvedLayoutTab } from './resolved-layout'
import {
  isTabPermitted,
  isTabVisible,
  permittedLayoutTabs,
  visibleLayoutTabs,
  visibleTabBlocks,
} from './tab-visibility'

function block(id: string, permissionKey?: string): LayoutBlock {
  return { id, kind: 'fields', label: id, permissionKey }
}

function tab(overrides: Partial<ResolvedLayoutTab> & { id: string }): ResolvedLayoutTab {
  return {
    label: overrides.id,
    isBaseTab: false,
    hideable: true,
    hasOwnComponent: false,
    blocks: [],
    hidden: false,
    isCreated: false,
    ...overrides,
  }
}

/** Only blocks without a permissionKey are visible to this viewer. */
const ctx = { isBlockVisible: (b: LayoutBlock) => !b.permissionKey }

describe('isTabVisible', () => {
  it('never renders an explicitly hidden tab', () => {
    expect(isTabVisible(tab({ id: 'x', hidden: true, blocks: [block('a')] }), ctx)).toBe(false)
  })

  it('always renders the un-hideable tab, so the strip cannot empty out', () => {
    expect(isTabVisible(tab({ id: 'overview', hideable: false }), ctx)).toBe(true)
  })

  it('always renders a base tab, whose content is hard-coded', () => {
    expect(isTabVisible(tab({ id: 'timeline', isBaseTab: true }), ctx)).toBe(true)
  })

  it('renders a tab with its own component while that component is allowed', () => {
    const conversation = tab({ id: 'conversation', hasOwnComponent: true })
    expect(isTabVisible(conversation, ctx)).toBe(true)
    expect(isTabVisible(conversation, { ...ctx, isTabAllowed: () => false })).toBe(false)
  })

  it('falls back to the blocks when a tab component is gated out', () => {
    const moved = tab({ id: 'conversation', hasOwnComponent: true, blocks: [block('a')] })
    expect(isTabVisible(moved, { ...ctx, isTabAllowed: () => false })).toBe(true)
  })

  it('hides a blocks-only tab whose every block is gated out', () => {
    // The whole point of §7: CSS hides the empty SECTIONS after they render
    // nothing, which would still leave a clickable empty tab behind.
    const billing = tab({ id: 'billing', blocks: [block('a', 'k1'), block('b', 'k2')] })
    expect(isTabVisible(billing, ctx)).toBe(false)
  })

  it('shows a blocks-only tab when one block survives', () => {
    const billing = tab({ id: 'billing', blocks: [block('a', 'k1'), block('b')] })
    expect(isTabVisible(billing, ctx)).toBe(true)
  })

  it('hides a blocks-only tab with no blocks at all', () => {
    expect(isTabVisible(tab({ id: 'empty' }), ctx)).toBe(false)
  })
})

describe('visibleLayoutTabs / visibleTabBlocks', () => {
  it('filters the layout down to what this viewer sees', () => {
    const layout = {
      tabs: [
        tab({ id: 'overview', hideable: false, blocks: [block('a'), block('b', 'k')] }),
        tab({ id: 'billing', blocks: [block('c', 'k')] }),
        tab({ id: 'timeline', isBaseTab: true }),
      ],
      blocksById: {},
      unresolvedBlockIds: [],
    }

    expect(visibleLayoutTabs(layout, ctx).map((t) => t.id)).toEqual(['overview', 'timeline'])
    expect(visibleTabBlocks(layout.tabs[0] as ResolvedLayoutTab, ctx).map((b) => b.id)).toEqual([
      'a',
    ])
  })
})

describe('isTabPermitted / permittedLayoutTabs keep hiding separate from capability', () => {
  // The drawer strip excepts the ACTIVE tab from its hidden set, so a deep link
  // into a tab the viewer hid still resolves. That only works while "hidden"
  // and "not permitted" stay two answers: folding them together turns such a
  // link into a silent redirect to Overview.
  it('permits a hidden tab the viewer could otherwise see', () => {
    const timeline = tab({ id: 'timeline', isBaseTab: true, hidden: true })
    expect(isTabVisible(timeline, ctx)).toBe(false)
    expect(isTabPermitted(timeline, ctx)).toBe(true)
  })

  it('still refuses a hidden tab the viewer could NOT see anyway', () => {
    const gated = tab({ id: 'billing', hidden: true, blocks: [block('c', 'k')] })
    expect(isTabPermitted(gated, ctx)).toBe(false)
  })

  it('keeps hidden tabs in display order so the strip can list them', () => {
    const layout = {
      tabs: [
        tab({ id: 'overview', hideable: false, blocks: [block('a')] }),
        tab({ id: 'timeline', isBaseTab: true, hidden: true }),
        tab({ id: 'gated', hidden: true, blocks: [block('c', 'k')] }),
      ],
      blocksById: {},
      unresolvedBlockIds: [],
    }

    expect(permittedLayoutTabs(layout, ctx).map((t) => t.id)).toEqual(['overview', 'timeline'])
    expect(visibleLayoutTabs(layout, ctx).map((t) => t.id)).toEqual(['overview'])
  })
})
