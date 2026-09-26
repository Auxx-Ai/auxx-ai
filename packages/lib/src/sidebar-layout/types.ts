// packages/lib/src/sidebar-layout/types.ts
// Client-safe types for the unified sidebar. See plans/sidebar/01-unified-sidebar.md.

import type { FavoriteTargetType } from '../favorites/client'

export type SidebarNodeType = 'GROUP' | 'FOLDER' | 'ITEM'

export type SidebarSystemGroupKey = 'workspace' | 'favorites' | 'records'

/** Item target types owned by the layout (as opposed to favorite targets). */
export type SidebarLayoutTargetType = 'NAV' | 'ENTITY_DEFINITION'

export type SidebarTargetType = FavoriteTargetType | SidebarLayoutTargetType

export interface SidebarLayoutTargetIdsMap {
  NAV: { navId: string }
  ENTITY_DEFINITION: { entityDefinitionId: string }
}

/** A `SidebarNode` row, JSON-serializable (dates as ISO strings). */
export interface SidebarNodeEntity {
  id: string
  organizationId: string
  organizationMemberId: string
  userId: string
  nodeType: SidebarNodeType
  title: string | null
  systemKey: SidebarSystemGroupKey | null
  targetType: string | null
  targetIds: Record<string, string> | null
  parentId: string | null
  sortOrder: string
  isHidden: boolean
  createdAt: string
  updatedAt: string
}

/** Org default layout, stored in the `sidebar.defaultLayout` org setting. Never holds favorites. */
export interface SidebarLayoutSnapshot {
  version: 1
  groups: SidebarSnapshotGroup[]
}

export interface SidebarSnapshotGroup {
  /** systemKey for system groups, otherwise any id unique within the snapshot. */
  key: string
  systemKey?: SidebarSystemGroupKey
  title: string
  isHidden?: boolean
  children: SidebarSnapshotNode[]
}

export type SidebarSnapshotItem =
  | { type: 'NAV'; navId: string; isHidden?: boolean }
  | { type: 'ENTITY_DEFINITION'; entityDefinitionId: string; isHidden?: boolean }

export type SidebarSnapshotNode =
  | {
      type: 'FOLDER'
      key: string
      title: string
      isHidden?: boolean
      children: SidebarSnapshotItem[]
    }
  | SidebarSnapshotItem

/** Slim per-def projection the sidebar renders ENTITY_DEFINITION rows from (org cache `resourceNav`). */
export interface ResourceNavEntry {
  /** EntityDefinition id. */
  id: string
  apiSlug: string
  label: string
  plural: string
  icon: string
  color: string
  entityType: string | null
  dataConnectorId: string | null
  sidebar: 'on' | 'off' | 'never'
  /** Any-of feature gate; null = ungated. */
  featureKeys: string[] | null
}

/** A resolved item. `key` is the row id, or a virtual ref (`nav:…`, `entity:…`) when no row exists. */
export interface ResolvedSidebarItem {
  kind: 'ITEM'
  key: string
  nodeId: string | null
  targetType: string
  targetIds: Record<string, string>
  isHidden: boolean
}

export interface ResolvedSidebarFolder {
  kind: 'FOLDER'
  key: string
  nodeId: string | null
  title: string
  isHidden: boolean
  children: ResolvedSidebarItem[]
}

export interface ResolvedSidebarGroup {
  kind: 'GROUP'
  key: string
  nodeId: string | null
  systemKey: SidebarSystemGroupKey | null
  title: string
  isHidden: boolean
  children: (ResolvedSidebarFolder | ResolvedSidebarItem)[]
}

/** The member's full layout before access filtering; hidden nodes included. */
export interface ResolvedSidebarLayout {
  /** True once the member has their own GROUP rows. */
  customized: boolean
  groups: ResolvedSidebarGroup[]
}

/** What layout mutations return: the member's full node list after the write. */
export interface SidebarMutationResult {
  nodes: SidebarNodeEntity[]
  /** Row id of the node the mutation created or moved, when there is one. */
  nodeId: string | null
  /** Virtual ref → row id for nodes this write materialized; `folder:`/custom `group:` refs resolve only through it. */
  refs: Record<string, string>
}

/** Dehydrated `sidebar` payload for the active org. */
export interface DehydratedSidebar {
  nodes: SidebarNodeEntity[]
  /** Absent when the org cache read failed; render placed rows as skeletons then. */
  resourceNav?: ResourceNavEntry[]
}
