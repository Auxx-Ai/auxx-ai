// apps/web/src/components/global/sidebar/tree/sidebar-access.test.ts

import type {
  ResolvedSidebarItem,
  ResolvedSidebarLayout,
  ResourceNavEntry,
} from '@auxx/lib/sidebar-layout/client'
import { describe, expect, it } from 'vitest'
import type { SidebarProps } from '~/constants/menu'
import {
  entityAccessFor,
  filterSidebarLayout,
  isNavEntryActive,
  isPathActive,
  type NavGates,
  resolveNavEntry,
  type SidebarAccessInput,
} from './sidebar-access'

const MENU: SidebarProps[] = [
  {
    id: 'agents',
    label: 'Agents',
    slug: 'agents',
    featureKey: 'agents',
    permissionKey: 'agents.view',
  },
  { id: 'tasks', label: 'Tasks', slug: 'tasks' },
  { id: 'chats', label: 'Chats', slug: 'kopilot/new' },
  { id: 'billing', label: 'Billing', slug: 'billing', cloudOnly: true },
  {
    id: 'resources',
    label: 'Resources',
    slug: 'resources',
    skipParentSlug: true,
    preventNavigation: true,
    items: [
      { id: 'files', label: 'Files', slug: 'files', permissionKey: 'files.view' },
      { id: 'kb', label: 'KB', slug: 'kb', featureKey: 'knowledgeBase' },
    ],
  },
]

const allow: NavGates = { hasAccess: () => true, can: () => true, selfHosted: false }

function def(id: string, extra: Partial<ResourceNavEntry> = {}): ResourceNavEntry {
  return {
    id,
    apiSlug: id,
    label: id,
    plural: `${id}s`,
    icon: 'box',
    color: 'gray',
    entityType: null,
    dataConnectorId: null,
    sidebar: 'on',
    featureKeys: null,
    ...extra,
  }
}

const nav = (navId: string, isHidden = false): ResolvedSidebarItem => ({
  kind: 'ITEM',
  key: `nav:${navId}`,
  nodeId: null,
  targetType: 'NAV',
  targetIds: { navId },
  isHidden,
})
const entity = (id: string, isHidden = false): ResolvedSidebarItem => ({
  kind: 'ITEM',
  key: `entity:${id}`,
  nodeId: null,
  targetType: 'ENTITY_DEFINITION',
  targetIds: { entityDefinitionId: id },
  isHidden,
})
const favorite = (id: string): ResolvedSidebarItem => ({
  kind: 'ITEM',
  key: id,
  nodeId: id,
  targetType: 'WORKFLOW',
  targetIds: { workflowId: 'w1' },
  isHidden: false,
})

function layout(): ResolvedSidebarLayout {
  return {
    customized: true,
    groups: [
      {
        kind: 'GROUP',
        key: 'g-work',
        nodeId: 'g-work',
        systemKey: 'workspace',
        title: 'Workspace',
        isHidden: false,
        children: [nav('agents'), nav('tasks', true), nav('unknown')],
      },
      {
        kind: 'GROUP',
        key: 'g-fav',
        nodeId: 'g-fav',
        systemKey: 'favorites',
        title: 'Favorites',
        isHidden: false,
        children: [favorite('fav1')],
      },
      {
        kind: 'GROUP',
        key: 'g-rec',
        nodeId: 'g-rec',
        systemKey: 'records',
        title: 'Records',
        isHidden: false,
        children: [
          entity('contact'),
          {
            kind: 'FOLDER',
            key: 'f-dispatch',
            nodeId: 'f-dispatch',
            title: 'Dispatch',
            isHidden: false,
            children: [entity('quote'), entity('invoice')],
          },
          {
            kind: 'FOLDER',
            key: 'f-empty',
            nodeId: 'f-empty',
            title: 'Empty',
            isHidden: false,
            children: [],
          },
        ],
      },
      {
        kind: 'GROUP',
        key: 'g-custom',
        nodeId: 'g-custom',
        systemKey: null,
        title: 'Mine',
        isHidden: true,
        children: [entity('deal')],
      },
    ],
  }
}

function input(overrides: Partial<SidebarAccessInput> = {}, gates: Partial<NavGates> = {}) {
  const defs = new Map(
    [
      def('contact'),
      def('quote', { featureKeys: ['dispatch'] }),
      def('invoice', { featureKeys: ['dispatch', 'accounting'] }),
      def('deal'),
    ].map((d) => [d.id, d])
  )
  const features = new Set(['agents', 'accounting'])
  const g = { ...allow, hasAccess: (k: string) => features.has(k), ...gates }
  return {
    showHidden: false,
    navEntry: (id: string) => resolveNavEntry(MENU, id, g),
    entity: (id: string) => entityAccessFor(id, defs, g.hasAccess, () => true),
    ...overrides,
  } satisfies SidebarAccessInput
}

const keysOf = (tree: ReturnType<typeof filterSidebarLayout>) =>
  tree.groups.map((g) => [
    g.key,
    g.children.map((c) => (c.kind === 'FOLDER' ? [c.key, c.children.map((i) => i.key)] : c.key)),
  ])

describe('resolveNavEntry', () => {
  it('applies feature, permission and self-hosted gates', () => {
    expect(resolveNavEntry(MENU, 'agents', { ...allow, hasAccess: () => false })).toBeNull()
    expect(resolveNavEntry(MENU, 'agents', { ...allow, can: () => false })).toBeNull()
    expect(resolveNavEntry(MENU, 'billing', { ...allow, selfHosted: true })).toBeNull()
    expect(resolveNavEntry(MENU, 'agents', allow)?.url).toBe('/app/agents')
    expect(resolveNavEntry(MENU, 'nope', allow)).toBeNull()
  })

  it('filters sub-items, drops an emptied collapsible, and uses the first child as its url', () => {
    const noKb = { ...allow, hasAccess: (k: string) => k !== 'knowledgeBase' }
    const entry = resolveNavEntry(MENU, 'resources', noKb)
    expect(entry?.items?.map((i) => [i.id, i.url])).toEqual([['files', '/app/files']])
    expect(entry?.url).toBe('/app/files')
    expect(resolveNavEntry(MENU, 'resources', { ...noKb, can: () => false })).toBeNull()
  })

  it('never mutates the catalog', () => {
    resolveNavEntry(MENU, 'resources', { ...allow, can: () => false })
    expect(MENU[4]?.items).toHaveLength(2)
  })
})

describe('entityAccessFor', () => {
  const defs = new Map(
    [def('quote', { featureKeys: ['dispatch', 'accounting'] })].map((d) => [d.id, d])
  )

  it('is pending until defs are known and skips deleted defs', () => {
    expect(
      entityAccessFor(
        'quote',
        null,
        () => true,
        () => true
      ).access
    ).toBe('pending')
    expect(
      entityAccessFor(
        'gone',
        defs,
        () => true,
        () => true
      ).access
    ).toBe('skip')
  })

  it('passes the any-of feature gate with one key and fails with none', () => {
    const accountingOnly = (k: string) => k === 'accounting'
    expect(entityAccessFor('quote', defs, accountingOnly, () => true).access).toBe('ok')
    expect(
      entityAccessFor(
        'quote',
        defs,
        () => false,
        () => true
      ).access
    ).toBe('skip')
  })

  it('requires def presence', () => {
    expect(
      entityAccessFor(
        'quote',
        defs,
        () => true,
        () => false
      ).access
    ).toBe('skip')
  })
})

describe('filterSidebarLayout', () => {
  it('drops inaccessible and hidden rows without touching the layout', () => {
    const source = layout()
    const tree = filterSidebarLayout(source, input())
    expect(keysOf(tree)).toEqual([
      ['g-work', ['nav:agents']],
      ['g-fav', ['fav1']],
      ['g-rec', ['entity:contact', ['f-dispatch', ['entity:invoice']], ['f-empty', []]]],
    ])
    expect(tree.hasHidden).toBe(true)
    expect(source.groups[0]?.children).toHaveLength(3)
  })

  it('restores rows in place when access returns', () => {
    const tree = filterSidebarLayout(layout(), input({}, { hasAccess: () => true }))
    expect(keysOf(tree)[2]).toEqual([
      'g-rec',
      ['entity:contact', ['f-dispatch', ['entity:quote', 'entity:invoice']], ['f-empty', []]],
    ])
  })

  it('drops a folder whose children all filtered out but keeps an empty one', () => {
    const tree = filterSidebarLayout(layout(), input({}, { hasAccess: () => false }))
    const records = tree.groups.find((g) => g.key === 'g-rec')
    expect(records?.children.map((c) => c.key)).toEqual(['entity:contact', 'f-empty'])
  })

  it('drops a non-favorites group that filtered to nothing, keeps Favorites', () => {
    const l = layout()
    l.groups[1]!.children = []
    l.groups[0]!.children = [nav('unknown')]
    const tree = filterSidebarLayout(l, input())
    expect(tree.groups.map((g) => g.key)).toEqual(['g-fav', 'g-rec'])
  })

  it('shows hidden nodes dimmed when Show hidden is on, inheriting from their group', () => {
    const tree = filterSidebarLayout(layout(), input({ showHidden: true }))
    const tasks = tree.groups[0]?.children.find((c) => c.key === 'nav:tasks')
    expect(tasks).toMatchObject({ hidden: true, ownHidden: true })
    const custom = tree.groups.find((g) => g.key === 'g-custom')
    expect(custom).toMatchObject({ hidden: true, ownHidden: true })
    expect(custom?.children[0]).toMatchObject({
      key: 'entity:deal',
      hidden: true,
      ownHidden: false,
    })
  })

  it('renders entity rows as pending while defs are unknown', () => {
    const tree = filterSidebarLayout(layout(), input({ entity: () => ({ access: 'pending' }) }))
    const records = tree.groups.find((g) => g.key === 'g-rec')
    expect(records?.children[0]).toMatchObject({ key: 'entity:contact', pending: true })
  })

  it('marks rows inside folders', () => {
    const tree = filterSidebarLayout(layout(), input())
    const folder = tree.groups[2]?.children[1]
    expect(folder?.kind === 'FOLDER' && folder.children[0]?.inFolder).toBe(true)
  })
})

describe('active matching', () => {
  it('matches on a path segment boundary', () => {
    expect(isPathActive('/app/agents', '/app/agents')).toBe(true)
    expect(isPathActive('/app/agents/abc', '/app/agents')).toBe(true)
    expect(isPathActive('/app/agents-foo', '/app/agents')).toBe(false)
  })

  it('lights a leaf on its base segment', () => {
    const chats = resolveNavEntry(MENU, 'chats', allow)!
    expect(isNavEntryActive('/app/kopilot/session-1', chats)).toBe(true)
    expect(isNavEntryActive('/app/kopilotx', chats)).toBe(false)
  })
})
