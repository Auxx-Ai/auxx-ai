// apps/web/src/components/dynamic-table/components/table-toolbar/table-toolbar.tsx

'use client'

import { Button } from '@auxx/ui/components/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@auxx/ui/components/dropdown-menu'
import { InputSearch } from '@auxx/ui/components/input-search'
import { toastError } from '@auxx/ui/components/toast'
import { cn } from '@auxx/ui/lib/utils'
import {
  ArrowDownUp,
  ArrowLeft,
  ChevronLeft,
  CircleHelp,
  Download,
  Printer,
  RefreshCw,
  Save,
  Search,
  Upload,
} from 'lucide-react'
import Link from 'next/link'
import type { ReactNode } from 'react'
import { useEffect, useMemo, useState } from 'react'
import { useExportColumns } from '~/components/data-export/hooks/use-export-columns'
import { ExportProgressDialog } from '~/components/data-export/ui/export-progress-dialog'
import { Tooltip } from '~/components/global/tooltip'
import { PrintWizardDialog } from '~/components/print/ui/print-wizard-dialog'
import { useResourceFields } from '~/components/resources/hooks'
import { useDebounce } from '~/hooks/use-debounced-value'
import { api } from '~/trpc/react'
import { useTableConfig } from '../../context/table-config-context'
import { useTableInstance } from '../../context/table-instance-context'
import { useViewMetadata } from '../../context/view-metadata-context'
import { useDynamicTableStore } from '../../stores/dynamic-table-store'
import { useSetFilters } from '../../stores/store-actions'
import {
  useActiveView,
  useActiveViewId,
  useTableFilters,
  useTableSorting,
  useTableViews,
} from '../../stores/store-selectors'
import type { ViewConfig, ViewType } from '../../types'
import { CalendarViewSettings } from './calendar-view-settings'
import { ColumnManager } from './column-manager'
import { KanbanViewSettings } from './kanban-view-settings'
import { RecordsGuideDialog } from './records-guide-dialog'
import { TableFilterBuilder } from './table-filter-builder'
import { ViewSelector } from './view-selector'

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
    renderSearch,
    enableImport = false,
    onImport,
    importHref,
    onRefresh,
    customFilter,
  } = useTableConfig()

  const { table } = useTableInstance<TData>()
  const { selectFields, dateFields } = useViewMetadata()

  // View state from stores
  const views = useTableViews(tableId)
  const currentView = useActiveView(tableId)
  const filters = useTableFilters(tableId)
  const setFilters = useSetFilters(tableId)
  const setActiveView = useDynamicTableStore((state) => state.setActiveView)

  // Get filterable fields from resource system
  const { filterableFields } = useResourceFields(entityDefinitionId ?? null)

  // Determine view type
  const viewType: ViewType = (currentView?.config as ViewConfig)?.viewType ?? 'table'
  const isKanbanView = viewType === 'kanban'
  const isCalendarView = viewType === 'calendar'

  // Check if current filters differ from the active view's saved filters
  const hasUnsavedFilters = useMemo(() => {
    const viewFilters = (currentView?.config as ViewConfig)?.filters ?? []
    return JSON.stringify(filters) !== JSON.stringify(viewFilters)
  }, [filters, currentView?.config])

  // State for controlling create view dialog from "Save as new view" button
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false)

  // Mobile search toggle
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false)

  // Records help guide
  const [guideOpen, setGuideOpen] = useState(false)

  // CSV export
  const activeViewId = useActiveViewId(tableId)
  const sorting = useTableSorting(tableId)
  const { viewColumns, allColumns } = useExportColumns(tableId, entityDefinitionId)
  const createExport = api.dataExport.create.useMutation()
  const [exportJobId, setExportJobId] = useState<string | null>(null)
  const [exportDialogOpen, setExportDialogOpen] = useState(false)

  // PDF print wizard — shares the same progress dialog as CSV export (`exportJobId`/
  // `exportDialogOpen` above), just fed from a different job id.
  const [printWizardOpen, setPrintWizardOpen] = useState(false)

  const startExport = async (exportType: 'view' | 'all') => {
    if (!entityDefinitionId) return
    const columns = exportType === 'view' ? viewColumns : allColumns
    if (columns.length === 0) {
      toastError({ title: 'Nothing to export', description: 'There are no columns to export.' })
      return
    }

    const dateStamp = new Date().toISOString().slice(0, 10)
    const base = exportType === 'view' ? (currentView?.name ?? 'view') : 'all-records'
    const slug =
      base
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '') || 'records'

    try {
      const { id } = await createExport.mutateAsync({
        entityDefinitionId,
        exportType,
        tableId,
        viewId: exportType === 'view' ? (activeViewId ?? undefined) : undefined,
        filters: exportType === 'view' ? filters : undefined,
        sorting: exportType === 'view' ? sorting : undefined,
        columns,
        fileName: `${slug}-${dateStamp}.csv`,
      })
      setExportJobId(id)
      setExportDialogOpen(true)
    } catch (error) {
      toastError({
        title: 'Export failed to start',
        description: error instanceof Error ? error.message : 'Please try again.',
      })
    }
  }

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
      data-search-expanded={mobileSearchOpen || undefined}
      data-slot='toolbar-controls'
      className={cn(
        'group/toolbar flex @container/controls border-b items-start gap-1.5 py-2 px-1 sm:px-3 bg-background overflow-x-auto no-scrollbar w-full',
        className
      )}>
      {/* View Selector - Always shown */}
      <div className='group-data-[search-expanded]/toolbar:hidden'>
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
          dateFields={dateFields}
          entityDefinitionId={entityDefinitionId}
          currentFilters={filters}
          openCreateDialog={isCreateDialogOpen}
          onCreateDialogChange={setIsCreateDialogOpen}
          table={table}
        />
      </div>

      {/* Filter Button - only shown when entityDefinitionId is available */}
      {enableFiltering && entityDefinitionId && (
        <div className='group-data-[search-expanded]/toolbar:hidden'>
          <TableFilterBuilder
            filters={filters}
            onFiltersChange={setFilters}
            filterableFields={filterableFields}
            resourceType={entityDefinitionId}
          />
        </div>
      )}

      {/* Save as new view button - shown when filters differ from active view */}
      {hasUnsavedFilters && filters.length > 0 && (
        <Button
          variant='outline'
          size='sm'
          className='group-data-[search-expanded]/toolbar:hidden'
          onClick={() => setIsCreateDialogOpen(true)}>
          <Save className='size-3' />
          <span className='hidden @lg/controls:block'>Save as new view</span>
        </Button>
      )}

      {/* Columns/Settings Button - different component for kanban/calendar vs table */}
      <div className='group-data-[search-expanded]/toolbar:hidden'>
        {isKanbanView ? (
          <KanbanViewSettings />
        ) : isCalendarView ? (
          <CalendarViewSettings />
        ) : (
          <ColumnManager />
        )}
      </div>

      {/* Import / Export Dropdown */}
      {enableImport && importHref && (
        <div className='group-data-[search-expanded]/toolbar:hidden'>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant='ghost' size='sm'>
                <ArrowDownUp />
                <span className='hidden @lg/controls:block'>Import / Export</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align='start'>
              <DropdownMenuItem asChild>
                <Link href={importHref}>
                  <Upload />
                  Import data
                </Link>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                disabled={!entityDefinitionId || createExport.isPending}
                onSelect={() => startExport('view')}>
                <Download />
                Export current view as CSV
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={!entityDefinitionId || createExport.isPending}
                onSelect={() => startExport('all')}>
                <Download />
                Export all records as CSV
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                disabled={!entityDefinitionId}
                onSelect={() => setPrintWizardOpen(true)}>
                <Printer />
                Print / save as PDF...
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}
      {/* Custom Filter */}
      {customFilter && (
        <div className='group-data-[search-expanded]/toolbar:hidden'>{customFilter}</div>
      )}

      {/* Mobile search toggle button — visible only on small screens when search is collapsed */}
      {enableSearch && (
        <Button
          variant='ghost'
          size='sm'
          className='sm:hidden group-data-[search-expanded]/toolbar:hidden'
          onClick={() => {
            console.log('[toolbar] search toggle clicked, opening')
            setMobileSearchOpen(true)
          }}>
          <Search />
        </Button>
      )}

      {/* Search Input — hidden on mobile until expanded */}
      {renderSearch ? (
        <div className='hidden sm:flex flex-1 group-data-[search-expanded]/toolbar:flex'>
          <Button
            variant='ghost'
            size='icon-xs'
            className='hidden group-data-[search-expanded]/toolbar:flex sm:hidden shrink-0 mt-0.5 sm:mt-0'
            onClick={() => {
              setMobileSearchOpen(false)
              setLocalSearchQuery('')
            }}>
            <ChevronLeft />
          </Button>
          {renderSearch()}
        </div>
      ) : enableSearch ? (
        <div className='hidden sm:flex flex-1 group-data-[search-expanded]/toolbar:flex'>
          <Button
            variant='ghost'
            size='sm'
            className='hidden group-data-[search-expanded]/toolbar:flex sm:hidden shrink-0'
            onClick={() => {
              setMobileSearchOpen(false)
              setLocalSearchQuery('')
            }}>
            <ArrowLeft />
          </Button>
          <InputSearch
            className=''
            placeholder='Search...'
            value={localSearchQuery}
            onChange={(e) => setLocalSearchQuery(e.target.value)}
          />
        </div>
      ) : null}

      {onRefresh && (
        <Tooltip content='Refresh Data'>
          <Button
            variant='ghost'
            size='sm'
            className='text-xs group-data-[search-expanded]/toolbar:hidden'
            onClick={onRefresh}>
            <RefreshCw />
          </Button>
        </Tooltip>
      )}

      {/* Custom children */}
      {children && <div className='group-data-[search-expanded]/toolbar:hidden'>{children}</div>}

      {/* Help guide — always last */}
      <Tooltip content='Records guide'>
        <Button
          variant='ghost'
          size='sm'
          className='ml-auto group-data-[search-expanded]/toolbar:hidden'
          onClick={() => setGuideOpen(true)}>
          <CircleHelp />
        </Button>
      </Tooltip>
      {guideOpen && <RecordsGuideDialog open={guideOpen} onOpenChange={setGuideOpen} />}

      {exportJobId && (
        <ExportProgressDialog
          jobId={exportJobId}
          open={exportDialogOpen}
          onOpenChange={setExportDialogOpen}
        />
      )}

      {entityDefinitionId && printWizardOpen && (
        <PrintWizardDialog
          open={printWizardOpen}
          onOpenChange={setPrintWizardOpen}
          entityDefinitionId={entityDefinitionId}
          tableId={tableId}
          onCreated={(jobId) => {
            setExportJobId(jobId)
            setExportDialogOpen(true)
          }}
        />
      )}
    </div>
  )
}

// Add display name for easier identification
TableToolbar.displayName = 'TableToolbar'
