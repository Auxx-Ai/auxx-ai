// apps/web/src/components/workflow/providers/workflow-resource-provider.tsx

'use client'

import { createContext, useContext, useMemo, useEffect } from 'react'
import { useResources } from '~/components/resources'
import type { Resource } from '@auxx/lib/resources/client'
import { useVarStore } from '../store/use-var-store'
import { api } from '~/trpc/react'

/**
 * Context value for workflow resource provider
 */
interface WorkflowResourceContextValue {
  /** All available resources (system + custom) with fields embedded */
  resources: Resource[]

  /** Loading state for resources */
  isLoadingResources: boolean

  /** Get resource by entityDefinitionId or apiSlug */
  getResourceById: (entityDefinitionIdOrApiSlug: string) => Resource | undefined

  /** Refetch resources */
  refetch: () => void
}

const WorkflowResourceContext = createContext<WorkflowResourceContextValue | null>(null)

interface WorkflowResourceProviderProps {
  children: React.ReactNode
}

/**
 * Provider that exposes resources for workflow editor
 * Fields are embedded in resources - no separate loading needed
 */
export function WorkflowResourceProvider({ children }: WorkflowResourceProviderProps) {
  const { resources, isLoading, getResourceById } = useResources()
  const setResources = useVarStore((state) => state.actions.setResources)
  const utils = api.useUtils()

  // Refetch function that invalidates the resource query
  const refetch = () => {
    utils.resource.getAllResourceTypes.invalidate()
  }

  // Sync resources to var store for dynamic variable generation
  useEffect(() => {
    if (resources.length > 0) {
      setResources(resources)
    }
  }, [resources, setResources])

  const value = useMemo<WorkflowResourceContextValue>(
    () => ({
      resources,
      isLoadingResources: isLoading,
      getResourceById,
      refetch,
    }),
    [resources, isLoading, getResourceById, refetch]
  )

  return (
    <WorkflowResourceContext.Provider value={value}>{children}</WorkflowResourceContext.Provider>
  )
}

/**
 * No-op implementation for read-only contexts (viewer mode)
 */
const noopResourceContext: WorkflowResourceContextValue = {
  resources: [],
  isLoadingResources: false,
  getResourceById: () => undefined,
  refetch: () => {},
}

/**
 * Hook to access workflow resource context
 * Returns no-op implementation when used outside WorkflowResourceProvider (e.g., in viewer)
 */
export function useWorkflowResources() {
  const context = useContext(WorkflowResourceContext)

  // Return no-op context for read-only viewer mode
  if (!context) {
    return noopResourceContext
  }

  return context
}
