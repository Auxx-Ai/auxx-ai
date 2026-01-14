// apps/web/src/components/resources/hooks/use-resources.ts

import { useResourceProvider } from '../providers/resource-provider'
import type { Resource, CustomResource } from '@auxx/lib/resources/client'

interface UseResourcesResult {
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
 * Hook for accessing resources
 */
export function useResources(): UseResourcesResult {
  const { resources, customResources, isLoadingResources, getResourceById } = useResourceProvider()
  return { resources, customResources, isLoading: isLoadingResources, getResourceById }
}
