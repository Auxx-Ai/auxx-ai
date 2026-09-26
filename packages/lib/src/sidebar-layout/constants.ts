// packages/lib/src/sidebar-layout/constants.ts
// Client-safe constants and pure helpers for the unified sidebar.

import { FAVORITE_TARGET_TYPES, type FavoriteTargetType } from '../favorites/client'
import type { SidebarNodeEntity, SidebarSystemGroupKey } from './types'

/** System groups in their default order. */
export const SIDEBAR_SYSTEM_GROUP_KEYS = [
  'workspace',
  'favorites',
  'records',
] as const satisfies readonly SidebarSystemGroupKey[]

export const SIDEBAR_SYSTEM_GROUP_TITLES: Record<SidebarSystemGroupKey, string> = {
  workspace: 'Workspace',
  favorites: 'Favorites',
  records: 'Records',
}

/**
 * Default order of the Workspace nav items, by `SIDEBAR_MENU` id
 * (apps/web/src/constants/menu.tsx). The web catalog must carry every id here.
 */
export const DEFAULT_SIDEBAR_NAV_IDS = [
  'accounting',
  'agents',
  'calls',
  'chats',
  'dashboards',
  'dispatch',
  'examples',
  'catalog',
  'resources',
  'schedule',
  'tasks',
  'workflows',
] as const

/** Max characters in a group or folder title. */
export const SIDEBAR_TITLE_MAX = 60

/** Org setting holding the org default layout snapshot. */
export const SIDEBAR_DEFAULT_LAYOUT_SETTING_KEY = 'sidebar.defaultLayout'

/**
 * Virtual node refs name nodes that have no row yet (un-customized members, unplaced
 * items). Row ids never contain ':', so any ref with a colon is virtual.
 */
export const sidebarRef = {
  group: (key: string) => `group:${key}`,
  folder: (key: string) => `folder:${key}`,
  nav: (navId: string) => `nav:${navId}`,
  entity: (entityDefinitionId: string) => `entity:${entityDefinitionId}`,
}

export type ParsedSidebarRef =
  | { kind: 'row'; id: string }
  | { kind: 'group' | 'folder' | 'nav' | 'entity'; key: string }

/** Split a node ref into a row id or a virtual `{ kind, key }`. */
export function parseSidebarRef(ref: string): ParsedSidebarRef {
  const colon = ref.indexOf(':')
  if (colon === -1) return { kind: 'row', id: ref }
  const kind = ref.slice(0, colon)
  const key = ref.slice(colon + 1)
  if (kind === 'group' || kind === 'folder' || kind === 'nav' || kind === 'entity') {
    return { kind, key }
  }
  return { kind: 'row', id: ref }
}

export function isSystemGroupKey(key: unknown): key is SidebarSystemGroupKey {
  return (SIDEBAR_SYSTEM_GROUP_KEYS as readonly unknown[]).includes(key)
}

export function isFavoriteTargetType(targetType: unknown): targetType is FavoriteTargetType {
  return (FAVORITE_TARGET_TYPES as readonly unknown[]).includes(targetType)
}

/** A favorite-target ITEM row (as opposed to NAV / ENTITY_DEFINITION items). */
export function isFavoriteItem(node: Pick<SidebarNodeEntity, 'nodeType' | 'targetType'>): boolean {
  return node.nodeType === 'ITEM' && isFavoriteTargetType(node.targetType)
}

/** Rows counted against `FAVORITES_CAP`: favorite-target items and folders. */
export function countFavoriteBudget(
  nodes: readonly Pick<SidebarNodeEntity, 'nodeType' | 'targetType'>[]
): number {
  return nodes.filter((n) => n.nodeType === 'FOLDER' || isFavoriteItem(n)).length
}

/** Stable sibling order: `(sortOrder, id)` in byte order, matching the `C` collation. */
export function compareSidebarNodes(
  a: Pick<SidebarNodeEntity, 'sortOrder' | 'id'>,
  b: Pick<SidebarNodeEntity, 'sortOrder' | 'id'>
): number {
  if (a.sortOrder !== b.sortOrder) return a.sortOrder < b.sortOrder ? -1 : 1
  if (a.id === b.id) return 0
  return a.id < b.id ? -1 : 1
}
