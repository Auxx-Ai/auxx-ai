// apps/web/src/components/global/sidebar/tree/sidebar-access.ts

import type {
  ResolvedSidebarFolder,
  ResolvedSidebarItem,
  ResolvedSidebarLayout,
  ResourceNavEntry,
  SidebarSystemGroupKey,
} from '@auxx/lib/sidebar-layout/client'
import type { SidebarProps } from '~/constants/menu'

/** A `SIDEBAR_MENU` entry after gating, with computed urls. */
export interface NavEntry extends Omit<SidebarProps, 'items'> {
  url: string
  items?: NavEntry[]
}

export interface NavGates {
  hasAccess: (featureKey: string) => boolean
  can: (permissionKey: string) => boolean
  selfHosted: boolean
}

/** `ok` renders, `skip` drops the row, `pending` renders a skeleton until defs load. */
export type EntityAccess = 'ok' | 'skip' | 'pending'

export interface RenderItem {
  kind: 'ITEM'
  key: string
  nodeId: string | null
  targetType: string
  targetIds: Record<string, string>
  parentKey: string
  inFolder: boolean
  /** Hidden itself or through its group/folder. */
  hidden: boolean
  /** Hidden by its own flag (gets the inline unhide button). */
  ownHidden: boolean
  nav?: NavEntry
  entity?: ResourceNavEntry
  pending?: boolean
}

export interface RenderFolder {
  kind: 'FOLDER'
  key: string
  nodeId: string | null
  title: string
  parentKey: string
  hidden: boolean
  ownHidden: boolean
  children: RenderItem[]
}

export interface RenderGroup {
  kind: 'GROUP'
  key: string
  nodeId: string | null
  systemKey: SidebarSystemGroupKey | null
  title: string
  hidden: boolean
  ownHidden: boolean
  children: (RenderFolder | RenderItem)[]
}

export interface SidebarRenderTree {
  groups: RenderGroup[]
  /** Something accessible is hidden (drives the "Show hidden" affordance). */
  hasHidden: boolean
}

export interface SidebarAccessInput {
  showHidden: boolean
  navEntry: (navId: string) => NavEntry | null
  entity: (entityDefinitionId: string) => { access: EntityAccess; def?: ResourceNavEntry }
}

function passesGates(item: SidebarProps, gates: NavGates): boolean {
  if (item.cloudOnly && gates.selfHosted) return false
  if (item.featureKey && !gates.hasAccess(item.featureKey)) return false
  if (item.permissionKey && !gates.can(item.permissionKey)) return false
  return true
}

/** Gate a `SIDEBAR_MENU` entry by id; collapsibles keep only reachable children and drop when empty. */
export function resolveNavEntry(
  menu: readonly SidebarProps[],
  navId: string,
  gates: NavGates
): NavEntry | null {
  const item = menu.find((m) => m.id === navId)
  if (!item || !passesGates(item, gates)) return null
  if (item.items?.length) {
    const items: NavEntry[] = item.items
      .filter((sub) => passesGates(sub, gates))
      .map(({ items: _nested, ...sub }) => ({
        ...sub,
        url: item.skipParentSlug ? `/app/${sub.slug}` : `/app/${item.slug}/${sub.slug}`,
      }))
    if (items.length === 0) return null
    const { items: _raw, ...rest } = item
    return { ...rest, items, url: item.url ?? items[0]!.url }
  }
  const { items: _raw, ...rest } = item
  return { ...rest, url: `/app/${item.slug}` }
}

/** Access for an ENTITY_DEFINITION row: def known, any-of feature gate, then the member's front door. */
export function entityAccessFor(
  entityDefinitionId: string,
  defs: ReadonlyMap<string, ResourceNavEntry> | null,
  hasAccess: (featureKey: string) => boolean,
  hasDefPresence: (entityDefinitionId: string) => boolean
): { access: EntityAccess; def?: ResourceNavEntry } {
  if (!defs) return { access: 'pending' }
  const def = defs.get(entityDefinitionId)
  if (!def) return { access: 'skip' }
  if (def.featureKeys?.length && !def.featureKeys.some(hasAccess)) return { access: 'skip' }
  if (!hasDefPresence(entityDefinitionId)) return { access: 'skip' }
  return { access: 'ok', def }
}

/** `pathname` is `url` or below it (segment boundary, so `/app/agents` misses `/app/agents-x`). */
export function isPathActive(pathname: string, url: string | undefined): boolean {
  if (!url) return false
  return pathname === url || pathname.startsWith(`${url}/`)
}

/** Active state for a nav entry; leaves match their base segment so `/app/kopilot/<id>` lights Chats. */
export function isNavEntryActive(pathname: string, entry: NavEntry): boolean {
  if (entry.items?.length) {
    return (
      entry.items.some((sub) => isPathActive(pathname, sub.url)) ||
      isPathActive(pathname, entry.url)
    )
  }
  const base = `/app/${entry.slug?.split('/')[0]}`
  return isPathActive(pathname, base) || pathname === entry.url
}

/** Apply access + hidden filtering to a resolved layout. Never mutates the layout. */
export function filterSidebarLayout(
  layout: ResolvedSidebarLayout,
  input: SidebarAccessInput
): SidebarRenderTree {
  let hasHidden = false
  const shown = (hidden: boolean) => {
    if (hidden) hasHidden = true
    return !hidden || input.showHidden
  }

  const toItem = (
    node: ResolvedSidebarItem,
    parentKey: string,
    parentHidden: boolean,
    inFolder: boolean
  ): RenderItem | null => {
    const base = {
      kind: 'ITEM' as const,
      key: node.key,
      nodeId: node.nodeId,
      targetType: node.targetType,
      targetIds: node.targetIds,
      parentKey,
      inFolder,
      hidden: parentHidden || node.isHidden,
      ownHidden: node.isHidden,
    }
    let extra: Partial<RenderItem> = {}
    if (node.targetType === 'NAV') {
      const nav = node.targetIds.navId ? input.navEntry(node.targetIds.navId) : null
      if (!nav) return null
      extra = { nav }
    } else if (node.targetType === 'ENTITY_DEFINITION') {
      const { access, def } = input.entity(node.targetIds.entityDefinitionId ?? '')
      if (access === 'skip') return null
      extra = access === 'pending' ? { pending: true } : { entity: def }
    }
    if (!shown(base.hidden)) return null
    return { ...base, ...extra }
  }

  const toFolder = (
    node: ResolvedSidebarFolder,
    parentKey: string,
    parentHidden: boolean
  ): RenderFolder | null => {
    const hidden = parentHidden || node.isHidden
    const children = node.children
      .map((child) => toItem(child, node.key, hidden, true))
      .filter((c): c is RenderItem => c !== null)
    // An empty folder stays (it's a drop target); one whose children all filtered out doesn't.
    if (node.children.length > 0 && children.length === 0) return null
    if (!shown(hidden)) return null
    return {
      kind: 'FOLDER',
      key: node.key,
      nodeId: node.nodeId,
      title: node.title,
      parentKey,
      hidden,
      ownHidden: node.isHidden,
      children,
    }
  }

  const groups: RenderGroup[] = []
  for (const group of layout.groups) {
    const children: RenderGroup['children'] = []
    for (const child of group.children) {
      const rendered =
        child.kind === 'FOLDER'
          ? toFolder(child, group.key, group.isHidden)
          : toItem(child, group.key, group.isHidden, false)
      if (rendered) children.push(rendered)
    }
    if (!shown(group.isHidden)) continue
    // Favorites always renders (new stars land there); other groups vanish once filtered empty.
    if (group.systemKey !== 'favorites' && group.children.length > 0 && children.length === 0) {
      continue
    }
    groups.push({
      kind: 'GROUP',
      key: group.key,
      nodeId: group.nodeId,
      systemKey: group.systemKey,
      title: group.title,
      hidden: group.isHidden,
      ownHidden: group.isHidden,
      children,
    })
  }
  return { groups, hasHidden }
}
