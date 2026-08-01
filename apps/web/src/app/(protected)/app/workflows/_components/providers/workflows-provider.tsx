// apps/web/src/app/(protected)/app/workflows/_components/providers/workflows-provider.tsx
'use client'

import { WorkflowTriggerType } from '@auxx/lib/workflow-engine/client'
import React, { createContext, useCallback, useContext, useState } from 'react'
import { safeLocalStorage } from '~/lib/safe-localstorage'
import { api } from '~/trpc/react'

/**
 * The trigger filter is populated from the node registry, whose ids are plain
 * strings and include UI-only nodes that `workflow.list` does not accept. Narrow
 * to the enum the router validates against and drop anything else, so an
 * unrecognised selection simply doesn't filter instead of 400-ing the query.
 */
function toTriggerFilter(value: string | null): WorkflowTriggerType | undefined {
  return Object.values(WorkflowTriggerType).find((type) => type === value)
}

interface WorkflowsContextValue {
  // Data
  workflows: any[] // Actually WorkflowApps but transformed to maintain backward compatibility
  stats: {
    total: number
    enabled: number
    disabled: number
  }
  isLoading: boolean
  error: string | null

  // Filters
  searchQuery: string
  selectedTriggerType: string | null
  enabledFilter: boolean | null
  viewMode: 'grid' | 'table'

  // Actions
  setSearchQuery: (query: string) => void
  setSelectedTriggerType: (type: string | null) => void
  setEnabledFilter: (enabled: boolean | null) => void
  setViewMode: (mode: 'grid' | 'table') => void
  refetchWorkflows: () => void
}

const WorkflowsContext = createContext<WorkflowsContextValue | undefined>(undefined)

interface WorkflowsProviderProps {
  children: React.ReactNode
}

export function WorkflowsProvider({ children }: WorkflowsProviderProps) {
  // Filter states
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedTriggerType, setSelectedTriggerType] = useState<string | null>(null)
  const [enabledFilter, setEnabledFilter] = useState<boolean | null>(null)
  const [viewMode, _setViewMode] = useState<'grid' | 'table'>(
    () => (safeLocalStorage.get('workflows-view-mode') as 'grid' | 'table') || 'grid'
  )
  const setViewMode = (mode: 'grid' | 'table') => {
    _setViewMode(mode)
    safeLocalStorage.set('workflows-view-mode', mode)
  }

  // Build filter object for API call
  const filters = {
    search: searchQuery || undefined,
    triggerType: toTriggerFilter(selectedTriggerType),
    enabled: enabledFilter ?? undefined,
    limit: 50,
    offset: 0,
  }

  // Fetch workflows
  const {
    data: workflowsData,
    isLoading,
    error,
    refetch: refetchWorkflows,
  } = api.workflow.list.useQuery(filters)

  // Calculate stats from workflow apps data
  const stats = React.useMemo(() => {
    if (!workflowsData?.workflows) {
      return { total: 0, enabled: 0, disabled: 0 }
    }

    const workflowApps = workflowsData.workflows
    const total = workflowApps.length
    const enabled = workflowApps.filter((w) => w.enabled).length
    // const disabled = total - enabled
    // const totalExecutions = workflowApps.reduce((sum, w) => sum + (w._count?.executions || 0), 0)
    // const totalVersions = workflowApps.reduce((sum, w) => sum + (w._count?.workflows || 1), 0)

    // // Calculate success rate from recent executions
    // const recentExecutions = workflowApps.flatMap((w) => w.executions || [])
    // const successfulExecutions = recentExecutions.filter((e) => e.status === 'SUCCEEDED').length
    // const successRate =
    //   recentExecutions.length > 0
    //     ? Math.round((successfulExecutions / recentExecutions.length) * 100)
    //     : 0

    return { total, enabled, disabled: total - enabled }
  }, [workflowsData])

  const value: WorkflowsContextValue = {
    // Data
    workflows: workflowsData?.workflows || [],
    stats,
    isLoading,
    error: error?.message || null,

    // Filters
    searchQuery,
    selectedTriggerType,
    enabledFilter,
    viewMode,

    // Actions
    setSearchQuery,
    setSelectedTriggerType,
    setEnabledFilter,
    setViewMode,
    refetchWorkflows: useCallback(() => {
      refetchWorkflows()
    }, [refetchWorkflows]),
  }

  return <WorkflowsContext.Provider value={value}>{children}</WorkflowsContext.Provider>
}

export function useWorkflows() {
  const context = useContext(WorkflowsContext)
  if (context === undefined) {
    throw new Error('useWorkflows must be used within a WorkflowsProvider')
  }
  return context
}
