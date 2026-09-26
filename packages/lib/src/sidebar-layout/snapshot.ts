// packages/lib/src/sidebar-layout/snapshot.ts
// Client-safe: the org default snapshot — code default, parsing, and conversions into it.

import { z } from 'zod'
import {
  DEFAULT_SIDEBAR_NAV_IDS,
  SIDEBAR_SYSTEM_GROUP_KEYS,
  SIDEBAR_SYSTEM_GROUP_TITLES,
} from './constants'
import type {
  ResolvedSidebarLayout,
  SidebarLayoutSnapshot,
  SidebarSnapshotItem,
  SidebarSnapshotNode,
} from './types'

const snapshotItemSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('NAV'), navId: z.string().min(1), isHidden: z.boolean().optional() }),
  z.object({
    type: z.literal('ENTITY_DEFINITION'),
    entityDefinitionId: z.string().min(1),
    isHidden: z.boolean().optional(),
  }),
])

const snapshotFolderSchema = z.object({
  type: z.literal('FOLDER'),
  key: z.string().min(1),
  title: z.string(),
  isHidden: z.boolean().optional(),
  children: z.array(snapshotItemSchema),
})

/** Zod schema for {@link SidebarLayoutSnapshot}. */
export const sidebarLayoutSnapshotSchema = z.object({
  version: z.literal(1),
  groups: z.array(
    z.object({
      key: z.string().min(1),
      systemKey: z.enum(SIDEBAR_SYSTEM_GROUP_KEYS).optional(),
      title: z.string(),
      isHidden: z.boolean().optional(),
      children: z.array(z.union([snapshotFolderSchema, snapshotItemSchema])),
    })
  ),
})

/** Parse a stored `sidebar.defaultLayout` value; anything malformed reads as "no org default". */
export function parseSidebarLayoutSnapshot(value: unknown): SidebarLayoutSnapshot | null {
  if (value == null) return null
  const parsed = sidebarLayoutSnapshotSchema.safeParse(value)
  return parsed.success ? (parsed.data as SidebarLayoutSnapshot) : null
}

/**
 * The app-wide default: Workspace in nav order, empty Favorites, empty Records.
 * Records is filled at resolve time by the unplaced-def append, so it tracks the org's defs.
 */
export function codeDefaultSnapshot(
  navIds: readonly string[] = DEFAULT_SIDEBAR_NAV_IDS
): SidebarLayoutSnapshot {
  return {
    version: 1,
    groups: SIDEBAR_SYSTEM_GROUP_KEYS.map((systemKey) => ({
      key: systemKey,
      systemKey,
      title: SIDEBAR_SYSTEM_GROUP_TITLES[systemKey],
      children:
        systemKey === 'workspace' ? navIds.map((navId) => ({ type: 'NAV' as const, navId })) : [],
    })),
  }
}

/**
 * Turn a resolved layout into an org snapshot. Favorite targets are dropped, and so is
 * any folder they leave empty; an intentionally empty folder survives.
 */
export function snapshotFromLayout(layout: ResolvedSidebarLayout): SidebarLayoutSnapshot {
  const toItem = (item: {
    targetType: string
    targetIds: Record<string, string>
    isHidden: boolean
  }): SidebarSnapshotItem | null => {
    const hidden = item.isHidden ? { isHidden: true } : {}
    if (item.targetType === 'NAV' && item.targetIds.navId) {
      return { type: 'NAV', navId: item.targetIds.navId, ...hidden }
    }
    if (item.targetType === 'ENTITY_DEFINITION' && item.targetIds.entityDefinitionId) {
      return {
        type: 'ENTITY_DEFINITION',
        entityDefinitionId: item.targetIds.entityDefinitionId,
        ...hidden,
      }
    }
    return null
  }

  return {
    version: 1,
    groups: layout.groups.map((group) => {
      const children: SidebarSnapshotNode[] = []
      for (const child of group.children) {
        if (child.kind === 'ITEM') {
          const item = toItem(child)
          if (item) children.push(item)
          continue
        }
        const items = child.children.map(toItem).filter((i): i is SidebarSnapshotItem => i !== null)
        if (items.length === 0 && child.children.length > 0) continue
        children.push({
          type: 'FOLDER',
          key: child.nodeId ?? child.key,
          title: child.title,
          ...(child.isHidden ? { isHidden: true } : {}),
          children: items,
        })
      }
      return {
        key: group.systemKey ?? group.nodeId ?? group.key,
        ...(group.systemKey ? { systemKey: group.systemKey } : {}),
        title: group.title,
        ...(group.isHidden ? { isHidden: true } : {}),
        children,
      }
    }),
  }
}

/** The five legacy `sidebar.entities.*` org settings (see apps/web/src/hooks/use-entity-sidebar.tsx). */
export interface LegacyEntitySidebarSettings {
  order?: unknown
  visibility?: unknown
  groupVisible?: unknown
  folders?: unknown
  folderItems?: unknown
}

/**
 * Convert the legacy org-wide Records layout into an org snapshot: Workspace from the nav
 * defaults, empty Favorites, Records from order/folders/visibility. Mirrors the tree
 * `use-entity-sidebar.tsx` builds; ids that match nothing are skipped at render.
 */
export function snapshotFromLegacyEntitySettings(
  legacy: LegacyEntitySidebarSettings,
  navIds: readonly string[] = DEFAULT_SIDEBAR_NAV_IDS
): SidebarLayoutSnapshot {
  const order = stringArray(legacy.order)
  const visibility = isRecord(legacy.visibility) ? legacy.visibility : {}
  const folders = Array.isArray(legacy.folders)
    ? legacy.folders.filter(
        (f): f is { id: string; title: string } =>
          isRecord(f) && typeof f.id === 'string' && typeof f.title === 'string'
      )
    : []
  const folderItemsRaw = isRecord(legacy.folderItems) ? legacy.folderItems : {}

  const placed = new Set<string>()
  const entityItem = (id: string): SidebarSnapshotItem => {
    placed.add(id)
    const visible = visibility[id]
    return {
      type: 'ENTITY_DEFINITION',
      entityDefinitionId: id,
      ...(typeof visible === 'boolean' ? { isHidden: !visible } : {}),
    }
  }

  const folderIds = new Set(folders.map((f) => f.id))
  const folderNodes = new Map<string, SidebarSnapshotNode>()
  for (const folder of folders) {
    if (folderNodes.has(folder.id)) continue
    const children: SidebarSnapshotItem[] = []
    for (const id of stringArray(folderItemsRaw[folder.id])) {
      if (placed.has(id) || folderIds.has(id)) continue
      children.push(entityItem(id))
    }
    folderNodes.set(folder.id, { type: 'FOLDER', key: folder.id, title: folder.title, children })
  }

  const records: SidebarSnapshotNode[] = []
  const emittedFolders = new Set<string>()
  for (const id of order) {
    const folder = folderNodes.get(id)
    if (folder) {
      if (emittedFolders.has(id)) continue
      emittedFolders.add(id)
      records.push(folder)
    } else if (!placed.has(id) && !folderIds.has(id)) {
      records.push(entityItem(id))
    }
  }
  for (const [id, folder] of folderNodes) {
    if (!emittedFolders.has(id)) records.push(folder)
  }
  // An explicit visibility on an unordered def must survive; its position was "appended" anyway.
  for (const id of Object.keys(visibility)) {
    if (!placed.has(id) && !folderIds.has(id) && typeof visibility[id] === 'boolean') {
      records.push(entityItem(id))
    }
  }

  const base = codeDefaultSnapshot(navIds)
  return {
    version: 1,
    groups: base.groups.map((group) =>
      group.systemKey === 'records'
        ? {
            ...group,
            ...(legacy.groupVisible === false ? { isHidden: true } : {}),
            children: records,
          }
        : group
    ),
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []
}
