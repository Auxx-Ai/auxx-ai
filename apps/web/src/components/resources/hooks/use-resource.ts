// apps/web/src/components/resources/hooks/use-resource.ts

import type { Resource } from '@auxx/lib/resources/client'
import { useResourceStore } from '../store/resource-store'

interface UseResourceResult {
  /** The resource (or undefined if not found) */
  resource: Resource | undefined
  /** Loading state */
  isLoading: boolean
}

/**
 * Hook for getting a single resource by ID
 * @param resourceId - Can be entityDefinitionId, apiSlug, or systemType (e.g. "contacts")
 */
export function useResource(resourceId: string | null | undefined): UseResourceResult {
  // Subscribe directly to the resource data from the map - triggers re-render when resource changes
  const resource = useResourceStore((s) => (resourceId ? s.resourceMap.get(resourceId) : undefined))
  const isQueryLoading = useResourceStore((s) => s.isLoading)
  const hasLoadedOnce = useResourceStore((s) => s.hasLoadedOnce)

  // If we haven't loaded resources yet, we're loading
  // Or if the query is currently loading, we're loading
  const isLoading = !hasLoadedOnce || isQueryLoading

  return { resource, isLoading }
}
