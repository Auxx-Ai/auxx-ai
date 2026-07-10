// apps/web/src/hooks/use-entity-sidebar.tsx

import { generateId } from '@auxx/utils'
import { useCallback, useMemo, useRef, useState } from 'react'
import { useResources } from '~/components/resources/hooks'
import { useSettings } from '~/hooks/use-settings'
import { useUser } from '~/hooks/use-user'

/** Setting keys for the Records sidebar (all org-wide / admin-editable). */
const ENTITY_ORDER_SETTING_KEY = 'sidebar.entities.order'
const ENTITY_VISIBILITY_SETTING_KEY = 'sidebar.entities.visibility'
const ENTITY_GROUP_VISIBILITY_SETTING_KEY = 'sidebar.entities.groupVisible'
const ENTITY_FOLDERS_SETTING_KEY = 'sidebar.entities.folders'
const ENTITY_FOLDER_ITEMS_SETTING_KEY = 'sidebar.entities.folderItems'

/**
 * Entity types surfaced under the Dispatch workspace menu instead of Records.
 * Sidebar-only exclusion — the defs stay `isVisible: true` so kbar create/search
 * and Kopilot entity tools keep seeing them.
 */
const DISPATCH_SIDEBAR_ENTITY_TYPES = new Set(['work_order', 'service_request', 'quote', 'invoice'])

/** Processed entity with visibility metadata */
export interface ProcessedEntity {
  id: string
  apiSlug: string
  label: string
  plural: string
  icon: string
  color: string
  entityType: string | null
  isLocked: boolean
  isVisible: boolean
  href: string
  /** Set when this entity def is owned by a data connector (sync badge). */
  dataConnectorId?: string
}

/** A folder definition in the Records sidebar. */
export interface EntityFolder {
  id: string
  title: string
}

/** A node in the root sequence: either a folder or a top-level entity. */
export type EntityRootNode =
  | { nodeType: 'FOLDER'; folder: EntityFolder }
  | { nodeType: 'ENTITY'; entity: ProcessedEntity }

/** Tree shape consumed by the sidebar: root nodes + per-folder children. */
export interface EntityTree {
  rootSequence: EntityRootNode[]
  folderItems: Record<string, ProcessedEntity[]>
  folders: EntityFolder[]
}

interface UseEntitySidebarOptions {
  scope?: string
}

/**
 * Hook for the Records sidebar: org-wide folders, ordering, and visibility.
 *
 * Layout is stored entirely in org settings (no DB table) and is editable by
 * admins/owners only. Reordering/visibility/folder ops write through
 * `updateOrganizationSetting` (which enforces admin server-side and broadcasts
 * `org.settings.changed` to every member).
 */
export function useEntitySidebar({ scope = 'SIDEBAR' }: UseEntitySidebarOptions = {}) {
  const [isEditMode, setIsEditMode] = useState(false)
  const lastToggleTime = useRef<number>(0)

  const {
    getSetting,
    updateOrganizationSetting,
    isLoading: settingsLoading,
  } = useSettings({ scope })
  const { customResources, isLoading: resourcesLoading } = useResources()
  const { isAdminOrOwner } = useUser()

  // ── Typed reads ────────────────────────────────────────────────────────────
  const readOrder = useCallback(
    () => (getSetting(ENTITY_ORDER_SETTING_KEY) as string[]) || [],
    [getSetting]
  )
  const readVisibility = useCallback(
    () => (getSetting(ENTITY_VISIBILITY_SETTING_KEY) as Record<string, boolean>) || {},
    [getSetting]
  )
  const readFolders = useCallback(
    () => (getSetting(ENTITY_FOLDERS_SETTING_KEY) as EntityFolder[]) || [],
    [getSetting]
  )
  const readFolderItems = useCallback(
    () => (getSetting(ENTITY_FOLDER_ITEMS_SETTING_KEY) as Record<string, string[]>) || {},
    [getSetting]
  )

  /** Persist an org-scoped layout setting (admin only, enforced server-side). */
  const setOrg = useCallback(
    (key: string, value: unknown) => updateOrganizationSetting(key, value as never),
    [updateOrganizationSetting]
  )

  // ── Tree ─────────────────────────────────────────────────────────────────
  const tree = useMemo((): EntityTree => {
    const order = readOrder()
    const visibility = readVisibility()
    const folders = readFolders()
    const folderItemsRaw = readFolderItems()

    const baseEntities: ProcessedEntity[] = (customResources || [])
      .filter((resource) => resource.isVisible !== false)
      .filter((resource) => !DISPATCH_SIDEBAR_ENTITY_TYPES.has(resource.entityType ?? ''))
      .map((resource) => ({
        id: resource.id,
        apiSlug: resource.apiSlug,
        label: resource.label,
        plural: resource.plural,
        icon: resource.icon,
        color: resource.color,
        entityType: resource.entityType,
        isLocked: false,
        isVisible: visibility[resource.id] !== false,
        href: resource.entityType ? `/app/${resource.apiSlug}` : `/app/custom/${resource.apiSlug}`,
        dataConnectorId: resource.dataConnectorId,
      }))

    const entityMap = new Map(baseEntities.map((e) => [e.id, e]))
    const folderIds = new Set(folders.map((f) => f.id))

    // Resolve folder children, tracking which entities are claimed by a folder.
    const assigned = new Set<string>()
    const folderItems: Record<string, ProcessedEntity[]> = {}
    for (const folder of folders) {
      const ids = folderItemsRaw[folder.id] ?? []
      const resolved: ProcessedEntity[] = []
      for (const eid of ids) {
        const entity = entityMap.get(eid)
        if (entity && !assigned.has(eid)) {
          resolved.push(entity)
          assigned.add(eid)
        }
      }
      folderItems[folder.id] = resolved
    }

    // Build the root sequence from `order` (folders + root entities interleaved).
    const rootSequence: EntityRootNode[] = []
    const seenFolders = new Set<string>()
    const seenRootEntities = new Set<string>()
    for (const id of order) {
      if (folderIds.has(id)) {
        if (seenFolders.has(id)) continue
        const folder = folders.find((f) => f.id === id)
        if (folder) {
          rootSequence.push({ nodeType: 'FOLDER', folder })
          seenFolders.add(id)
        }
      } else {
        const entity = entityMap.get(id)
        if (entity && !assigned.has(id) && !seenRootEntities.has(id)) {
          rootSequence.push({ nodeType: 'ENTITY', entity })
          seenRootEntities.add(id)
        }
      }
    }
    // Append folders/entities not present in `order` (newly created).
    for (const folder of folders) {
      if (!seenFolders.has(folder.id)) {
        rootSequence.push({ nodeType: 'FOLDER', folder })
        seenFolders.add(folder.id)
      }
    }
    for (const entity of baseEntities) {
      if (!assigned.has(entity.id) && !seenRootEntities.has(entity.id)) {
        rootSequence.push({ nodeType: 'ENTITY', entity })
        seenRootEntities.add(entity.id)
      }
    }

    return { rootSequence, folderItems, folders }
  }, [customResources, readOrder, readVisibility, readFolders, readFolderItems])

  /** Group visibility setting */
  const isGroupVisible = useMemo((): boolean => {
    return getSetting(ENTITY_GROUP_VISIBILITY_SETTING_KEY) !== false
  }, [getSetting])

  // ── Edit mode ──────────────────────────────────────────────────────────────
  const toggleEditMode = useCallback(() => {
    const now = Date.now()
    if (now - lastToggleTime.current < 300) return
    lastToggleTime.current = now
    setIsEditMode((prev) => !prev)
  }, [])

  // ── Visibility ─────────────────────────────────────────────────────────────
  const updateEntityVisibility = useCallback(
    (entityId: string, isVisible: boolean) => {
      setOrg(ENTITY_VISIBILITY_SETTING_KEY, { ...readVisibility(), [entityId]: isVisible })
    },
    [readVisibility, setOrg]
  )

  const toggleGroupVisibility = useCallback(() => {
    const current = getSetting(ENTITY_GROUP_VISIBILITY_SETTING_KEY) !== false
    setOrg(ENTITY_GROUP_VISIBILITY_SETTING_KEY, !current)
  }, [getSetting, setOrg])

  // ── Ordering ───────────────────────────────────────────────────────────────
  /** Reorder the root sequence (array of folder/entity IDs). */
  const reorderRoot = useCallback(
    (orderedIds: string[]) => setOrg(ENTITY_ORDER_SETTING_KEY, orderedIds),
    [setOrg]
  )

  /** Reorder entities within a folder. */
  const reorderWithinFolder = useCallback(
    (folderId: string, orderedEntityIds: string[]) => {
      setOrg(ENTITY_FOLDER_ITEMS_SETTING_KEY, {
        ...readFolderItems(),
        [folderId]: orderedEntityIds,
      })
    },
    [readFolderItems, setOrg]
  )

  // ── Folder CRUD ────────────────────────────────────────────────────────────
  const createFolder = useCallback(
    (title: string) => {
      const id = generateId()
      setOrg(ENTITY_FOLDERS_SETTING_KEY, [...readFolders(), { id, title }])
      setOrg(ENTITY_ORDER_SETTING_KEY, [...readOrder(), id])
      return id
    },
    [readFolders, readOrder, setOrg]
  )

  const renameFolder = useCallback(
    (folderId: string, title: string) => {
      setOrg(
        ENTITY_FOLDERS_SETTING_KEY,
        readFolders().map((f) => (f.id === folderId ? { ...f, title } : f))
      )
    },
    [readFolders, setOrg]
  )

  /** Delete a folder; its entities fall back to the root (appended). */
  const deleteFolder = useCallback(
    (folderId: string) => {
      const items = readFolderItems()
      const children = items[folderId] ?? []
      const { [folderId]: _removed, ...restItems } = items
      setOrg(
        ENTITY_FOLDERS_SETTING_KEY,
        readFolders().filter((f) => f.id !== folderId)
      )
      setOrg(ENTITY_FOLDER_ITEMS_SETTING_KEY, restItems)
      setOrg(ENTITY_ORDER_SETTING_KEY, [
        ...readOrder().filter((id) => id !== folderId),
        ...children,
      ])
    },
    [readFolderItems, readFolders, readOrder, setOrg]
  )

  /**
   * Move an entity into a folder (or to the root when `folderId` is null).
   * Removes it from wherever it currently lives first.
   */
  const moveEntityToFolder = useCallback(
    (entityId: string, folderId: string | null, index?: number) => {
      const order = readOrder().filter((id) => id !== entityId)
      const items = readFolderItems()
      const nextItems: Record<string, string[]> = {}
      for (const [fid, arr] of Object.entries(items)) {
        nextItems[fid] = arr.filter((id) => id !== entityId)
      }

      if (folderId) {
        const arr = nextItems[folderId] ?? []
        arr.splice(index ?? arr.length, 0, entityId)
        nextItems[folderId] = arr
      } else {
        order.splice(index ?? order.length, 0, entityId)
      }

      setOrg(ENTITY_ORDER_SETTING_KEY, order)
      setOrg(ENTITY_FOLDER_ITEMS_SETTING_KEY, nextItems)
    },
    [readOrder, readFolderItems, setOrg]
  )

  return {
    isEditMode,
    isLoading: resourcesLoading || settingsLoading,
    canEdit: isAdminOrOwner,
    tree,
    isGroupVisible,
    toggleEditMode,
    updateEntityVisibility,
    toggleGroupVisibility,
    reorderRoot,
    reorderWithinFolder,
    createFolder,
    renameFolder,
    deleteFolder,
    moveEntityToFolder,
  }
}
