// packages/lib/src/sidebar-layout/resolve.ts
// Client-safe, pure: member rows + org snapshot + defs → the member's layout tree.
// See plans/sidebar/01-unified-sidebar.md §4.

import {
  compareSidebarNodes,
  DEFAULT_SIDEBAR_NAV_IDS,
  isFavoriteItem,
  isSystemGroupKey,
  SIDEBAR_SYSTEM_GROUP_KEYS,
  SIDEBAR_SYSTEM_GROUP_TITLES,
  sidebarRef,
} from './constants'
import { codeDefaultSnapshot } from './snapshot'
import type {
  ResolvedSidebarFolder,
  ResolvedSidebarGroup,
  ResolvedSidebarItem,
  ResolvedSidebarLayout,
  ResourceNavEntry,
  SidebarLayoutSnapshot,
  SidebarNodeEntity,
  SidebarSnapshotItem,
  SidebarSystemGroupKey,
} from './types'

export interface ResolveSidebarLayoutInput {
  /** Every SidebarNode row of the member. */
  nodes: readonly SidebarNodeEntity[]
  /** The org's `sidebar.defaultLayout`, already parsed. */
  snapshot: SidebarLayoutSnapshot | null
  /** Defs the org has; only `id` and `sidebar` are read. */
  resources: readonly Pick<ResourceNavEntry, 'id' | 'sidebar'>[]
  /** Override for tests; defaults to {@link DEFAULT_SIDEBAR_NAV_IDS}. */
  navIds?: readonly string[]
}

/**
 * Resolve a member's layout: their rows if they have any GROUP, else the org snapshot
 * (or the code default) with their favorites under Favorites. Unplaced nav ids append to
 * Workspace and unplaced defs (`sidebar !== 'never'`) to Records. No access filtering.
 */
export function resolveSidebarLayout(input: ResolveSidebarLayoutInput): ResolvedSidebarLayout {
  const navIds = input.navIds ?? DEFAULT_SIDEBAR_NAV_IDS
  const sidebarByDef = new Map(input.resources.map((r) => [r.id, r.sidebar]))
  const byParent = groupByParent(input.nodes)
  const customized = input.nodes.some((n) => n.nodeType === 'GROUP')

  const placedRows = new Set<string>()
  const seenNav = new Set<string>()
  const seenEntity = new Set<string>()

  /** Claim a NAV/ENTITY target once; the first occurrence wins. */
  const claim = (targetType: string | null, targetIds: Record<string, string> | null) => {
    if (targetType === 'NAV') {
      const id = targetIds?.navId
      if (!id || seenNav.has(id)) return false
      seenNav.add(id)
    } else if (targetType === 'ENTITY_DEFINITION') {
      const id = targetIds?.entityDefinitionId
      if (!id || seenEntity.has(id)) return false
      seenEntity.add(id)
    }
    return true
  }

  const rowItem = (row: SidebarNodeEntity): ResolvedSidebarItem | null => {
    if (row.nodeType !== 'ITEM' || !row.targetType || !row.targetIds) return null
    if (!claim(row.targetType, row.targetIds)) return null
    placedRows.add(row.id)
    return {
      kind: 'ITEM',
      key: row.id,
      nodeId: row.id,
      targetType: row.targetType,
      targetIds: row.targetIds,
      isHidden: row.isHidden,
    }
  }

  const rowFolder = (row: SidebarNodeEntity): ResolvedSidebarFolder => {
    placedRows.add(row.id)
    const children: ResolvedSidebarItem[] = []
    for (const child of byParent.get(row.id) ?? []) {
      const item = rowItem(child)
      if (item) children.push(item)
    }
    return {
      kind: 'FOLDER',
      key: row.id,
      nodeId: row.id,
      title: row.title ?? '',
      isHidden: row.isHidden,
      children,
    }
  }

  const rowChildren = (parentId: string): ResolvedSidebarGroup['children'] => {
    const out: ResolvedSidebarGroup['children'] = []
    for (const row of byParent.get(parentId) ?? []) {
      if (row.nodeType === 'FOLDER') out.push(rowFolder(row))
      else if (row.nodeType === 'ITEM') {
        const item = rowItem(row)
        if (item) out.push(item)
      }
    }
    return out
  }

  const snapshotItem = (item: SidebarSnapshotItem): ResolvedSidebarItem | null => {
    if (item.type === 'NAV') {
      if (!claim('NAV', { navId: item.navId })) return null
      return {
        kind: 'ITEM',
        key: sidebarRef.nav(item.navId),
        nodeId: null,
        targetType: 'NAV',
        targetIds: { navId: item.navId },
        isHidden: item.isHidden ?? false,
      }
    }
    if (!claim('ENTITY_DEFINITION', { entityDefinitionId: item.entityDefinitionId })) return null
    return {
      kind: 'ITEM',
      key: sidebarRef.entity(item.entityDefinitionId),
      nodeId: null,
      targetType: 'ENTITY_DEFINITION',
      targetIds: { entityDefinitionId: item.entityDefinitionId },
      isHidden: item.isHidden ?? sidebarByDef.get(item.entityDefinitionId) === 'off',
    }
  }

  let groups: ResolvedSidebarGroup[]
  if (customized) {
    groups = (byParent.get(null) ?? [])
      .filter((row) => row.nodeType === 'GROUP')
      .map((row) => {
        placedRows.add(row.id)
        return {
          kind: 'GROUP' as const,
          key: row.id,
          nodeId: row.id,
          systemKey: isSystemGroupKey(row.systemKey) ? row.systemKey : null,
          title: row.title ?? '',
          isHidden: row.isHidden,
          children: rowChildren(row.id),
        }
      })
  } else {
    const snapshot = input.snapshot ?? codeDefaultSnapshot(navIds)
    const seenGroups = new Set<string>()
    groups = []
    for (const group of snapshot.groups) {
      const systemKey = group.systemKey ?? null
      const key = sidebarRef.group(systemKey ?? group.key)
      if (seenGroups.has(key)) continue
      seenGroups.add(key)
      const children: ResolvedSidebarGroup['children'] = []
      for (const child of group.children) {
        if (child.type === 'FOLDER') {
          children.push({
            kind: 'FOLDER',
            key: sidebarRef.folder(child.key),
            nodeId: null,
            title: child.title,
            isHidden: child.isHidden ?? false,
            children: child.children
              .map(snapshotItem)
              .filter((i): i is ResolvedSidebarItem => i !== null),
          })
        } else {
          const item = snapshotItem(child)
          if (item) children.push(item)
        }
      }
      groups.push({
        kind: 'GROUP',
        key,
        nodeId: null,
        systemKey,
        title: group.title,
        isHidden: group.isHidden ?? false,
        children,
      })
    }
    const favorites = ensureSystemGroup(groups, 'favorites')
    for (const row of byParent.get(null) ?? []) {
      if (row.nodeType === 'FOLDER') favorites.children.push(rowFolder(row))
      else if (isFavoriteItem(row)) {
        const item = rowItem(row)
        if (item) favorites.children.push(item)
      }
    }
  }

  for (const systemKey of SIDEBAR_SYSTEM_GROUP_KEYS) ensureSystemGroup(groups, systemKey)

  // Rows the tree above didn't reach (dangling parent, wrong depth) re-home by type.
  for (const row of [...input.nodes].sort(compareSidebarNodes)) {
    if (placedRows.has(row.id) || row.nodeType === 'GROUP') continue
    if (row.nodeType === 'FOLDER') {
      if (!isPlacedUnder(row, input.nodes, placedRows))
        ensureSystemGroup(groups, 'favorites').children.push(rowFolder(row))
      continue
    }
    if (isPlacedUnder(row, input.nodes, placedRows)) continue
    const item = rowItem(row)
    if (!item) continue
    ensureSystemGroup(groups, homeGroupFor(row.targetType)).children.push(item)
  }

  const workspace = ensureSystemGroup(groups, 'workspace')
  for (const navId of navIds) {
    const item = snapshotItem({ type: 'NAV', navId })
    if (item) workspace.children.push(item)
  }
  const records = ensureSystemGroup(groups, 'records')
  for (const resource of input.resources) {
    if (resource.sidebar === 'never') continue
    const item = snapshotItem({ type: 'ENTITY_DEFINITION', entityDefinitionId: resource.id })
    if (item) records.children.push(item)
  }

  return { customized, groups }
}

/** The system group a target re-homes to when its container goes away. */
export function homeGroupFor(targetType: string | null): SidebarSystemGroupKey {
  if (targetType === 'NAV') return 'workspace'
  if (targetType === 'ENTITY_DEFINITION') return 'records'
  return 'favorites'
}

/** True when the row's parent chain is already in the tree (so the row was deliberately skipped). */
function isPlacedUnder(
  row: SidebarNodeEntity,
  nodes: readonly SidebarNodeEntity[],
  placed: ReadonlySet<string>
): boolean {
  if (!row.parentId || !placed.has(row.parentId)) return false
  const parent = nodes.find((n) => n.id === row.parentId)
  if (!parent) return false
  // An ITEM under a placed GROUP or FOLDER was rendered or deduped; a FOLDER must sit under a GROUP.
  return row.nodeType === 'ITEM' || parent.nodeType === 'GROUP'
}

function ensureSystemGroup(
  groups: ResolvedSidebarGroup[],
  systemKey: SidebarSystemGroupKey
): ResolvedSidebarGroup {
  const existing = groups.find((g) => g.systemKey === systemKey)
  if (existing) return existing
  const group: ResolvedSidebarGroup = {
    kind: 'GROUP',
    key: sidebarRef.group(systemKey),
    nodeId: null,
    systemKey,
    title: SIDEBAR_SYSTEM_GROUP_TITLES[systemKey],
    isHidden: false,
    children: [],
  }
  groups.push(group)
  return group
}

function groupByParent(
  nodes: readonly SidebarNodeEntity[]
): Map<string | null, SidebarNodeEntity[]> {
  const map = new Map<string | null, SidebarNodeEntity[]>()
  for (const node of nodes) {
    const list = map.get(node.parentId) ?? []
    list.push(node)
    map.set(node.parentId, list)
  }
  for (const list of map.values()) list.sort(compareSidebarNodes)
  return map
}
