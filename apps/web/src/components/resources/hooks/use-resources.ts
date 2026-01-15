// apps/web/src/components/resources/hooks/use-resources.ts

import { useResourceStore } from '../store/resource-store'
import type { Resource, CustomResource } from '@auxx/lib/resources/client'

interface UseResourcesResult {
  /** All resources (system + custom) */
  resources: Resource[]
  /** Custom resources only */
  customResources: CustomResource[]
  /** Loading state */
  isLoading: boolean
  /** Get resource by entityDefinitionId or apiSlug */
  getResourceById: (entityDefinitionIdOrApiSlug: string) => Resource | undefined
}

/**
 * Hook for accessing resources
 */
export function useResources(): UseResourcesResult {
  // Selective subscriptions - only re-renders when these specific values change
  const resources = useResourceStore((s) => s.resources)
  const customResources = useResourceStore((s) => s.customResources)
  const isQueryLoading = useResourceStore((s) => s.isLoading)
  const hasLoadedOnce = useResourceStore((s) => s.hasLoadedOnce)
  const getResourceById = useResourceStore((s) => s.getResourceById)

  // If we haven't loaded resources yet, we're loading
  const isLoading = !hasLoadedOnce || isQueryLoading

  return { resources, customResources, isLoading, getResourceById }
}
