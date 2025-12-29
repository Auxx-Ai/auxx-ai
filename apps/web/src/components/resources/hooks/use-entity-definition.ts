// apps/web/src/components/resources/hooks/use-entity-definition.ts

import { useMemo } from 'react'
import { useResourceProvider } from '../providers/resource-provider'
import type { CustomResource } from '@auxx/lib/resources/client'
import { getEntitySlug } from '@auxx/lib/resources/client'

interface UseEntityDefinitionResult {
  /** The custom resource (contains entityDefinitionId, label, plural, etc.) */
  resource: CustomResource | undefined
  /** Convenience: the entity definition ID */
  entityDefinitionId: string | undefined
  /** Convenience: the entity slug (derived from resource.id) */
  slug: string | undefined
  /** Loading state */
  isLoading: boolean
}

/**
 * Get custom resource by entity slug
 * The CustomResource contains all entity definition data:
 * - entityDefinitionId
 * - label (singular name)
 * - plural (plural name)
 * - icon, color, display config
 */
export function useEntityDefinition(slug: string | null): UseEntityDefinitionResult {
  const { getResourceById, isLoadingResources } = useResourceProvider()

  const resourceId = slug ? `entity_${slug}` : null
  const resource = resourceId ? getResourceById(resourceId) : undefined
  const customResource = resource?.type === 'custom' ? (resource as CustomResource) : undefined

  return {
    resource: customResource,
    entityDefinitionId: customResource?.entityDefinitionId,
    slug: customResource ? getEntitySlug(customResource.id) : undefined,
    isLoading: isLoadingResources,
  }
}

/**
 * Get custom resource by entity definition ID
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
    slug: customResource ? getEntitySlug(customResource.id) : undefined,
    isLoading: isLoadingResources,
  }
}
