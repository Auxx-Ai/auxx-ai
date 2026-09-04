// packages/lib/src/record-layout/registry-layout.test.ts

import { describe, expect, it } from 'vitest'
import { cardBlockId, DETAILS_BLOCK_ID } from '../resources/registry/block-types'
import { buildRegistryLayout, flattenBlockOrder } from './registry-layout'

describe('buildRegistryLayout: drawer', () => {
  it('yields Overview + base tabs with only Details for a definition with no registry entry', () => {
    const layout = buildRegistryLayout({ surface: 'drawer', entityType: 'custom_def_id' })

    expect(layout.tabs.map((tab) => tab.id)).toEqual(['overview', 'timeline', 'comments', 'tasks'])
    expect(flattenBlockOrder(layout)).toEqual([DETAILS_BLOCK_ID])
    expect(layout.unresolvedBlockIds).toEqual([])
  })

  it('makes Overview un-hideable and the trailing tabs base tabs', () => {
    const layout = buildRegistryLayout({ surface: 'drawer', entityType: 'contact' })
    const byId = new Map(layout.tabs.map((tab) => [tab.id, tab]))

    expect(byId.get('overview')?.hideable).toBe(false)
    expect(byId.get('overview')?.isBaseTab).toBe(false)
    expect(byId.get('overview')?.hasOwnComponent).toBe(false)
    for (const id of ['timeline', 'comments', 'tasks']) {
      expect(byId.get(id)?.isBaseTab).toBe(true)
      expect(byId.get(id)?.blocks).toEqual([])
    }
  })

  it('drops the Comments tab when the viewer may not see comments', () => {
    const layout = buildRegistryLayout({
      surface: 'drawer',
      entityType: 'contact',
      canViewComments: false,
    })
    expect(layout.tabs.map((tab) => tab.id)).not.toContain('comments')
  })

  it('orders Overview, additional tabs, then Timeline / Comments / Tasks', () => {
    const layout = buildRegistryLayout({
      surface: 'drawer',
      entityType: 'contact',
      drawerConfig: {
        entityType: 'contact',
        additionalTabs: [
          { value: 'tickets', label: 'Tickets', icon: 'ticket', recordResource: 'ticket' },
          { value: 'conversations', label: 'Conversations', icon: 'mail' },
        ],
      },
    })

    expect(layout.tabs.map((tab) => tab.id)).toEqual([
      'overview',
      'tickets',
      'conversations',
      'timeline',
      'comments',
      'tasks',
    ])
    expect(layout.tabs[1]?.hasOwnComponent).toBe(true)
    expect(layout.tabs[1]?.isBaseTab).toBe(false)
  })

  it('places Details between the before and after card runs', () => {
    const layout = buildRegistryLayout({
      surface: 'drawer',
      entityType: 'ticket',
      drawerConfig: {
        entityType: 'ticket',
        additionalTabs: [],
        tabCards: {
          overview: [
            { value: 'metrics', label: 'Metrics', icon: 'gauge', position: 'before' },
            { value: 'customer', label: 'Customer', icon: 'user' },
            { value: 'relationships', label: 'Related', icon: 'ticket', position: 'after' },
          ],
        },
      },
    })

    expect(flattenBlockOrder(layout)).toEqual([
      cardBlockId('metrics'),
      DETAILS_BLOCK_ID,
      cardBlockId('customer'),
      cardBlockId('relationships'),
    ])
  })

  it('carries every registry gate onto the card block verbatim', () => {
    const layout = buildRegistryLayout({
      surface: 'drawer',
      entityType: 'contact',
      drawerConfig: {
        entityType: 'contact',
        additionalTabs: [],
        tabCards: {
          overview: [
            {
              value: 'billing',
              label: 'Billing',
              icon: 'credit-card',
              position: 'after',
              permissionKey: 'dispatch.board.view',
              recordResource: 'invoice',
              fullBleed: true,
            },
          ],
        },
      },
    })

    expect(layout.blocksById[cardBlockId('billing')]).toEqual({
      id: cardBlockId('billing'),
      kind: 'card',
      cardValue: 'billing',
      label: 'Billing',
      icon: 'credit-card',
      position: 'after',
      permissionKey: 'dispatch.board.view',
      recordResource: 'invoice',
      fullBleed: true,
    })
  })

  it('places cards declared on an additional tab onto that tab', () => {
    const layout = buildRegistryLayout({
      surface: 'drawer',
      entityType: 'company',
      drawerConfig: {
        entityType: 'company',
        additionalTabs: [{ value: 'billing', label: 'Billing', icon: 'credit-card' }],
        tabCards: {
          billing: [
            { value: 'purchase-orders', label: 'Purchase orders', icon: 'receipt-text' },
            { value: 'vendor-bills', label: 'Bills', icon: 'file-text' },
          ],
        },
      },
    })

    const billing = layout.tabs.find((tab) => tab.id === 'billing')
    expect(billing?.blocks.map((block) => block.id)).toEqual([
      cardBlockId('purchase-orders'),
      cardBlockId('vendor-bills'),
    ])
  })
})

describe('buildRegistryLayout: detail', () => {
  it('turns mainTabs into tabs and leaves the sidebar alone', () => {
    const layout = buildRegistryLayout({
      surface: 'detail',
      entityType: 'ticket',
      detailConfig: {
        entityType: 'ticket',
        mainTabs: [
          { value: 'conversation', label: 'Conversation', icon: 'mail' },
          { value: 'timeline', label: 'Timeline', icon: 'clock' },
          { value: 'tasks', label: 'Tasks', icon: 'list-todo' },
        ],
        sidebarTabs: [],
        sidebarCards: [{ value: 'customer', label: 'Customer', icon: 'user' }],
      },
    })

    expect(layout.tabs.map((tab) => tab.id)).toEqual(['conversation', 'timeline', 'tasks'])
    // Sidebar cards are out of scope for the editor (§9.7): no block for them.
    expect(flattenBlockOrder(layout)).toEqual([])
    expect(layout.blocksById[cardBlockId('customer')]).toBeUndefined()
    expect(layout.tabs[0]?.hasOwnComponent).toBe(true)
    expect(layout.tabs[1]?.isBaseTab).toBe(true)
  })
})
