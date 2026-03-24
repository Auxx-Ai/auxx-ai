// apps/web/src/components/datasets/providers/datasets-provider.tsx

'use client'

import type { DatasetStatus, DatasetWithRelations } from '@auxx/lib/datasets'
import { toastError, toastSuccess } from '@auxx/ui/components/toast'
import { createContext, useCallback, useContext, useMemo, useState } from 'react'
import { useDebounce } from '~/hooks/use-debounced-value'
import { safeLocalStorage } from '~/lib/safe-localstorage'
import { api } from '~/trpc/react'

/**
 * Organization-level dataset statistics interface
 */
export interface OrganizationDatasetStats {
  total: number
  active: number
  processing: number
  error: number
  archived: number
  totalDocuments: number
  totalSize: bigint
}

/**
 * Context value interface for datasets management
 */
interface DatasetsContextValue {
  // Data
  items: DatasetWithRelations[]
  stats: OrganizationDatasetStats | null

  // Loading states
  isLoading: boolean
  isError: boolean
  error: Error | null

  // Filters and search
  searchQuery: string
  setSearchQuery: (query: string) => void
  selectedStatus: DatasetStatus | 'all'
  setSelectedStatus: (status: DatasetStatus | 'all') => void

  // View mode
  viewMode: 'grid' | 'table'
  setViewMode: (mode: 'grid' | 'table') => void

  // Actions
  refetch: () => void
  createDataset: (data: any) => Promise<DatasetWithRelations>
}

const DatasetsContext = createContext<DatasetsContextValue | null>(null)

/**
 * Hook to access datasets context
 */
export function useDatasets() {
  const context = useContext(DatasetsContext)
  if (!context) {
    throw new Error('useDatasets must be used within DatasetsProvider')
  }
  return context
}

interface DatasetsProviderProps {
  children: React.ReactNode
}

/**
 * Provider component for datasets management state
 */
export function DatasetsProvider({ children }: DatasetsProviderProps) {
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedStatus, setSelectedStatus] = useState<DatasetStatus | 'all'>('all')
  const [viewMode, _setViewMode] = useState<'grid' | 'table'>(
    () => (safeLocalStorage.get('datasets-view-mode') as 'grid' | 'table') || 'grid'
  )
  const setViewMode = (mode: 'grid' | 'table') => {
    _setViewMode(mode)
    safeLocalStorage.set('datasets-view-mode', mode)
  }

  const debouncedSearch = useDebounce(searchQuery, 300)

  // Fetch datasets with filters
  const {
    data: datasetsData,
    isLoading: isDatasetsLoading,
    error: datasetsError,
    refetch: refetchDatasets,
  } = api.dataset.list.useQuery({
    search: debouncedSearch || undefined,
    status: selectedStatus === 'all' ? undefined : selectedStatus,
    page: 1,
    pageSize: 50,
  })

  // Fetch organization-level stats
  const { data: statsData, isLoading: isStatsLoading } = api.dataset.getOrganizationStats.useQuery()

  const items = useMemo(() => {
    return datasetsData?.datasets || []
  }, [datasetsData])

  const stats = useMemo((): OrganizationDatasetStats | null => {
    if (!statsData) return null

    return {
      total: statsData.total,
      active: statsData.byStatus.ACTIVE || 0,
      processing: statsData.byStatus.PROCESSING || 0,
      error: statsData.byStatus.ERROR || 0,
      archived: statsData.byStatus.ARCHIVED || 0,
      totalDocuments: statsData.totalDocuments,
      totalSize: statsData.totalSize,
    }
  }, [statsData])

  const createDatasetMutation = api.dataset.create.useMutation({
    onSuccess: (newDataset) => {
      toastSuccess({
        title: 'Dataset created',
        description: `"${newDataset.name}" has been created successfully`,
      })
      refetchDatasets()
    },
    onError: (error) => {
      toastError({
        title: 'Failed to create dataset',
        description: error.message,
      })
    },
  })

  const createDataset = useCallback(
    async (data: any): Promise<DatasetWithRelations> => {
      return createDatasetMutation.mutateAsync(data)
    },
    [createDatasetMutation]
  )

  const contextValue: DatasetsContextValue = {
    // Data
    items,
    stats,

    // Loading states
    isLoading: isDatasetsLoading || isStatsLoading,
    isError: !!datasetsError,
    error: datasetsError,

    // Filters and search
    searchQuery,
    setSearchQuery,
    selectedStatus,
    setSelectedStatus,

    // View mode
    viewMode,
    setViewMode,

    // Actions
    refetch: refetchDatasets,
    createDataset,
  }

  return <DatasetsContext.Provider value={contextValue}>{children}</DatasetsContext.Provider>
}
