// apps/web/src/components/dynamic-table/components/table-toolbar/index.tsx

'use client'

import Link from 'next/link'
import { Upload, RefreshCw } from 'lucide-react'
import { Button } from '@auxx/ui/components/button'
import { useState, useEffect } from 'react'
import { ViewSelector } from './view-selector'
import { FilterBuilder } from './filter-builder'
import { ColumnManager } from './column-manager'
import { KanbanViewSettings } from './kanban-view-settings'
import type { ViewConfig, ViewType } from '../../types'
import { useDebounce } from '~/hooks/use-debounced-value'
import { useTableContext } from '../../context/table-context'
import type { ExtendedColumnDef } from '../../types'
import type { ReactNode } from 'react'
import { InputSearch } from '@auxx/ui/components/input-search'
import { Tooltip } from '~/components/global/tooltip'
import { cn } from '@auxx/ui/lib/utils'

interface TableToolbarProps {
  children?: ReactNode
  className?: string
}

/**
 * Table toolbar with filters, search, and view management
 */
export function TableToolbar<TData = any>({ children, className }: TableToolbarProps = {}) {
  const {
    table,
    views,
    currentView,
    tableId,
    filters,
    enableFiltering = true,
    enableSearch = true,
    enableImport = false,
    searchQuery,
    isSavingView = false,
    hasUnsavedViewChanges = false,
    customFilter,
    setActiveView,
    setSearchQuery,
    setFilters,
    saveCurrentView,
    resetViewChanges,
    onImport,
    importHref,
    onRefresh,
    selectFields,
    modelType,
    entityDefinitionId,
  } = useTableContext<TData>()

  // Get columns from table instance
  const columns = table.options.columns as ExtendedColumnDef<TData>[]

  // Determine view type
  const viewType: ViewType = (currentView?.config as ViewConfig)?.viewType ?? 'table'
  const isKanbanView = viewType === 'kanban'
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
        onViewSelect={setActiveView}
        isSaving={isSavingView}
        hasUnsavedChanges={hasUnsavedViewChanges}
        onSave={saveCurrentView}
        onReset={resetViewChanges}
        selectFields={selectFields}
        modelType={modelType}
        entityDefinitionId={entityDefinitionId}
      />

      {/* Filter Button */}
      {enableFiltering && (
        <FilterBuilder columns={columns} filters={filters} onFiltersChange={setFilters} />
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
