// apps/web/src/app/(protected)/app/custom/[slug]/_components/entity-records-content.tsx
'use client'

import { useMemo, useState, useCallback } from 'react'
import { useParams } from 'next/navigation'
import { Button } from '@auxx/ui/components/button'
import {
  Plus,
  Trash2,
  Archive,
  Database,
  FileText,
  SquarePen,
  BookPlus,
  Play,
  Combine,
} from 'lucide-react'
import { useEntityInstanceOperations } from '~/hooks/use-entity-instance-operations'
import {
  DynamicView,
  DynamicTableFooter,
  CustomFieldCell,
  PrimaryFieldCell,
} from '~/components/dynamic-table'
import type { ExtendedColumnDef, CellSelectionConfig } from '~/components/dynamic-table'
import { ModelTypes } from '@auxx/types/custom-field'
import { EmptyState } from '~/components/global/empty-state'
import { getIconForFieldType } from '~/components/dynamic-table/custom-field-column-factory'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@auxx/ui/components/dropdown-menu'
import type { FieldType } from '@auxx/database/types'
import {
  MainPage,
  MainPageBreadcrumb,
  MainPageBreadcrumbItem,
  MainPageContent,
  MainPageHeader,
} from '@auxx/ui/components/main-page'
import { EntityInstanceDialog } from '~/components/custom-fields/ui/entity-instance-dialog'
import { BulkUpdateEntityInstanceDialog } from '~/components/custom-fields/ui/bulk-update-entity-instance-dialog'
import { CustomFieldDialog } from '~/components/custom-fields/ui/custom-field-dialog'
import { EntityRecordDrawer } from './entity-record-drawer'
import { useEffectiveDockState } from '~/hooks/use-effective-dock-state'
import { useDockStore } from '~/stores/dock-store'
import { MassWorkflowTriggerDialog } from '~/components/workflow/mass-workflow-trigger-dialog'
import { MergeDialog } from '~/components/merge'
import { useFieldValueSyncer } from '~/components/resources/hooks/use-field-value-syncer'
import {
  useTableFilters,
  useTableSorting,
  useColumnVisibility,
} from '~/components/dynamic-table/stores/store-selectors'
import { useRecordList, useResource, toRecordId, type RecordMeta } from '~/components/resources'
import { isCustomResource, type ResourceField, type RecordId } from '@auxx/lib/resources/client'
import { toResourceFieldId, toFieldId } from '@auxx/types/field'
import { decodeColumnId } from '~/components/dynamic-table/utils/column-id'
import { useResourceStore } from '~/components/resources/store/resource-store'

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
    <div className="flex items-center h-8">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-xs" className="rounded-sm">
            <Plus />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
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
 * Entity records content component
 * Displays the table of entity instances using data from context
 */
export function EntityRecordsContent() {
  const params = useParams<{ slug: string }>()
  const slug = params.slug

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

  // State
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false)
  const [editingInstance, setEditingInstance] = useState<EntityRow | null>(null)
  const [selectedRowIds, setSelectedRowIds] = useState<Set<string>>(new Set())

  // Drawer state - use ID instead of full object for stability
  const [selectedInstanceId, setSelectedInstanceId] = useState<string | undefined>(undefined)
  const [isDrawerOpen, setIsDrawerOpen] = useState(false)

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
    setIsDrawerOpen(false)
    setSelectedInstanceId(undefined)
  }, [])

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
  const handleOpenDrawer = useCallback((row: EntityRow) => {
    setSelectedInstanceId(row.id)
    setIsDrawerOpen(true)
  }, [])

  /**
   * Handle opening edit dialog from primary display cell
   */
  const handleOpenEditDialog = useCallback((row: EntityRow) => {
    setEditingInstance(row)
    setIsCreateDialogOpen(true)
  }, [])

  /**
   * Handle drawer close
   */
  const handleDrawerOpenChange = useCallback((open: boolean) => {
    setIsDrawerOpen(open)
    if (!open) {
      setSelectedInstanceId(undefined)
    }
  }, [])

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
  const handleDialogOpenChange = useCallback((open: boolean) => {
    setIsCreateDialogOpen(open)
    if (!open) {
      setEditingInstance(null)
    }
  }, [])

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
    // Sort fields by sortOrder
    const sortedFields = [...customFields]
      .filter((f) => f.active !== false)
      .sort((a, b) => (a.sortOrder ?? '').localeCompare(b.sortOrder ?? ''))

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
              <DropdownMenuItem variant="destructive" onClick={() => handleDelete(row.original.id)}>
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
      <div className="flex h-full items-center justify-center">
        <EmptyState
          icon={Database}
          title={`No ${resource?.plural?.toLowerCase() ?? 'records'} found`}
          description={`Create your first ${resource?.label?.toLowerCase() ?? 'record'}`}
          button={
            <Button size="sm" variant="outline" onClick={() => setIsCreateDialogOpen(true)}>
              <Plus />
              Create {resource?.label ?? 'Record'}
            </Button>
          }
        />
      </div>
    ),
    [resource?.plural, resource?.label]
  )

  // Loading state
  if (isLoading) {
    return (
      <MainPage>
        <MainPageHeader>
          <MainPageBreadcrumb>
            <MainPageBreadcrumbItem title="Loading..." href={`/app/custom/${slug}`} last />
          </MainPageBreadcrumb>
        </MainPageHeader>
        <MainPageContent>
          <div className="flex h-full items-center justify-center">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
          </div>
        </MainPageContent>
      </MainPage>
    )
  }

  // Error state
  if (!resource) {
    return (
      <MainPage>
        <MainPageHeader>
          <MainPageBreadcrumb>
            <MainPageBreadcrumbItem title="Not Found" href={`/app/custom/${slug}`} last />
          </MainPageBreadcrumb>
        </MainPageHeader>
        <MainPageContent>
          <div className="flex h-full items-center justify-center">
            <EmptyState
              icon={FileText}
              title="Entity not found"
              description={`The entity "${slug}" could not be found or you don't have access to it.`}
            />
          </div>
        </MainPageContent>
      </MainPage>
    )
  }

  // Build docked panel content
  const dockedPanel =
    isDocked && isDrawerOpen && selectedInstanceId && entityDefinitionId ? (
      <EntityRecordDrawer
        open={isDrawerOpen}
        onOpenChange={handleDrawerOpenChange}
        recordId={toRecordId(entityDefinitionId, selectedInstanceId)}
        onDeleteInstance={handleDrawerDelete}
        onMutationSuccess={refresh}
      />
    ) : undefined

  return (
    <>
      <MainPage>
        <MainPageHeader
          action={
            <Button
              size="sm"
              className="h-7 rounded-lg"
              onClick={() => setIsCreateDialogOpen(true)}>
              <Plus className="size-4" />
              Create {resource.label}
            </Button>
          }>
          <MainPageBreadcrumb>
            <MainPageBreadcrumbItem title={resource.plural} href={`/app/custom/${slug}`} last />
          </MainPageBreadcrumb>
        </MainPageHeader>
        <MainPageContent
          dockedPanel={dockedPanel}
          dockedPanelWidth={dockedWidth}
          onDockedPanelWidthChange={setDockedWidth}
          dockedPanelMinWidth={minWidth}
          dockedPanelMaxWidth={maxWidth}>
          <div className="flex-1 overflow-hidden rounded-lg bg-white dark:bg-muted/10 flex-col flex">
            <DynamicView
              data={records}
              className="h-full flex-1"
              tableId={`entity-${entityDefinitionId}`}
              bulkActions={bulkActions}
              enableSearch
              columns={columns}
              enableSorting
              enableFiltering
              isLoading={instancesLoading || isLoadingRecords}
              onRowSelectionChange={handleRowSelectionChange}
              showRowNumbers={false}
              importHref={`/app/custom/${slug}/import`}
              onScrollToBottom={handleScrollToBottom}
              emptyState={<EmptyStateComponent />}
              headerActions={
                <HeaderActionsDropdown onNewField={() => setIsFieldDialogOpen(true)} />
              }
              cellSelection={cellSelectionConfig}
              entityLabel={resource?.label}
              onAddNew={() => setIsCreateDialogOpen(true)}
              onCardClick={handleOpenDrawer}
              onAddCard={() => setIsCreateDialogOpen(true)}
              entityDefinitionId={entityDefinitionId}
              selectedKanbanCardIds={selectedKanbanCardIds}
              onSelectedKanbanCardIdsChange={setSelectedKanbanCardIds}>
              <DynamicTableFooter>
                <div className="flex items-center justify-between px-4 py-2 text-sm">
                  <div>
                    {records.length}{' '}
                    {records.length === 1
                      ? resource.label.toLowerCase()
                      : resource.plural.toLowerCase()}
                    {hasNextPage && <span className="ml-2">(more available)</span>}
                  </div>
                  {isFetchingNextPage && (
                    <div className="flex items-center gap-2">
                      <div className="h-3 w-3 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                      <span>Loading more...</span>
                    </div>
                  )}
                </div>
              </DynamicTableFooter>
            </DynamicView>
          </div>
        </MainPageContent>
      </MainPage>

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

      {/* Entity Record Drawer - only render overlay when NOT docked */}
      {!isDocked && (
        <EntityRecordDrawer
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
