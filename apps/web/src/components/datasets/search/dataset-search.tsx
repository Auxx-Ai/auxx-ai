// apps/web/src/components/datasets/search/dataset-search.tsx

'use client'

import { useState, useCallback } from 'react'
import { EmptyState } from '~/components/global/empty-state'
import { Button } from '@auxx/ui/components/button'
import { Label } from '@auxx/ui/components/label'

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@auxx/ui/components/select'
import {
  Search,
  TestTubeDiagonal,
  Loader2,
  FileSearch,
  XIcon,
  Command,
  CornerDownLeft,
} from 'lucide-react'
import { AutosizeTextarea } from '@auxx/ui/components/autosize-textarea'
import { api } from '~/trpc/react'
import { toastSuccess, toastError } from '@auxx/ui/components/toast'
import { SearchResultItem } from './search-result-item'
import { Separator } from '@auxx/ui/components/separator'
import { AdvancedSearchOptions, type SearchConfiguration } from './advanced-search-options'

/**
 * Search result structure matching backend response
 */
interface SearchResult {
  segment: {
    id: string
    content: string
    position: number
    document: {
      id: string
      title: string
      filename: string
      dataset?: {
        id: string
        name: string
      }
    }
    metadata?: Record<string, any>
  }
  score: number
  rank: number
  searchType?: string
}

interface SearchMetrics {
  totalResults: number
  responseTime: number
  searchType: string
}

interface DatasetSearchState {
  searchQuery: string
  isSearching: boolean
  searchResults: SearchResult[]
  searchMetrics: SearchMetrics | null
  searchError: string | null
  selectedDatasetId: string | null
  advancedOptionsOpen: boolean
  searchConfig: SearchConfiguration
}

interface DatasetSearchProps {
  datasetIds: string[]
  /** Whether to include INACTIVE datasets in search. Default: false (ACTIVE only) */
  // includeInactive?: boolean
}

export function DatasetSearch({ datasetIds }: DatasetSearchProps) {
  /** State for search functionality */
  const [state, setState] = useState<DatasetSearchState>({
    searchQuery: '',
    isSearching: false,
    searchResults: [],
    searchMetrics: null,
    searchError: null,
    selectedDatasetId: datasetIds[0] || null,
    advancedOptionsOpen: false,
    searchConfig: {
      searchType: 'hybrid',
      topK: 10,
      scoreThreshold: 0.3,
      semanticWeight: 60,
    },
  })

  /** tRPC mutation for testing search configuration */
  const testSearch = api.dataset.testSearchConfig.useMutation({
    onMutate: () => {
      setState((prev) => ({ ...prev, isSearching: true, searchError: null }))
    },
    onSuccess: (data) => {
      setState((prev) => ({
        ...prev,
        isSearching: false,
        searchResults: data.results || [],
        searchMetrics: data.metrics,
        searchError: data.success ? null : data.error || 'Search failed',
      }))

      if (data.success) {
        toastSuccess({
          title: 'Search completed',
          description: `Found ${data.metrics?.totalResults || 0} results in ${data.metrics?.responseTime || 0}ms`,
        })
      } else {
        toastError({
          title: 'Search failed',
          description: data.error || 'Unknown error occurred',
        })
      }
    },
    onError: (error) => {
      setState((prev) => ({
        ...prev,
        isSearching: false,
        searchError: error.message,
      }))
      toastError({
        title: 'Search error',
        description: error.message,
      })
    },
  })

  /** Handle search execution */
  const handleSearch = useCallback(() => {
    if (!state.searchQuery.trim() || !state.selectedDatasetId || state.isSearching) {
      return
    }

    // Build dynamic search config based on search type
    const searchConfig: any = {
      searchType: state.searchConfig.searchType,
      limit: state.searchConfig.topK,
    }

    // Add type-specific parameters
    if (state.searchConfig.searchType === 'vector') {
      searchConfig.threshold = state.searchConfig.scoreThreshold
    } else if (state.searchConfig.searchType === 'hybrid') {
      searchConfig.threshold = state.searchConfig.scoreThreshold
      searchConfig.vectorWeight = state.searchConfig.semanticWeight / 100
      searchConfig.textWeight = 1 - state.searchConfig.semanticWeight / 100
    }

    testSearch.mutate({
      datasetId: state.selectedDatasetId,
      testQuery: state.searchQuery.trim(),
      searchConfig,
      includeInactive: true,
    })
  }, [
    state.searchQuery,
    state.selectedDatasetId,
    state.isSearching,
    state.searchConfig,
    testSearch,
  ])

  /** Handle keyboard shortcuts */
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault()
        handleSearch()
      }
      if (e.key === 'Escape') {
        setState((prev) => ({
          ...prev,
          searchResults: [],
          searchMetrics: null,
          searchError: null,
        }))
      }
    },
    [handleSearch]
  )

  /** Clear search results */
  const handleClear = useCallback(() => {
    setState((prev) => ({
      ...prev,
      searchQuery: '',
      searchResults: [],
      searchMetrics: null,
      searchError: null,
    }))
  }, [])

  const canSearch = state.searchQuery.trim() && state.selectedDatasetId && !state.isSearching
  const hasResults = state.searchResults.length > 0
  const hasError = !!state.searchError

  return (
    <div className="flex flex-col min-h-0 flex-1 overflow-hidden bg-background">
      <div className="grid grid-cols-1 md:grid-cols-2 h-full flex-1 overflow-y-auto">
        {/* Left Panel - Search Input */}
        <div className="border-r-0 md:border-r md:overflow-y-auto">
          <div className="h-full relative flex flex-col">
            <div className="flex flex-col p-4 space-y-4">
              <div>
                <div className="flex items-center text-sm font-semibold">Testing Search</div>
                <div className="text-sm text-muted-foreground">
                  Test the hitting effect of the Knowledge based on the given query text.
                </div>
              </div>

              {/* Dataset Selector */}
              {datasetIds.length > 1 && (
                <div className="space-y-2">
                  <label className="text-sm font-medium">Dataset</label>
                  <Select
                    value={state.selectedDatasetId || ''}
                    onValueChange={(value) =>
                      setState((prev) => ({ ...prev, selectedDatasetId: value }))
                    }>
                    <SelectTrigger>
                      <SelectValue placeholder="Select dataset" />
                    </SelectTrigger>
                    <SelectContent>
                      {datasetIds.map((id) => (
                        <SelectItem key={id} value={id}>
                          Dataset {id.slice(-8)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {/* Search Query Input */}
              <div className="space-y-2">
                <Label>Search Query</Label>
                <div className="relative">
                  <AutosizeTextarea
                    placeholder="Enter your search query..."
                    value={state.searchQuery}
                    onChange={(e) => setState((prev) => ({ ...prev, searchQuery: e.target.value }))}
                    onKeyDown={handleKeyDown}
                    minHeight={120}
                    className="resize-none pe-10 rounded-xl"
                  />
                  <Button
                    onClick={handleSearch}
                    size="xs"
                    disabled={!canSearch}
                    loading={state.isSearching}
                    loadingText="Searching..."
                    className="absolute bottom-2 right-2 gap-0">
                    Search
                    <Separator orientation="vertical" className="mx-1.5 h-3 opacity-50" />
                    <Command className="size-3! opacity-80" />
                    <CornerDownLeft className="size-3! opacity-80" />
                  </Button>
                  <Button
                    variant="outline"
                    size="icon-xs"
                    className="absolute top-1 right-1 rounded-full"
                    onClick={handleClear}
                    disabled={!state.searchQuery && !hasResults}>
                    <XIcon />
                  </Button>
                </div>
              </div>

              {/* Advanced Search Options */}
              <AdvancedSearchOptions
                config={state.searchConfig}
                onConfigChange={(updates) =>
                  setState((prev) => ({
                    ...prev,
                    searchConfig: { ...prev.searchConfig, ...updates },
                  }))
                }
                isOpen={state.advancedOptionsOpen}
                onToggle={() =>
                  setState((prev) => ({ ...prev, advancedOptionsOpen: !prev.advancedOptionsOpen }))
                }
                disabled={state.isSearching}
              />

              {/* Action Buttons */}
              <div className="flex gap-2"></div>
            </div>
          </div>
        </div>

        {/* Right Panel - Results */}
        <div className="flex h-full flex-1  md:overflow-y-auto border-t md:border-t-0">
          {state.isSearching ? (
            <EmptyState
              icon={Loader2}
              iconClassName="animate-spin"
              title="Searching..."
              description="Finding relevant results in your dataset"
            />
          ) : hasError ? (
            <EmptyState
              icon={TestTubeDiagonal}
              title="Search Error"
              description={state.searchError || 'An error occurred during search'}
            />
          ) : hasResults ? (
            <div className="w-full p-4 space-y-4">
              {/* Search Metrics */}
              {state.searchMetrics && (
                <div className=" rounded-lg border p-3">
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-medium">{state.searchMetrics.totalResults} results</span>
                    <span className="text-muted-foreground">
                      {state.searchMetrics.responseTime}ms • {state.searchMetrics.searchType}
                      {state.searchConfig.searchType === 'hybrid' &&
                        ` • ${state.searchConfig.semanticWeight}% semantic`}
                    </span>
                  </div>
                </div>
              )}

              {/* Search Results */}
              <div className="space-y-3 pb-4">
                {state.searchResults.map((result, index) => (
                  <SearchResultItem
                    key={result.segment?.id || index}
                    result={result}
                    index={index}
                    showMetadata={true}
                  />
                ))}
              </div>
            </div>
          ) : (
            <EmptyState
              icon={FileSearch}
              title="Ready to Search"
              description="Enter a search query and click Search to test your dataset"
            />
          )}
        </div>
      </div>
    </div>
  )
}
