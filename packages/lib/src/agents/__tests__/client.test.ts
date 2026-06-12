// packages/lib/src/agents/__tests__/client.test.ts

import { describe, expect, it } from 'vitest'
import {
  buildCatalogTreeFromInstallations,
  type CachedInstalledAppLike,
  type CatalogContainerNode,
  type CatalogToolsetNode,
  type FlatToolsetCatalogEntry,
  matchesToolsetSearch,
} from '../client'

const entry = (over: Partial<FlatToolsetCatalogEntry>): FlatToolsetCatalogEntry => ({
  slug: 'auxx:entities:search',
  label: 'Search',
  fullLabel: 'Entities — Search',
  description: 'Read records',
  iconId: 'search',
  color: '',
  path: ['Auxx.ai'],
  isDefault: false,
  isPopular: false,
  implicit: false,
  tools: [],
  ...over,
})

const tool = (name: string, displayName = name) => ({ name, displayName, description: '' })

describe('matchesToolsetSearch', () => {
  const e = entry({ tools: [tool('search_entities', 'Search records')] })

  it('matches everything on an empty query', () => {
    expect(matchesToolsetSearch(e, '')).toBe(true)
    expect(matchesToolsetSearch(e, '   ')).toBe(true)
  })

  it('matches on slug, labels, description, path, and member tool names', () => {
    expect(matchesToolsetSearch(e, 'auxx:entities')).toBe(true)
    expect(matchesToolsetSearch(e, 'search')).toBe(true)
    expect(matchesToolsetSearch(e, 'Entities —')).toBe(true)
    expect(matchesToolsetSearch(e, 'read records')).toBe(true)
    expect(matchesToolsetSearch(e, 'auxx.ai')).toBe(true)
    expect(matchesToolsetSearch(e, 'search_entities')).toBe(true)
    expect(matchesToolsetSearch(e, 'Search records')).toBe(true)
  })

  it('is case-insensitive and returns false on no match', () => {
    expect(matchesToolsetSearch(e, 'ENTITIES')).toBe(true)
    expect(matchesToolsetSearch(e, 'nonsense')).toBe(false)
  })
})

describe('buildCatalogTreeFromInstallations', () => {
  const installation = (over?: Partial<CachedInstalledAppLike>): CachedInstalledAppLike => ({
    app: { id: 'shopify', title: 'Shopify', avatarUrl: null },
    agentToolsets: [
      {
        slug: 'app:shopify:orders.read',
        name: 'Orders',
        description: '',
        iconKey: null,
        subGroup: null,
      },
    ],
    agentTools: [
      {
        id: 'find_shopify_order',
        name: 'Find Shopify order',
        registeredName: 'shopify_find_shopify_order',
        description: 'Look up an order.',
        toolsetSlug: 'app:shopify:orders.read',
      },
    ],
    ...over,
  })

  it('surfaces the registered name as the catalog `name`, manifest id as the displayName label', () => {
    const tree = buildCatalogTreeFromInstallations([installation()])
    const app = tree.find((n) => n.id === 'app:shopify') as CatalogContainerNode
    const toolset = app.children[0] as CatalogToolsetNode
    expect(toolset.implicit).toBe(false)
    const [node] = toolset.children
    expect(node.kind).toBe('tool')
    expect(node.name).toBe('shopify_find_shopify_order')
    expect(node.label).toBe('Find Shopify order')
    expect(node.toolsetSlug).toBe('app:shopify:orders.read')
  })

  it('lands ungrouped tools in the synthesized implicit toolset (app:<appId>)', () => {
    const tree = buildCatalogTreeFromInstallations([
      installation({
        agentTools: [
          {
            id: 'find_shopify_order',
            name: 'Find Shopify order',
            registeredName: 'shopify_find_shopify_order',
            description: 'Look up an order.',
            toolsetSlug: 'app:shopify:orders.read',
          },
          {
            id: 'cancel_shopify_order',
            name: 'Cancel Shopify order',
            registeredName: 'shopify_cancel_shopify_order',
            description: 'Cancel an order.',
            // no toolsetSlug — grouping is optional
          },
        ],
      }),
    ])
    const app = tree.find((n) => n.id === 'app:shopify') as CatalogContainerNode
    const leaves = app.children.filter((c): c is CatalogToolsetNode => c.kind === 'toolset')
    const implicit = leaves.find((l) => l.implicit)
    const explicit = leaves.find((l) => !l.implicit)
    expect(explicit?.slug).toBe('app:shopify:orders.read')
    expect(implicit?.slug).toBe('app:shopify')
    expect(implicit?.children.map((t) => t.name)).toEqual(['shopify_cancel_shopify_order'])
  })

  it('builds an app node from bare tools alone (no declared toolsets)', () => {
    const tree = buildCatalogTreeFromInstallations([
      installation({
        agentToolsets: [],
        agentTools: [
          {
            id: 'find_shopify_order',
            name: 'Find Shopify order',
            registeredName: 'shopify_find_shopify_order',
            description: 'Look up an order.',
          },
        ],
      }),
    ])
    const app = tree.find((n) => n.id === 'app:shopify') as CatalogContainerNode
    expect(app).toBeDefined()
    const [leaf] = app.children
    expect(leaf.kind).toBe('toolset')
    expect((leaf as CatalogToolsetNode).implicit).toBe(true)
  })
})
