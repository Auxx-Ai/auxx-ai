// apps/web/src/components/records/layout-editor/__tests__/layout-diff.test.ts

import { resolveRecordLayout } from '@auxx/lib/record-layout/client'
import { describe, expect, it } from 'vitest'
import { createTab, moveBlock, moveTab, setBlockHidden, setTabHidden } from '../editor-actions'
import { seedEditorState } from '../editor-state'
import { diffEditorState } from '../layout-diff'
import { testRegistry } from '../test-fixtures'

describe('diffEditorState', () => {
  it('emits nothing at all for an untouched layout', () => {
    const registry = testRegistry()
    const state = seedEditorState({ registry })

    expect(diffEditorState({ registry, state })).toEqual({ org: {}, user: {} })
  })

  // The single biggest failure mode this editor has to avoid: a write path that
  // materializes a full layout on first edit freezes every untouched default
  // forever (`plans/view-config/layered-view-config.md` §2.1).
  it('moving one section mentions that block and no others', () => {
    const registry = testRegistry()
    const seeded = seedEditorState({ registry })

    // `card:customer` starts on Overview; drop it on the Billing tab header.
    const moved = moveBlock(seeded, { blockId: 'card:customer', overId: 'group:billing' })
    const { org, user } = diffEditorState({ registry, state: moved })

    expect(Object.keys(org.blocks ?? {})).toEqual(['card:customer'])
    expect(org.blocks?.['card:customer']).toEqual({ tab: 'billing' })
    expect(org.created).toBeUndefined()
    expect(org.tabs).toBeUndefined()
    // Placement alone already produces the staged order here, so the flat order
    // is not written down and the delta names exactly one block.
    expect(org.blockOrder).toBeUndefined()
    expect(user).toEqual({})
  })

  it('round-trips: resolving the emitted delta reproduces the staged layout', () => {
    const registry = testRegistry()
    const moved = moveBlock(seedEditorState({ registry }), {
      blockId: 'card:customer',
      overId: 'group:billing',
    })
    const { org } = diffEditorState({ registry, state: moved })

    const resolved = resolveRecordLayout({ registry, orgDelta: org })
    const billing = resolved.tabs.find((tab) => tab.id === 'billing')
    expect(billing?.blocks.map((block) => block.id)).toContain('card:customer')
    const overview = resolved.tabs.find((tab) => tab.id === 'overview')
    expect(overview?.blocks.map((block) => block.id)).not.toContain('card:customer')
  })

  it('writes the flat order only when placement alone cannot express it', () => {
    const registry = testRegistry()
    const seeded = seedEditorState({ registry })

    // A pure reorder INSIDE Overview: no tab changes, so `blocks` stays empty
    // and the order is the only thing there is to store.
    const reordered = moveBlock(seeded, {
      blockId: 'core:details',
      overId: 'card:customer',
      edge: 'before',
    })
    const { org } = diffEditorState({ registry, state: reordered })

    expect(org.blocks).toBeUndefined()
    expect(org.blockOrder?.slice(0, 2)).toEqual(['core:details', 'card:customer'])
  })

  it('records a hidden section as a hide, never as a deletion', () => {
    const registry = testRegistry()
    const hidden = setBlockHidden(seedEditorState({ registry }), 'card:customer', true)
    const { org } = diffEditorState({ registry, state: hidden })

    expect(org.blocks).toEqual({ 'card:customer': { hidden: true } })
    // The block is still in the working model, so it stays listed in the tree
    // and the hide can be undone.
    expect(hidden.tabOfBlock['card:customer']).toBe('overview')
  })

  it('carries a created tab and its block in the org layer only', () => {
    const registry = testRegistry()
    const withTab = createTab(seedEditorState({ registry }), {
      id: 'tab_new',
      label: 'Projects',
      icon: 'folder',
    })
    const moved = moveBlock(withTab, { blockId: 'card:relationships', overId: 'group:tab_new' })
    const { org, user } = diffEditorState({ registry, state: moved })

    expect(org.tabs?.added).toEqual([
      { id: 'tab_new', label: 'Projects', icon: 'folder', anchorTabId: 'timeline' },
    ])
    expect(Object.keys(org.blocks ?? {})).toEqual(['card:relationships'])
    expect(user).toEqual({})
  })
})

describe('the two scopes', () => {
  it('routes tab hiding to the PERSONAL layer and leaves the org layer empty', () => {
    const registry = testRegistry()
    const hidden = setTabHidden(seedEditorState({ registry }), 'billing', true)
    const { org, user } = diffEditorState({ registry, state: hidden })

    expect(org).toEqual({})
    expect(user).toEqual({ tabs: { hidden: ['billing'] } })
  })

  it('routes tab order to the PERSONAL layer', () => {
    const registry = testRegistry()
    const moved = moveTab(seedEditorState({ registry }), {
      tabId: 'billing',
      overId: 'overview',
      overIsGroup: true,
    })
    const { org, user } = diffEditorState({ registry, state: moved })

    expect(org).toEqual({})
    expect(user.tabs?.order?.[0]).toBe('billing')
  })

  it('routes section placement to the ORG layer and leaves the personal layer empty', () => {
    const registry = testRegistry()
    const moved = moveBlock(seedEditorState({ registry }), {
      blockId: 'card:customer',
      overId: 'group:billing',
    })
    const { org, user } = diffEditorState({ registry, state: moved })

    expect(org.blocks).toBeDefined()
    expect(user).toEqual({})
  })

  it('writes both layers when both were touched', () => {
    const registry = testRegistry()
    const staged = setTabHidden(
      moveBlock(seedEditorState({ registry }), {
        blockId: 'card:customer',
        overId: 'group:billing',
      }),
      'tasks',
      true
    )
    const { org, user } = diffEditorState({ registry, state: staged })

    expect(org.blocks).toEqual({ 'card:customer': { tab: 'billing' } })
    expect(user.tabs?.hidden).toEqual(['tasks'])
  })
})

describe('seedEditorState', () => {
  it('is a fixpoint: seeding from a delta and diffing back yields that delta', () => {
    const registry = testRegistry()
    const orgDelta = {
      blocks: { 'card:customer': { tab: 'billing' } },
      created: {},
    }
    const seeded = seedEditorState({ registry, orgDelta })

    expect(diffEditorState({ registry, state: seeded }).org).toEqual({
      blocks: { 'card:customer': { tab: 'billing' } },
    })
  })

  // The resolver drops a hidden block from its output entirely, so an editor
  // that read only the resolved layout could never list one, and an un-listable
  // block is one an admin can never un-hide.
  it('keeps an explicitly hidden block in the working model', () => {
    const registry = testRegistry()
    const seeded = seedEditorState({
      registry,
      orgDelta: { blocks: { 'card:relationships': { hidden: true } } },
    })

    expect(seeded.blocks['card:relationships']).toBeDefined()
    expect(seeded.tabOfBlock['card:relationships']).toBe('overview')
    expect(seeded.hiddenBlocks).toEqual(['card:relationships'])
  })
})
