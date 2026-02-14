// apps/web/src/hooks/use-entity-sidebar.tsx

import type { CustomResource } from '@auxx/lib/resources/client'
import { useCallback, useMemo, useRef, useState } from 'react'
import { useResources } from '~/components/resources/hooks'
import { useSettings } from '~/hooks/use-settings'

/** Setting keys for entity sidebar */
const ENTITY_ORDER_SETTING_KEY = 'sidebar.entities.order'
const ENTITY_VISIBILITY_SETTING_KEY = 'sidebar.entities.visibility'
const ENTITY_GROUP_VISIBILITY_SETTING_KEY = 'sidebar.entities.groupVisible'

/** Static entity definition for Support Tickets */
const STATIC_TICKETS_ENTITY: ProcessedEntity = {
  id: 'tickets',
  apiSlug: 'tickets',
  label: 'Support Tickets',
  plural: 'Support Tickets',
  icon: 'tags',
  color: 'gray',
  entityType: null,
  isStatic: true,
  isLocked: true,
  isVisible: true,
  href: '/app/tickets',
}

/** Processed entity with visibility and ordering metadata */
export interface ProcessedEntity {
  id: string
  apiSlug: string
  label: string
  plural: string
  icon: string
  color: string
  entityType: string | null
  isStatic: boolean
  isLocked: boolean
  isVisible: boolean
  href: string
}

interface UseEntitySidebarOptions {
  scope?: string
}

/**
 * Hook for managing entity sidebar state including edit mode, visibility, and ordering.
 * Follows the same patterns as useMailSidebar.
 */
export function useEntitySidebar({ scope = 'SIDEBAR' }: UseEntitySidebarOptions = {}) {
  const [isEditMode, setIsEditMode] = useState(false)
  const lastToggleTime = useRef<number>(0)

  const { getSetting, updateUserSetting, isLoading: settingsLoading } = useSettings({ scope })
  const { customResources, isLoading: resourcesLoading } = useResources()

  /** Process entities: apply saved order and visibility */
  const entities = useMemo((): ProcessedEntity[] => {
    // Get saved order and visibility settings
    const entityOrder = (getSetting(ENTITY_ORDER_SETTING_KEY) as string[]) || []
    const visibilitySettings =
      (getSetting(ENTITY_VISIBILITY_SETTING_KEY) as Record<string, boolean>) || {}

    // Convert custom resources to processed entities, filtering out hidden entities
    const dynamicEntities: ProcessedEntity[] = (customResources || [])
      .filter((resource) => resource.isVisible !== false)
      .map((resource) => ({
        id: resource.id,
        apiSlug: resource.apiSlug,
        label: resource.label,
        plural: resource.plural,
        icon: resource.icon,
        color: resource.color,
        entityType: resource.entityType,
        isStatic: false,
        isLocked: false,
        isVisible: visibilitySettings[resource.id] !== false,
        href: `/app/custom/${resource.apiSlug}`,
      }))

    // Combine static + dynamic entities
    const allEntities = [STATIC_TICKETS_ENTITY, ...dynamicEntities]

    // Create a map for quick lookup
    const entityMap = new Map(allEntities.map((entity) => [entity.id, entity]))

    // Build sorted list based on saved order
    const sortedEntities: ProcessedEntity[] = []
    const processedIds = new Set<string>()

    // First, add entities in saved order
    entityOrder.forEach((id) => {
      const entity = entityMap.get(id)
      if (entity) {
        sortedEntities.push({
          ...entity,
          isVisible: entity.isLocked ? true : visibilitySettings[id] !== false,
        })
        processedIds.add(id)
      }
    })

    // Then, append any entities not in saved order (new entities)
    allEntities.forEach((entity) => {
      if (!processedIds.has(entity.id)) {
        sortedEntities.push({
          ...entity,
          isVisible: entity.isLocked ? true : visibilitySettings[entity.id] !== false,
        })
      }
    })

    return sortedEntities
  }, [customResources, getSetting])

  /** Get group visibility setting */
  const isGroupVisible = useMemo((): boolean => {
    const setting = getSetting(ENTITY_GROUP_VISIBILITY_SETTING_KEY)
    return setting !== false
  }, [getSetting])

  /** Toggle edit mode with debounce */
  const toggleEditMode = useCallback(() => {
    const now = Date.now()
    if (now - lastToggleTime.current < 300) {
      return
    }
    lastToggleTime.current = now
    setIsEditMode((prev) => !prev)
  }, [])

  /** Update entity visibility */
  const updateEntityVisibility = useCallback(
    (entityId: string, isVisible: boolean) => {
      const currentSettings =
        (getSetting(ENTITY_VISIBILITY_SETTING_KEY) as Record<string, boolean>) || {}
      const updatedSettings = { ...currentSettings, [entityId]: isVisible }
      updateUserSetting(ENTITY_VISIBILITY_SETTING_KEY, updatedSettings)
    },
    [getSetting, updateUserSetting]
  )

  /** Update entity order */
  const updateEntityOrder = useCallback(
    (orderedEntityIds: string[]) => {
      updateUserSetting(ENTITY_ORDER_SETTING_KEY, orderedEntityIds)
    },
    [updateUserSetting]
  )

  /** Toggle group visibility */
  const toggleGroupVisibility = useCallback(() => {
    const currentValue = getSetting(ENTITY_GROUP_VISIBILITY_SETTING_KEY) !== false
    updateUserSetting(ENTITY_GROUP_VISIBILITY_SETTING_KEY, !currentValue)
  }, [getSetting, updateUserSetting])

  return {
    isEditMode,
    entities,
    isLoading: resourcesLoading || settingsLoading,
    toggleEditMode,
    updateEntityVisibility,
    updateEntityOrder,
    isGroupVisible,
    toggleGroupVisibility,
  }
}
