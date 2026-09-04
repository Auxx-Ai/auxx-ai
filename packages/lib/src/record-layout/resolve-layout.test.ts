// packages/lib/src/record-layout/resolve-layout.test.ts

import { describe, expect, it } from 'vitest'
import { cardBlockId, DETAILS_BLOCK_ID } from '../resources/registry/block-types'
import type { RecordLayoutDelta } from './layout-delta'
import { buildRegistryLayout, flattenBlockOrder } from './registry-layout'
import { resolveRecordLayout } from './resolve-layout'
import type { ResolvedLayout } from './resolved-layout'

/** A ticket-shaped drawer registry: two before/after cards around Details. */
function ticketRegistry(extraCards: string[] = []): ResolvedLayout {
  return buildRegistryLayout({
    surface: 'drawer',
    entityType: 'ticket',
    drawerConfig: {
      entityType: 'ticket',
      additionalTabs: [{ value: 'conversation', label: 'Conversation', icon: 'mail' }],
      tabCards: {
        overview: [
          { value: 'metrics', label: 'Metrics', icon: 'gauge', position: 'before' },
          { value: 'customer', label: 'Customer', icon: 'user' },
          ...extraCards.map((value) => ({ value, label: value, icon: 'box' })),
          { value: 'relationships', label: 'Related', icon: 'ticket' },
        ],
      },
    },
  })
}

const METRICS = cardBlockId('metrics')
const CUSTOMER = cardBlockId('customer')
const RELATED = cardBlockId('relationships')

describe('resolveRecordLayout: no deltas', () => {
  it('is the registry layout unchanged', () => {
    const registry = ticketRegistry()
    const resolved = resolveRecordLayout({ registry })

    expect(resolved.tabs.map((tab) => tab.id)).toEqual([
      'overview',
      'conversation',
      'timeline',
      'comments',
      'tasks',
    ])
    expect(flattenBlockOrder(resolved)).toEqual([METRICS, DETAILS_BLOCK_ID, CUSTOMER, RELATED])
    expect(resolved.unresolvedBlockIds).toEqual([])
  })
})

describe('resolveRecordLayout: sparse layering', () => {
  it('applies only the keys the org actually touched', () => {
    const orgDelta: RecordLayoutDelta = { blockOrder: [CUSTOMER, METRICS] }
    const resolved = resolveRecordLayout({ registry: ticketRegistry(), orgDelta })

    // Customer moved above Metrics. The two untouched blocks are not frozen and
    // not appended: each is spliced in after its registry predecessor, wherever
    // that predecessor now sits. Related follows Customer, Details follows
    // Metrics.
    expect(flattenBlockOrder(resolved)).toEqual([CUSTOMER, RELATED, METRICS, DETAILS_BLOCK_ID])
  })

  it('lets the user layer win over the org layer', () => {
    const orgDelta: RecordLayoutDelta = { tabs: { order: ['conversation', 'overview'] } }
    const userDelta: RecordLayoutDelta = { tabs: { order: ['overview', 'conversation'] } }
    const resolved = resolveRecordLayout({ registry: ticketRegistry(), orgDelta, userDelta })

    expect(resolved.tabs.slice(0, 2).map((tab) => tab.id)).toEqual(['overview', 'conversation'])
  })

  it('hides a tab hidden by either layer', () => {
    const resolved = resolveRecordLayout({
      registry: ticketRegistry(),
      orgDelta: { tabs: { hidden: ['timeline'] } },
      userDelta: { tabs: { hidden: ['tasks'] } },
    })
    const hidden = resolved.tabs.filter((tab) => tab.hidden).map((tab) => tab.id)
    expect(hidden).toEqual(['timeline', 'tasks'])
  })

  it('never hides Overview, whatever the delta says', () => {
    const resolved = resolveRecordLayout({
      registry: ticketRegistry(),
      orgDelta: { tabs: { hidden: ['overview'] } },
    })
    expect(resolved.tabs.find((tab) => tab.id === 'overview')?.hidden).toBe(false)
  })
})

describe('resolveRecordLayout: a newly shipped registry block', () => {
  it('appears at its registry-anchored position, not at the end', () => {
    // The org saved a layout before `warranty` shipped between customer and
    // relationships.
    const storedOrder = [METRICS, DETAILS_BLOCK_ID, CUSTOMER, RELATED]
    const registry = ticketRegistry(['warranty'])
    const resolved = resolveRecordLayout({ registry, orgDelta: { blockOrder: storedOrder } })

    expect(flattenBlockOrder(resolved)).toEqual([
      METRICS,
      DETAILS_BLOCK_ID,
      CUSTOMER,
      cardBlockId('warranty'),
      RELATED,
    ])
  })

  it('lands on the tab it was shipped on, not on a tab a block was dragged to', () => {
    const registry = ticketRegistry(['warranty'])
    const resolved = resolveRecordLayout({
      registry,
      orgDelta: {
        // Customer was dragged onto the Conversation tab; the new Warranty card
        // must not follow it there just because it sits next to it in order.
        blocks: { [CUSTOMER]: { tab: 'conversation' } },
        blockOrder: [METRICS, DETAILS_BLOCK_ID, CUSTOMER, RELATED],
      },
    })

    const overview = resolved.tabs.find((tab) => tab.id === 'overview')
    expect(overview?.blocks.map((block) => block.id)).toEqual([
      METRICS,
      DETAILS_BLOCK_ID,
      cardBlockId('warranty'),
      RELATED,
    ])
    const conversation = resolved.tabs.find((tab) => tab.id === 'conversation')
    expect(conversation?.blocks.map((block) => block.id)).toEqual([CUSTOMER])
  })

  it('surfaces a tab that ships later rather than swallowing it', () => {
    const registry = buildRegistryLayout({
      surface: 'drawer',
      entityType: 'company',
      drawerConfig: {
        entityType: 'company',
        additionalTabs: [
          { value: 'parts', label: 'Parts', icon: 'package' },
          { value: 'billing', label: 'Billing', icon: 'credit-card' },
        ],
      },
    })
    // Saved before `billing` shipped.
    const resolved = resolveRecordLayout({
      registry,
      orgDelta: { tabs: { order: ['overview', 'parts', 'timeline', 'comments', 'tasks'] } },
    })
    expect(resolved.tabs.map((tab) => tab.id)).toEqual([
      'overview',
      'parts',
      'billing',
      'timeline',
      'comments',
      'tasks',
    ])
  })
})

describe('resolveRecordLayout: unresolved ids', () => {
  it('skips a stored id that resolves to nothing and reports it', () => {
    const resolved = resolveRecordLayout({
      registry: ticketRegistry(),
      orgDelta: {
        blockOrder: ['card:retired', CUSTOMER],
        blocks: { 'card:also-gone': { hidden: true } },
      },
    })

    expect(flattenBlockOrder(resolved)).not.toContain('card:retired')
    expect(resolved.unresolvedBlockIds).toEqual(['card:retired', 'card:also-gone'])
  })

  it('treats a created block with an invalid config as unresolved, never throws', () => {
    const resolved = resolveRecordLayout({
      registry: ticketRegistry(),
      orgDelta: {
        created: {
          'user:broken': { kind: 'records', label: 'Broken', config: { source: { kind: 'nope' } } },
        },
      },
    })

    expect(resolved.unresolvedBlockIds).toEqual(['user:broken'])
    expect(resolved.blocksById['user:broken']).toBeUndefined()
  })
})

describe('resolveRecordLayout: explicit hide', () => {
  it('keeps a hidden block hidden and out of the resolved layout', () => {
    const resolved = resolveRecordLayout({
      registry: ticketRegistry(),
      orgDelta: { blocks: { [CUSTOMER]: { hidden: true } } },
    })

    expect(flattenBlockOrder(resolved)).toEqual([METRICS, DETAILS_BLOCK_ID, RELATED])
    expect(resolved.blocksById[CUSTOMER]).toBeUndefined()
    // Not reported as unresolved: it exists, it is just hidden.
    expect(resolved.unresolvedBlockIds).toEqual([])
  })

  it('is not resurrected when the registry later reorders around it', () => {
    const registry = ticketRegistry(['warranty'])
    const resolved = resolveRecordLayout({
      registry,
      orgDelta: {
        blocks: { [CUSTOMER]: { hidden: true } },
        blockOrder: [METRICS, DETAILS_BLOCK_ID, CUSTOMER, RELATED],
      },
    })
    expect(flattenBlockOrder(resolved)).not.toContain(CUSTOMER)
  })
})

describe('resolveRecordLayout: the gate invariant', () => {
  it('ignores a delta that claims a different permissionKey on a registry card', () => {
    const registry = buildRegistryLayout({
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
              permissionKey: 'dispatch.board.view',
              recordResource: 'invoice',
            },
          ],
        },
      },
    })

    const resolved = resolveRecordLayout({
      registry,
      orgDelta: {
        blocks: {
          [cardBlockId('billing')]: {
            tab: 'overview',
            // Everything below is a capability claim and must be ignored.
            config: {
              permissionKey: 'records.view',
              recordResource: 'contact',
              featureGate: undefined,
            },
          },
        },
      },
    })

    const block = resolved.blocksById[cardBlockId('billing')]
    expect(block?.permissionKey).toBe('dispatch.board.view')
    expect(block?.recordResource).toBe('invoice')
  })

  it('strips capability keys smuggled into a created block config', () => {
    const resolved = resolveRecordLayout({
      registry: ticketRegistry(),
      orgDelta: {
        created: {
          'user:jobs': {
            kind: 'records',
            label: 'Jobs',
            config: {
              source: { kind: 'query', definition: 'work_order', hostFieldId: 'work_order:ticket' },
              permissionKey: 'admin.everything',
              featureGate: 'anything',
            },
          },
        },
      },
    })

    const block = resolved.blocksById['user:jobs']
    expect(block?.permissionKey).toBeUndefined()
    expect(block?.featureGate).toBeUndefined()
    // Derived from the definition it lists, so it cannot leak counts.
    expect(block?.recordResource).toBe('work_order')
    expect(block && 'config' in block ? block.config : undefined).toEqual({
      source: { kind: 'query', definition: 'work_order', hostFieldId: 'work_order:ticket' },
    })
  })

  it('derives recordResource for a relation-sourced created block from the caller', () => {
    const resolved = resolveRecordLayout({
      registry: ticketRegistry(),
      orgDelta: {
        created: {
          'user:projects': {
            kind: 'records',
            label: 'Projects',
            config: { source: { kind: 'relation', relationAttr: 'contact_projects' } },
          },
        },
      },
      resolveRelationTarget: (attr) => (attr === 'contact_projects' ? 'project' : undefined),
    })

    expect(resolved.blocksById['user:projects']?.recordResource).toBe('project')
  })

  it('refuses to let a created entry shadow a registry block id', () => {
    const resolved = resolveRecordLayout({
      registry: ticketRegistry(),
      orgDelta: {
        created: { [CUSTOMER]: { kind: 'fields', label: 'Not the customer card' } },
      },
    })

    expect(resolved.blocksById[CUSTOMER]?.kind).toBe('card')
    expect(resolved.blocksById[CUSTOMER]?.label).toBe('Customer')
  })
})

describe('resolveRecordLayout: created tabs and blocks', () => {
  it('renders an added tab holding a created block, positioned by that block', () => {
    const resolved = resolveRecordLayout({
      registry: ticketRegistry(),
      orgDelta: {
        tabs: { added: [{ id: 'tab:billing', label: 'Billing', icon: 'credit-card' }] },
        created: {
          'user:invoices': {
            kind: 'records',
            label: 'Invoices',
            config: { source: { kind: 'relation', relationAttr: 'ticket_invoices' } },
          },
        },
        blocks: { 'user:invoices': { tab: 'tab:billing' } },
        blockOrder: [METRICS, DETAILS_BLOCK_ID, CUSTOMER, RELATED, 'user:invoices'],
      },
    })

    const billing = resolved.tabs.find((tab) => tab.id === 'tab:billing')
    expect(billing?.isCreated).toBe(true)
    expect(billing?.hasOwnComponent).toBe(false)
    expect(billing?.blocks.map((block) => block.id)).toEqual(['user:invoices'])
    // Placed straight after the tab its preceding block lives on.
    expect(resolved.tabs.map((tab) => tab.id)).toEqual([
      'overview',
      'tab:billing',
      'conversation',
      'timeline',
      'comments',
      'tasks',
    ])
  })

  it('positions an EMPTY added tab from its anchorTabId', () => {
    const resolved = resolveRecordLayout({
      registry: ticketRegistry(),
      orgDelta: {
        tabs: {
          added: [{ id: 'tab:empty', label: 'Empty', anchorTabId: 'timeline' }],
        },
      },
    })

    expect(resolved.tabs.map((tab) => tab.id)).toEqual([
      'overview',
      'conversation',
      'tab:empty',
      'timeline',
      'comments',
      'tasks',
    ])
  })

  it('appends an empty added tab whose anchor no longer exists', () => {
    const resolved = resolveRecordLayout({
      registry: ticketRegistry(),
      orgDelta: {
        tabs: { added: [{ id: 'tab:empty', label: 'Empty', anchorTabId: 'gone' }] },
      },
    })

    expect(resolved.tabs.at(-1)?.id).toBe('tab:empty')
  })

  it('ignores anchorTabId once the tab holds a block', () => {
    const resolved = resolveRecordLayout({
      registry: ticketRegistry(),
      orgDelta: {
        tabs: { added: [{ id: 'tab:x', label: 'X', anchorTabId: 'tasks' }] },
        created: { 'user:notes': { kind: 'fields', label: 'Notes' } },
        blocks: { 'user:notes': { tab: 'tab:x' } },
        blockOrder: [METRICS, 'user:notes', DETAILS_BLOCK_ID, CUSTOMER, RELATED],
      },
    })

    // Derived from its block's neighbour (overview), not from the tasks anchor.
    expect(resolved.tabs.map((tab) => tab.id)).toEqual([
      'overview',
      'tab:x',
      'conversation',
      'timeline',
      'comments',
      'tasks',
    ])
  })
})

describe('resolveRecordLayout: placement fallbacks', () => {
  it('keeps a block whose target tab no longer exists on its registry tab', () => {
    const resolved = resolveRecordLayout({
      registry: ticketRegistry(),
      orgDelta: { blocks: { [CUSTOMER]: { tab: 'tab:deleted' } } },
    })

    const overview = resolved.tabs.find((tab) => tab.id === 'overview')
    expect(overview?.blocks.map((block) => block.id)).toContain(CUSTOMER)
  })

  it('refuses to drop a block onto a base tab', () => {
    const resolved = resolveRecordLayout({
      registry: ticketRegistry(),
      orgDelta: { blocks: { [CUSTOMER]: { tab: 'timeline' } } },
    })

    expect(resolved.tabs.find((tab) => tab.id === 'timeline')?.blocks).toEqual([])
    expect(resolved.tabs.find((tab) => tab.id === 'overview')?.blocks.map((b) => b.id)).toContain(
      CUSTOMER
    )
  })

  it('applies a position override without touching gates', () => {
    const resolved = resolveRecordLayout({
      registry: ticketRegistry(),
      orgDelta: { blocks: { [CUSTOMER]: { position: 'before' } } },
    })
    expect(resolved.blocksById[CUSTOMER]?.position).toBe('before')
  })
})
