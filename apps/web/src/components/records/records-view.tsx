// apps/web/src/components/records/records-view.tsx
'use client'

import type { FieldType } from '@auxx/database/types'
import type { RecordId, ResourceField } from '@auxx/lib/resources/client'
import { toFieldId, toResourceFieldId } from '@auxx/types/field'
import { Button } from '@auxx/ui/components/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@auxx/ui/components/dropdown-menu'
import Loader from '@auxx/ui/components/loader'
import {
  type DockedPanelConfig,
  MainPage,
  MainPageBreadcrumb,
  MainPageBreadcrumbItem,
  MainPageContent,
  MainPageHeader,
} from '@auxx/ui/components/main-page'
import {
  Archive,
  BookPlus,
  Combine,
  Database,
  FileText,
  Play,
  Plus,
  SquarePen,
  Trash2,
} from 'lucide-react'
import { parseAsBoolean, parseAsString, useQueryState } from 'nuqs'
import { useCallback, useMemo, useState } from 'react'
import { BulkUpdateEntityInstanceDialog } from '~/components/custom-fields/ui/bulk-update-entity-instance-dialog'
import { CustomFieldDialog } from '~/components/custom-fields/ui/custom-field-dialog'
import { EntityInstanceDialog } from '~/components/custom-fields/ui/entity-instance-dialog'
import type { CellSelectionConfig, ExtendedColumnDef } from '~/components/dynamic-table'
import {
  CustomFieldCell,
  DynamicTableFooter,
  DynamicView,
  PrimaryFieldCell,
} from '~/components/dynamic-table'
import { getIconForFieldType } from '~/components/dynamic-table/custom-field-column-factory'
import {
  useColumnVisibility,
  useTableFilters,
  useTableSorting,
} from '~/components/dynamic-table/stores/store-selectors'
import { decodeColumnId } from '~/components/dynamic-table/utils/column-id'
import { EmptyState } from '~/components/global/empty-state'
import { MergeDialog } from '~/components/merge'
import { type RecordMeta, toRecordId, useRecordList, useResource } from '~/components/resources'
import { useFieldValueSyncer } from '~/components/resources/hooks/use-field-value-syncer'
import { useResourceStore } from '~/components/resources/store/resource-store'
import { MassWorkflowTriggerDialog } from '~/components/workflow/mass-workflow-trigger-dialog'
import { useEffectiveDockState } from '~/hooks/use-effective-dock-state'
import { useEntityInstanceOperations } from '~/hooks/use-entity-instance-operations'
import { useDockStore } from '~/stores/dock-store'
import { RecordDrawer } from './record-drawer'

/** Page size for infinite query */
const PAGE_SIZE = 100

/**
 * Entity row type extending RecordMeta for type alignment with useRecordList
 */
export interface EntityRow extends RecordMeta {
  entityDefinitionId: string
  archivedAt: string | null
}

/**
 * Props for HeaderActionsDropdown component
 */
interface HeaderActionsDropdownProps {
  onNewField: () => void
}

/**
 * Dropdown button for header actions (add new field, etc.)
 */
function HeaderActionsDropdown({ onNewField }: HeaderActionsDropdownProps) {
  return (
    <div className='flex items-center h-8'>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant='ghost' size='icon-xs' className='rounded-sm'>
            <Plus />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align='end'>
          <DropdownMenuItem onClick={onNewField}>
            <BookPlus />
            New Field
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

/**
 * Props for RecordsView component
 */
interface RecordsViewProps {
  /** Resource slug to load (e.g. 'contacts', 'orders') */
  slug: string
  /** Base URL path for breadcrumbs and import links. Defaults to /app/custom/${slug} */
  basePath?: string
  /** When true, RecordsView renders without its own MainPage wrapper (parent provides it) */
  embedded?: boolean
}

/**
 * RecordsView component
 * Displays the table of entity instances using data from context
 */
export function RecordsView({ slug, basePath, embedded }: RecordsViewProps) {
  const resolvedBasePath = basePath ?? `/app/custom/${slug}`

  // Dock state
  const isDocked = useEffectiveDockState()
  const dockedWidth = useDockStore((state) => state.dockedWidth)
  const setDockedWidth = useDockStore((state) => state.setDockedWidth)
  const minWidth = useDockStore((state) => state.minWidth)
  const maxWidth = useDockStore((state) => state.maxWidth)

  // Get resource with fields
  const { resource, isLoading } = useResource(slug)

  // Derive custom fields from resource.fields (filter to fields with id = custom fields only)
  const customFields = useMemo(
    () => resource?.fields.filter((f): f is ResourceField & { id: string } => !!f.id) ?? [],
    [resource?.fields]
  )

  const entityDefinitionId = resource?.id

  // Create dialog state — synced with ?create URL param for external triggers (e.g. layout header button)
  const [createParam, setCreateParam] = useQueryState('create', parseAsBoolean.withDefault(false))
  const [isCreateDialogOpenInternal, setIsCreateDialogOpenInternal] = useState(false)
  const isCreateDialogOpen = isCreateDialogOpenInternal || createParam
  const setIsCreateDialogOpen = useCallback(
    (open: boolean) => {
      setIsCreateDialogOpenInternal(open)
      if (!open && createParam) setCreateParam(null)
    },
    [createParam, setCreateParam]
  )

  // State
  const [editingInstance, setEditingInstance] = useState<EntityRow | null>(null)
  const [selectedRowIds, setSelectedRowIds] = useState<Set<string>>(new Set())

  // Drawer state - synced to URL via ?id= param
  const [selectedInstanceId, setSelectedInstanceId] = useQueryState(
    'id',
    parseAsString.withDefault('')
  )
  const isDrawerOpen = !!selectedInstanceId

  // Kanban card selection state (lives here to persist across drawer open/close)
  const [selectedKanbanCardIds, setSelectedKanbanCardIds] = useState<Set<string>>(new Set())

  // Custom field dialog state
  const [isFieldDialogOpen, setIsFieldDialogOpen] = useState(false)

  // Bulk update dialog state
  const [isBulkUpdateDialogOpen, setIsBulkUpdateDialogOpen] = useState(false)

  // Workflow dialog state
  const [isWorkflowDialogOpen, setIsWorkflowDialogOpen] = useState(false)

  // Merge dialog state
  const [isMergeDialogOpen, setIsMergeDialogOpen] = useState(false)

  // ══════════════════════════════════════════════════════════════════════════
  // VIEW STORE INTEGRATION
  // ══════════════════════════════════════════════════════════════════════════

  // View store integration - tableId must match DynamicView
  const tableId = `entity-${entityDefinitionId}`

  // Get filters and sorting directly from store (already merged saved + pending)
  const viewFilters = useTableFilters(tableId)
  const viewSorting = useTableSorting(tableId)
  const storeColumnVisibility = useColumnVisibility(tableId)

  // Get fieldMap from resource store for field lookups across all entities
  const fieldMap = useResourceStore((state) => state.fieldMap)

  // Convert to formats expected by useRecordList
  const filtersForQuery = viewFilters.length > 0 ? viewFilters : undefined
  const sortingForQuery = viewSorting.length > 0 ? viewSorting : undefined

  // Check if store config is initialized (undefined = not ready yet)
  const isConfigReady = storeColumnVisibility !== undefined

  // ══════════════════════════════════════════════════════════════════════════
  // DATA FETCHING
  // ══════════════════════════════════════════════════════════════════════════

  // Query entity instances using unified record list
  const {
    records,
    isLoading: instancesLoading,
    isLoadingRecords,
    isFetchingNextPage,
    hasNextPage,
    fetchNextPage,
    refresh,
  } = useRecordList<EntityRow>({
    entityDefinitionId: entityDefinitionId ?? '',
    filters: filtersForQuery,
    sorting: sortingForQuery,
    limit: PAGE_SIZE,
    enabled: !!entityDefinitionId && isConfigReady,
  })

  // Handle scroll to bottom - load more data
  const handleScrollToBottom = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage && !instancesLoading) {
      fetchNextPage()
    }
  }, [hasNextPage, isFetchingNextPage, instancesLoading, fetchNextPage])

  // Memoized callbacks for operations hook (must be stable to prevent infinite loops)
  const handleOperationsDrawerClose = useCallback(() => {
    setSelectedInstanceId(null)
  }, [setSelectedInstanceId])

  const handleOperationsClearSelection = useCallback(() => {
    setSelectedRowIds(new Set())
  }, [])

  // Entity instance operations hook (mutations only)
  const {
    handleArchive,
    handleDelete,
    handleDrawerDelete,
    handleBulkDelete,
    handleBulkArchive,
    ConfirmDeleteDialog,
    ConfirmArchiveDialog,
  } = useEntityInstanceOperations({
    entityDefinitionId,
    resourceLabel: resource?.label,
    resourcePlural: resource?.plural,
    onDrawerClose: handleOperationsDrawerClose,
    onClearSelection: handleOperationsClearSelection,
    onRefetch: refresh,
  })

  // Convert to RecordIds for syncer
  const recordIds = useMemo(
    () => (entityDefinitionId ? records.map((i) => toRecordId(entityDefinitionId, i.id)) : []),
    [records, entityDefinitionId]
  )

  // Build column IDs in ResourceFieldId format (includes path columns from store)
  const columnIds = useMemo(() => {
    // Direct field column IDs from customFields
    const directFieldIds = customFields.map((field) => field.resourceFieldId!)

    // Path columns from store visibility (path columns contain '::')
    const pathColumnIds = storeColumnVisibility
      ? Object.keys(storeColumnVisibility).filter((key) => key.includes('::'))
      : []

    return [...directFieldIds, ...pathColumnIds]
  }, [customFields, storeColumnVisibility])

  // Field value syncer - reads from store for reactive updates
  const { getValue, isValueLoading } = useFieldValueSyncer({
    recordIds,
    columnVisibility: storeColumnVisibility ?? {},
    resourceFieldIds: columnIds,
    enabled: !!entityDefinitionId && columnIds.length > 0 && isConfigReady,
  })

  // Note: Store hydration is handled by useFieldValueSyncer
  // which calls batchGetValues and returns properly formatted TypedFieldValue.
  // This eliminates the need for manual row-to-TypedFieldValue conversion here.
  // Cell value saving is handled internally by PropertyProvider via storeConfig.

  /**
   * Handle opening drawer from primary display cell
   */
  const handleOpenDrawer = useCallback(
    (row: EntityRow) => {
      setSelectedInstanceId(row.id)
    },
    [setSelectedInstanceId]
  )

  /**
   * Handle opening edit dialog from primary display cell
   */
  const handleOpenEditDialog = useCallback(
    (row: EntityRow) => {
      setEditingInstance(row)
      setIsCreateDialogOpen(true)
    },
    [setIsCreateDialogOpen]
  )

  /**
   * Handle drawer close
   */
  const handleDrawerOpenChange = useCallback(
    (open: boolean) => {
      if (!open) setSelectedInstanceId(null)
    },
    [setSelectedInstanceId]
  )

  /**
   * Handle row selection change
   */
  const handleRowSelectionChange = useCallback((selectedRows: Set<string>) => {
    setSelectedRowIds(selectedRows)
  }, [])

  /**
   * Handle dialog save
   */
  const handleDialogSaved = useCallback(() => {
    setEditingInstance(null)
    refresh()
  }, [refresh])

  /**
   * Handle dialog open change
   */
  const handleDialogOpenChange = useCallback(
    (open: boolean) => {
      setIsCreateDialogOpen(open)
      if (!open) {
        setEditingInstance(null)
      }
    },
    [setIsCreateDialogOpen]
  )

  /**
   * Create column for entity instance field
   * Uses CustomFieldCell for direct store subscription and reactive updates
   */
  const createEntityFieldColumn = useCallback(
    (field: (typeof customFields)[0]): ExtendedColumnDef<EntityRow> => {
      // Generate ResourceFieldId format: entityDefinitionId:fieldId
      const resourceFieldId = toResourceFieldId(entityDefinitionId!, toFieldId(field.id))
      const columnId = resourceFieldId // Use ResourceFieldId as column ID directly

      // Build default formatting from field options for CURRENCY type
      const fieldOptions = field.options as { currency?: Record<string, unknown> } | undefined
      const defaultFormatting =
        field.fieldType === 'CURRENCY' && fieldOptions?.currency
          ? { type: 'currency' as const, ...fieldOptions.currency }
          : undefined

      return {
        id: columnId,
        accessorFn: () => undefined, // Not used for display - cells read from store
        header: field.name ?? field.label,
        fieldType: field.fieldType as FieldType,
        defaultFormatting,
        defaultVisible: true,
        icon: getIconForFieldType(field.fieldType!),
        enableSorting: field.fieldType !== 'RELATIONSHIP' && field.capabilities.sortable !== false,
        enableFiltering:
          field.fieldType !== 'RELATIONSHIP' && field.capabilities.filterable !== false,
        enableResizing: true,
        minSize: 100,
        size: field.fieldType === 'RELATIONSHIP' ? 180 : 150,
        cell: ({ row }) => (
          <CustomFieldCell
            recordId={toRecordId(entityDefinitionId!, row.original.id)}
            columnId={columnId}
          />
        ),
      }
    },
    [entityDefinitionId]
  )

  /**
   * Generate columns from custom field definitions
   * Primary display column is first with integrated actions
   */
  const columns: ExtendedColumnDef<EntityRow>[] = useMemo(() => {
    // Fields arrive pre-sorted from ResourceRegistryService (sortOrder + metadata-last)
    const sortedFields = customFields.filter((f) => f.active !== false)

    // Find primary display field (only available on custom resources)
    const primaryFieldId = resource?.display.primaryDisplayField?.id
    const primaryField = primaryFieldId
      ? sortedFields.find((f) => f.id === primaryFieldId)
      : sortedFields[0] // Fallback to first field

    // Create primary display column with integrated actions
    // Uses PrimaryFieldCell for reactive store subscription
    const primaryColumn: ExtendedColumnDef<EntityRow> | null = primaryField
      ? {
          id: toResourceFieldId(entityDefinitionId!, toFieldId(primaryField.id)),
          accessorFn: () => undefined, // Not used - PrimaryFieldCell reads from store
          header: primaryField.name,
          primaryCell: true,
          fieldType: primaryField.fieldType,
          icon: getIconForFieldType(primaryField.fieldType!),
          enableSorting: true,
          enableResizing: true,
          enableHiding: false, // Primary column cannot be hidden
          minSize: 200,
          size: 300,
          cell: ({ row }) => (
            <PrimaryFieldCell
              resourceFieldId={toResourceFieldId(entityDefinitionId!, toFieldId(primaryField.id))}
              rowId={row.original.id}
              onTitleClick={() => handleOpenDrawer(row.original)}>
              <DropdownMenuItem onClick={() => handleOpenEditDialog(row.original)}>
                <SquarePen />
                Edit
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleArchive(row.original.id)}>
                <Archive />
                Archive
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant='destructive' onClick={() => handleDelete(row.original.id)}>
                <Trash2 />
                Delete
              </DropdownMenuItem>
            </PrimaryFieldCell>
          ),
        }
      : null

    // Create columns for other fields (excluding primary)
    const otherColumns = sortedFields
      .filter((f) => f.id !== primaryField?.id)
      .map(createEntityFieldColumn)

    return primaryColumn ? [primaryColumn, ...otherColumns] : otherColumns
  }, [
    customFields,
    resource,
    createEntityFieldColumn,
    handleOpenDrawer,
    handleOpenEditDialog,
    handleArchive,
    handleDelete,
    entityDefinitionId,
  ])

  /**
   * Define bulk actions for DynamicTable
   * Note: actions receive selected rows from FloatingBulkActionBar (works for both table and kanban)
   */
  const bulkActions = useMemo(
    () => [
      {
        label: 'Run workflow',
        icon: Play,
        variant: 'outline' as const,
        action: (rows: EntityRow[]) => {
          setSelectedRowIds(new Set(rows.map((r) => r.id)))
          setIsWorkflowDialogOpen(true)
        },
      },
      {
        label: 'Merge',
        icon: Combine,
        variant: 'outline' as const,
        action: (rows: EntityRow[]) => {
          setSelectedRowIds(new Set(rows.map((r) => r.id)))
          setIsMergeDialogOpen(true)
        },
      },
      {
        label: 'Edit',
        icon: SquarePen,
        variant: 'outline' as const,
        action: (rows: EntityRow[]) => {
          setSelectedRowIds(new Set(rows.map((r) => r.id)))
          setIsBulkUpdateDialogOpen(true)
        },
      },
      {
        label: 'Archive',
        icon: Archive,
        variant: 'outline' as const,
        action: (rows: EntityRow[]) => handleBulkArchive(rows),
      },
      {
        label: 'Delete',
        icon: Trash2,
        variant: 'destructive' as const,
        action: (rows: EntityRow[]) => handleBulkDelete(rows),
      },
    ],
    [handleBulkArchive, handleBulkDelete]
  )

  /**
   * Cell selection configuration for inline editing
   * Uses getValue from syncer for consistent value reads
   * Uses getResourceId for optimistic updates via PropertyProvider
   */
  const cellSelectionConfig: CellSelectionConfig = useMemo(
    () => ({
      enabled: true,
      getFieldDefinition: (columnId: string): ResourceField | null => {
        // System columns (like _checkbox) don't have field definitions
        if (columnId.startsWith('_')) return null

        // Decode column ID to handle both direct fields and fieldpaths
        const decoded = decodeColumnId(columnId)

        if (decoded.type === 'path') {
          // Fieldpath: get the last ResourceFieldId (the editable field)
          const lastResourceFieldId = decoded.fieldPath[decoded.fieldPath.length - 1]
          return fieldMap[lastResourceFieldId] ?? null
        }

        // Direct field: look up in fieldMap
        return fieldMap[decoded.resourceFieldId] ?? null
      },
      getCellValue: (rowId: string, columnId: string) => {
        // System columns don't have values in the store
        if (columnId.startsWith('_')) return undefined

        if (!entityDefinitionId) return undefined
        return getValue(toRecordId(entityDefinitionId, rowId), columnId)
      },
      // RecordId for optimistic updates via PropertyProvider
      getRecordId: (rowId: string) => {
        if (!entityDefinitionId) return null as unknown as RecordId
        return toRecordId(entityDefinitionId, rowId)
      },
    }),
    [getValue, entityDefinitionId, fieldMap]
  )

  /**
   * Empty state component
   */
  const EmptyStateComponent = useCallback(
    () => (
      <div className='flex h-full items-center justify-center'>
        <EmptyState
          icon={Database}
          title={`No ${resource?.plural?.toLowerCase() ?? 'records'} found`}
          description={`Create your first ${resource?.label?.toLowerCase() ?? 'record'}`}
          button={
            <Button size='sm' variant='outline' onClick={() => setIsCreateDialogOpen(true)}>
              <Plus />
              Create {resource?.label ?? 'Record'}
            </Button>
          }
        />
      </div>
    ),
    [resource?.plural, resource?.label]
  )

  // Build docked panels (must be before early returns to satisfy Rules of Hooks)
  const dockedPanels = useMemo<DockedPanelConfig[]>(() => {
    if (!isDocked || !isDrawerOpen || !selectedInstanceId || !entityDefinitionId) return []
    return [
      {
        key: 'record-detail',
        content: (
          <RecordDrawer
            open={isDrawerOpen}
            onOpenChange={handleDrawerOpenChange}
            recordId={toRecordId(entityDefinitionId, selectedInstanceId)}
            onDeleteInstance={handleDrawerDelete}
            onMutationSuccess={refresh}
          />
        ),
        width: dockedWidth,
        onWidthChange: setDockedWidth,
        minWidth,
        maxWidth,
      },
    ]
  }, [
    isDocked,
    isDrawerOpen,
    selectedInstanceId,
    entityDefinitionId,
    handleDrawerOpenChange,
    handleDrawerDelete,
    refresh,
    dockedWidth,
    setDockedWidth,
    minWidth,
    maxWidth,
  ])

  // Loading state
  if (isLoading) {
    const loadingContent = (
      <MainPageContent>
        <div className='flex h-full items-center justify-center'>
          <Loader size='sm' title='Loading records...' subtitle='Please wait' />
          {/* <div className='h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent' /> */}
        </div>
      </MainPageContent>
    )
    if (embedded) return loadingContent
    return (
      <MainPage>
        <MainPageHeader>
          <MainPageBreadcrumb>
            <MainPageBreadcrumbItem title='Loading...' href={resolvedBasePath} last />
          </MainPageBreadcrumb>
        </MainPageHeader>
        {loadingContent}
      </MainPage>
    )
  }

  // Error state
  if (!resource) {
    const errorContent = (
      <MainPageContent>
        <div className='flex h-full items-center justify-center'>
          <EmptyState
            icon={FileText}
            title='Entity not found'
            description={`The entity "${slug}" could not be found or you don't have access to it.`}
          />
        </div>
      </MainPageContent>
    )
    if (embedded) return errorContent
    return (
      <MainPage>
        <MainPageHeader>
          <MainPageBreadcrumb>
            <MainPageBreadcrumbItem title='Not Found' href={resolvedBasePath} last />
          </MainPageBreadcrumb>
        </MainPageHeader>
        {errorContent}
      </MainPage>
    )
  }

  // Main content (table + footer)
  const mainContent = (
    <MainPageContent dockedPanels={dockedPanels}>
      <div className='flex-1 overflow-hidden rounded-lg bg-white dark:bg-muted/10 flex-col flex'>
        <DynamicView
          data={records}
          className='h-full flex-1'
          tableId={`entity-${entityDefinitionId}`}
          bulkActions={bulkActions}
          enableSearch
          columns={columns}
          enableSorting
          enableFiltering
          isLoading={instancesLoading || isLoadingRecords}
          onRowSelectionChange={handleRowSelectionChange}
          showRowNumbers={false}
          importHref={`${resolvedBasePath}/import`}
          onScrollToBottom={handleScrollToBottom}
          emptyState={<EmptyStateComponent />}
          headerActions={<HeaderActionsDropdown onNewField={() => setIsFieldDialogOpen(true)} />}
          cellSelection={cellSelectionConfig}
          entityLabel={resource?.label}
          onAddNew={() => setIsCreateDialogOpen(true)}
          onCardClick={handleOpenDrawer}
          onAddCard={() => setIsCreateDialogOpen(true)}
          entityDefinitionId={entityDefinitionId}
          selectedKanbanCardIds={selectedKanbanCardIds}
          onSelectedKanbanCardIdsChange={setSelectedKanbanCardIds}>
          <DynamicTableFooter>
            <div className='flex items-center justify-between px-4 py-2 text-sm'>
              <div>
                {records.length}{' '}
                {records.length === 1
                  ? resource.label.toLowerCase()
                  : resource.plural.toLowerCase()}
                {hasNextPage && <span className='ml-2'>(more available)</span>}
              </div>
              {isFetchingNextPage && (
                <div className='flex items-center gap-2'>
                  <div className='h-3 w-3 animate-spin rounded-full border-2 border-primary border-t-transparent' />
                  <span>Loading more...</span>
                </div>
              )}
            </div>
          </DynamicTableFooter>
        </DynamicView>
      </div>
    </MainPageContent>
  )

  return (
    <>
      {embedded ? (
        mainContent
      ) : (
        <MainPage>
          <MainPageHeader
            action={
              <Button
                size='sm'
                className='h-7 rounded-lg'
                onClick={() => setIsCreateDialogOpen(true)}>
                <Plus className='size-4' />
                Create {resource.label}
              </Button>
            }>
            <MainPageBreadcrumb>
              <MainPageBreadcrumbItem title={resource.plural} href={resolvedBasePath} last />
            </MainPageBreadcrumb>
          </MainPageHeader>
          {mainContent}
        </MainPage>
      )}

      {/* Create/Edit Dialog */}
      {entityDefinitionId && isCreateDialogOpen && (
        <EntityInstanceDialog
          open={isCreateDialogOpen}
          onOpenChange={handleDialogOpenChange}
          entityDefinitionId={entityDefinitionId}
          recordId={
            editingInstance ? toRecordId(entityDefinitionId, editingInstance.id) : undefined
          }
          onSaved={handleDialogSaved}
        />
      )}

      {/* Bulk Update Dialog */}
      {entityDefinitionId && isBulkUpdateDialogOpen && (
        <BulkUpdateEntityInstanceDialog
          open={isBulkUpdateDialogOpen}
          onOpenChange={setIsBulkUpdateDialogOpen}
          recordIds={Array.from(selectedRowIds).map((id) => toRecordId(entityDefinitionId, id))}
          onSaved={() => {
            refresh()
            setSelectedRowIds(new Set())
          }}
        />
      )}

      {/* Custom Field Dialog */}
      {isFieldDialogOpen && entityDefinitionId && (
        <CustomFieldDialog
          open={isFieldDialogOpen}
          onOpenChange={setIsFieldDialogOpen}
          entityDefinitionId={entityDefinitionId}
        />
      )}

      {/* Workflow Trigger Dialog */}
      {isWorkflowDialogOpen && entityDefinitionId && (
        <MassWorkflowTriggerDialog
          open={isWorkflowDialogOpen}
          onOpenChange={setIsWorkflowDialogOpen}
          recordIds={Array.from(selectedRowIds).map((id) => toRecordId(entityDefinitionId, id))}
          onSuccess={() => {
            setSelectedRowIds(new Set())
            refresh()
          }}
        />
      )}

      {/* Merge Dialog */}
      {isMergeDialogOpen && entityDefinitionId && (
        <MergeDialog
          open={isMergeDialogOpen}
          onOpenChange={setIsMergeDialogOpen}
          baseRecordIds={Array.from(selectedRowIds).map((id) => toRecordId(entityDefinitionId, id))}
          onMergeComplete={() => {
            setSelectedRowIds(new Set())
            refresh()
          }}
        />
      )}

      <ConfirmDeleteDialog />
      <ConfirmArchiveDialog />

      {/* Record Drawer - only render overlay when NOT docked */}
      {!isDocked && (
        <RecordDrawer
          open={isDrawerOpen}
          onOpenChange={handleDrawerOpenChange}
          recordId={
            selectedInstanceId && entityDefinitionId
              ? toRecordId(entityDefinitionId, selectedInstanceId)
              : undefined
          }
          onDeleteInstance={handleDrawerDelete}
          onMutationSuccess={refresh}
        />
      )}
    </>
  )
}
