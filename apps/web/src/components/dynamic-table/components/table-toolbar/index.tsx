// apps/web/src/components/dynamic-table/components/table-toolbar/table-toolbar.tsx

'use client'

import Link from 'next/link'
import { Upload, RefreshCw, Save } from 'lucide-react'
import { Button } from '@auxx/ui/components/button'
import { useState, useEffect, useMemo } from 'react'
import { ViewSelector } from './view-selector'
import { TableFilterBuilder } from './table-filter-builder'
import { ColumnManager } from './column-manager'
import { KanbanViewSettings } from './kanban-view-settings'
import type { ViewConfig, ViewType } from '../../types'
import { useDebounce } from '~/hooks/use-debounced-value'
import { useTableConfig } from '../../context/table-config-context'
import { useTableInstance } from '../../context/table-instance-context'
import { useViewMetadata } from '../../context/view-metadata-context'
import { useTableViews, useActiveView, useTableFilters } from '../../hooks/use-table-selectors'
import { useSetFilters } from '../../hooks/use-table-actions'
import { useViewStore } from '../../stores/view-store'
import type { ReactNode } from 'react'
import { InputSearch } from '@auxx/ui/components/input-search'
import { Tooltip } from '~/components/global/tooltip'
import { cn } from '@auxx/ui/lib/utils'
import { useResourceFields } from '~/components/resources/hooks'

interface TableToolbarProps {
  children?: ReactNode
  className?: string
  /** Search query from URL state */
  searchQuery: string
  /** Set search query in URL state */
  setSearchQuery: (query: string) => void
  /** Is view currently saving? */
  isSavingView?: boolean
  /** Does view have unsaved changes? */
  hasUnsavedViewChanges?: boolean
  /** Save current view callback */
  saveCurrentView?: () => void
  /** Reset view changes callback */
  resetViewChanges?: () => void
}

/**
 * Table toolbar with filters, search, and view management.
 * NEW VERSION - Uses new hooks instead of useTableContext.
 */
export function TableToolbar<TData = any>({
  children,
  className,
  searchQuery,
  setSearchQuery,
  isSavingView = false,
  hasUnsavedViewChanges = false,
  saveCurrentView,
  resetViewChanges,
}: TableToolbarProps) {
  // Config from focused contexts
  const {
    tableId,
    entityDefinitionId,
    enableFiltering = true,
    enableSearch = true,
    enableImport = false,
    onImport,
    importHref,
    onRefresh,
    customFilter,
  } = useTableConfig()

  const { table } = useTableInstance<TData>()
  const { selectFields } = useViewMetadata()

  // View state from stores
  const views = useTableViews(tableId)
  const currentView = useActiveView(tableId)
  const filters = useTableFilters(tableId)
  const setFilters = useSetFilters(tableId)
  const setActiveView = useViewStore((state) => state.setActiveView)

  // Get filterable fields from resource system
  const { filterableFields } = useResourceFields(entityDefinitionId ?? null)

  // Determine view type
  const viewType: ViewType = (currentView?.config as ViewConfig)?.viewType ?? 'table'
  const isKanbanView = viewType === 'kanban'

  // Check if current filters differ from the active view's saved filters
  const hasUnsavedFilters = useMemo(() => {
    const viewFilters = (currentView?.config as ViewConfig)?.filters ?? []
    return JSON.stringify(filters) !== JSON.stringify(viewFilters)
  }, [filters, currentView?.config])

  // State for controlling create view dialog from "Save as new view" button
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false)

  // Local search state for immediate UI feedback
  const [localSearchQuery, setLocalSearchQuery] = useState(searchQuery)
  const debouncedSearchQuery = useDebounce(localSearchQuery, 300)

  // Update parent when debounced value changes
  useEffect(() => {
    setSearchQuery(debouncedSearchQuery)
  }, [debouncedSearchQuery, setSearchQuery])

  // Sync with parent searchQuery
  useEffect(() => {
    setLocalSearchQuery(searchQuery)
  }, [searchQuery])

  return (
    <div
      className={cn(
        'flex @container/controls items-start gap-1.5 py-2 px-3 bg-background overflow-x-auto no-scrollbar w-full',
        className
      )}>
      {/* View Selector - Always shown */}
      <ViewSelector
        views={views}
        activeView={currentView}
        tableId={tableId}
        onViewSelect={(viewId) => setActiveView(tableId, viewId)}
        isSaving={isSavingView}
        hasUnsavedChanges={hasUnsavedViewChanges}
        onSave={saveCurrentView}
        onReset={resetViewChanges}
        selectFields={selectFields}
        entityDefinitionId={entityDefinitionId}
        currentFilters={filters}
        openCreateDialog={isCreateDialogOpen}
        onCreateDialogChange={setIsCreateDialogOpen}
        table={table}
      />

      {/* Filter Button - only shown when entityDefinitionId is available */}
      {enableFiltering && entityDefinitionId && (
        <TableFilterBuilder
          filters={filters}
          onFiltersChange={setFilters}
          filterableFields={filterableFields}
          resourceType={entityDefinitionId}
        />
      )}

      {/* Save as new view button - shown when filters differ from active view */}
      {hasUnsavedFilters && filters.length > 0 && (
        <Button variant="outline" size="sm" onClick={() => setIsCreateDialogOpen(true)}>
          <Save className="size-3" />
          <span className="hidden @lg/controls:block">Save as new view</span>
        </Button>
      )}

      {/* Columns/Settings Button - different component for kanban vs table */}
      {isKanbanView ? <KanbanViewSettings /> : <ColumnManager />}

      {/* Import Button - Link to import page if href provided, otherwise file picker */}
      {enableImport && importHref && (
        <Tooltip content="Import data">
          <Button variant="ghost" size="sm" asChild>
            <Link href={importHref}>
              <Upload className="size-3" />
              <span className="hidden @lg/controls:block">Import</span>
            </Link>
          </Button>
        </Tooltip>
      )}
      {/* Custom Filter */}
      {customFilter}

      {/* Search Input */}
      {enableSearch && (
        <InputSearch
          placeholder="Search..."
          value={localSearchQuery}
          onChange={(e) => setLocalSearchQuery(e.target.value)}
        />
      )}

      {onRefresh && (
        <Tooltip content="Refresh Data">
          <Button variant="ghost" size="sm" className="text-xs" onClick={onRefresh}>
            <RefreshCw />
          </Button>
        </Tooltip>
      )}

      {/* Custom children */}
      {children}
    </div>
  )
}

// Add display name for easier identification
TableToolbar.displayName = 'TableToolbar'
