// apps/web/src/components/resources/hooks/use-entity-definition.ts

import { useMemo } from 'react'
import { useResourceProvider } from '../providers/resource-provider'
import type { CustomResource } from '@auxx/lib/resources/client'

interface UseEntityDefinitionResult {
  /** The custom resource (contains entityDefinitionId, label, plural, etc.) */
  resource: CustomResource | undefined
  /** Convenience: the entity definition ID */
  entityDefinitionId: string | undefined
  /** Convenience: the entity slug (apiSlug) */
  slug: string | undefined
  /** Loading state */
  isLoading: boolean
}

/**
 * Get custom resource by entity slug (apiSlug)
 * The CustomResource contains all entity definition data:
 * - entityDefinitionId (UUID)
 * - apiSlug (immutable slug for URLs)
 * - label (singular name)
 * - plural (plural name)
 * - icon, color, display config
 */
export function useEntityDefinition(slugOrUuid: string | null): UseEntityDefinitionResult {
  const { customResources, getResourceById, apiSlugMap, isLoadingResources } = useResourceProvider()

  const resource = useMemo(() => {
    if (!slugOrUuid) return undefined

    // Try as UUID first (direct lookup in resource map)
    const byUuid = getResourceById(slugOrUuid)
    if (byUuid?.type === 'custom') return byUuid as CustomResource

    // Try as slug (search in custom resources by apiSlug)
    const bySlug = customResources.find((r) => r.apiSlug === slugOrUuid)
    return bySlug
  }, [slugOrUuid, getResourceById, customResources])

  return {
    resource,
    entityDefinitionId: resource?.entityDefinitionId,
    slug: resource?.apiSlug,
    isLoading: isLoadingResources,
  }
}

/**
 * Get custom resource by entity definition ID (UUID)
 */
export function useEntityDefinitionById(id: string | null): UseEntityDefinitionResult {
  const { customResources, isLoadingResources } = useResourceProvider()

  const customResource = useMemo(
    () => (id ? customResources.find((r) => r.entityDefinitionId === id) : undefined),
    [id, customResources]
  )

  return {
    resource: customResource,
    entityDefinitionId: customResource?.entityDefinitionId,
    slug: customResource?.apiSlug,
    isLoading: isLoadingResources,
  }
}
