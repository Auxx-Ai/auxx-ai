// apps/web/src/components/resources/hooks/use-all-resources.ts

import { useResourceProvider } from '../providers/resource-provider'
import type { Resource, CustomResource } from '@auxx/lib/resources/client'

interface UseAllResourcesResult {
  /** All resources (system + custom) */
  resources: Resource[]
  /** Custom resources only */
  customResources: CustomResource[]
  /** Loading state */
  isLoading: boolean
  /** Get resource by ID */
  getResourceById: (id: string) => Resource | undefined
}

/**
 * Hook for accessing all resources
 */
export function useAllResources(): UseAllResourcesResult {
  const { resources, customResources, isLoadingResources, getResourceById } = useResourceProvider()
  return { resources, customResources, isLoading: isLoadingResources, getResourceById }
}
