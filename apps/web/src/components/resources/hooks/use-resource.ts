// apps/web/src/components/resources/hooks/use-resource.ts

import { useResourceProvider } from '../providers/resource-provider'
import type { Resource } from '@auxx/lib/resources/client'

interface UseResourceResult {
  /** The resource (or undefined if not found) */
  resource: Resource | undefined
  /** Loading state */
  isLoading: boolean
}

/**
 * Hook for getting a single resource by ID
 */
export function useResource(resourceId: string | null): UseResourceResult {
  const { getResourceById, isLoadingResources } = useResourceProvider()
  const resource = resourceId ? getResourceById(resourceId) : undefined
  return { resource, isLoading: isLoadingResources }
}
