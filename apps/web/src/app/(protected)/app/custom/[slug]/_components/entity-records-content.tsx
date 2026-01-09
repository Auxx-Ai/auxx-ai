// apps/web/src/app/(protected)/app/custom/[slug]/_components/entity-records-content.tsx
'use client'

import { useMemo, useState, useCallback } from 'react'
import { useParams } from 'next/navigation'
import type { VisibilityState } from '@tanstack/react-table'
import { Button } from '@auxx/ui/components/button'
import { Plus, Trash2, Archive, Database, FileText, SquarePen, BookPlus, Play } from 'lucide-react'
import { useEntityInstanceOperations } from '~/hooks/use-entity-instance-operations'
import {
  DynamicView,
  DynamicTableFooter,
  CustomFieldCell,
  PrimaryCell,
} from '~/components/dynamic-table'
import type { ExtendedColumnDef, CellSelectionConfig } from '~/components/dynamic-table'
import type { StoreConfig } from '~/components/fields/property-provider'
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
import { useCustomFieldValueSyncer } from '~/hooks/use-custom-field-value-syncer'
import { useSaveFieldValue } from '~/hooks/use-save-field-value'
import { formatToDisplayValue } from '@auxx/lib/field-values/client'
import type { TypedFieldValue } from '@auxx/types/field-value'
import { useCombinedFilters } from '~/components/dynamic-table/hooks/use-combined-filters'
import { useActiveViewConfig } from '~/components/dynamic-table/stores/view-store'
import { useRecordList, useResource, type RecordMeta } from '~/components/resources'
import { isCustomResource, type ResourceField } from '@auxx/lib/resources/client'
import type { ConditionGroup } from '@auxx/lib/conditions/client'

/** Stable filter ID to prevent reference changes */
const SEARCH_FILTER_ID = 'entity-page-search-filter'

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
 * Build page-level filters (search).
 * Returns undefined if no filters (not empty array) for useRecordList compatibility.
 */
function buildPageFilters(params: { search?: string }): ConditionGroup[] | undefined {
  if (!params.search) return undefined
  return [
    {
      id: SEARCH_FILTER_ID,
      logicalOperator: 'OR',
      conditions: [
        {
          id: `${SEARCH_FILTER_ID}-0`,
          fieldId: '_displayValue',
          operator: 'contains',
          value: params.search,
        },
      ],
    },
  ]
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
          <Button variant="ghost" size="icon-sm" className="rounded-sm">
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

  const entityDefinitionId: string = resource?.id ?? null

  // State
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false)
  const [editingInstance, setEditingInstance] = useState<EntityRow | null>(null)
  const [selectedRowIds, setSelectedRowIds] = useState<Set<string>>(new Set())
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({})

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

  // ══════════════════════════════════════════════════════════════════════════
  // VIEW STORE INTEGRATION
  // ══════════════════════════════════════════════════════════════════════════

  // View store integration - tableId must match DynamicView
  const tableId = `entity-${entityDefinitionId}`
  const viewConfig = useActiveViewConfig(tableId)

  // Build page-level filters with stable IDs
  // Note: Search is handled by DynamicView internally, but we include for future use
  const pageFilters = useMemo(() => buildPageFilters({}), [])

  // Merge view filters with page filters
  const combinedFilters = useCombinedFilters({ viewConfig, pageFilters })

  // Get sorting from view config (already merged saved + pending)
  const viewSorting = useMemo(() => {
    const sorting = viewConfig?.sorting
    return sorting?.length ? sorting : undefined
  }, [viewConfig?.sorting])

  // ══════════════════════════════════════════════════════════════════════════
  // DATA FETCHING
  // ══════════════════════════════════════════════════════════════════════════

  // Query entity instances using unified record list
  const {
    items,
    isLoading: instancesLoading,
    isLoadingRecords,
    isFetchingNextPage,
    hasNextPage,
    fetchNextPage,
    refresh,
  } = useRecordList<RecordMeta>({
    resourceType: entityDefinitionId ?? '',
    filters: combinedFilters,
    sorting: viewSorting,
    limit: PAGE_SIZE,
    enabled: !!entityDefinitionId,
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
    handleSaveField,
    isCreatingField,
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

  // Get SINGLE_SELECT fields for kanban view
  const selectFields = useMemo(
    () =>
      customFields
        .filter((f) => f.fieldType === 'SINGLE_SELECT' && f.active !== false)
        .map((f) => ({
          id: f.id,
          name: f.name ?? f.label,
          options: f.options as { options?: Array<{ id: string; label: string; color?: string }> },
        })),
    [customFields]
  )

  // Row IDs for syncer
  const rowIds = useMemo(() => items.map((i) => i.id), [items])

  // Custom field column IDs for syncer (uses customField_ prefix format)
  const customFieldColumnIds = useMemo(
    () => customFields.map((f) => `customField_${f.id}`),
    [customFields]
  )

  // Custom field value syncer - reads from store for reactive updates
  const { getValue, isValueLoading } = useCustomFieldValueSyncer({
    resourceType: 'entity',
    entityDefId: entityDefinitionId,
    rowIds,
    columnVisibility,
    customFieldColumnIds,
    enabled: !!entityDefinitionId && customFields.length > 0,
  })

  // Note: Store hydration is handled by useCustomFieldValueSyncer
  // which calls batchGetValues and returns properly formatted TypedFieldValue.
  // This eliminates the need for manual row-to-TypedFieldValue conversion here.

  // Field metadata provider for relationship sync
  const getFieldMetadata = useCallback(
    (fieldId: string) => {
      const field = customFields.find((f) => f.id === fieldId)
      if (!field) return undefined
      return {
        fieldType: field.fieldType!,
        type: field.fieldType!,
        relationship: field.options?.relationship,
      }
    },
    [customFields]
  )

  // Cell value saving with optimistic updates
  const { saveValue } = useSaveFieldValue({
    resourceType: 'entity',
    entityDefId: entityDefinitionId!,
    modelType: 'entity',
    getFieldMetadata,
  })

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
  }, [])

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
      const columnId = `field_${field.id}`

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
        enableSorting: field.fieldType !== 'RELATIONSHIP',
        enableFiltering: field.fieldType !== 'RELATIONSHIP',
        enableResizing: true,
        minSize: 100,
        size: field.fieldType === 'RELATIONSHIP' ? 180 : 150,
        cell: ({ row }) => (
          <CustomFieldCell
            resourceType="entity"
            entityDefId={entityDefinitionId!}
            rowId={row.original.id}
            fieldId={field.id}
            fieldType={field.fieldType!}
            columnId={columnId}
            options={field.options}
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
    const primaryFieldId =
      resource && isCustomResource(resource) ? resource.display.primaryDisplayField?.id : undefined
    const primaryField = primaryFieldId
      ? sortedFields.find((f) => f.id === primaryFieldId)
      : sortedFields[0] // Fallback to first field

    // Create primary display column with integrated actions
    // Uses getValue from syncer for reactive updates
    const primaryColumn: ExtendedColumnDef<EntityRow> | null = primaryField
      ? {
          id: `field_${primaryField.id}`,
          accessorFn: (row) => getValue(row.id, primaryField.id),
          header: primaryField.name ?? primaryField.label,
          primaryCell: true,
          fieldType: primaryField.fieldType,
          icon: getIconForFieldType(primaryField.fieldType!),
          enableSorting: true,
          enableResizing: true,
          enableHiding: false, // Primary column cannot be hidden
          minSize: 200,
          size: 300,
          cell: ({ row }) => {
            const value = getValue(row.original.id, primaryField.id)
            const displayValue: string | null = (() => {
              if (value == null) return null
              // Handle TypedFieldValue from store using centralized formatter
              if (typeof value === 'object' && 'type' in value) {
                const formatted = formatToDisplayValue(
                  value as TypedFieldValue,
                  primaryField.fieldType!
                )
                return typeof formatted === 'string' ? formatted : null
              }
              // Handle raw value (fallback)
              return String(value)
            })()
            return (
              <PrimaryCell value={displayValue} onTitleClick={() => handleOpenDrawer(row.original)}>
                <DropdownMenuItem onClick={() => handleOpenEditDialog(row.original)}>
                  <SquarePen />
                  Edit
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleArchive(row.original.id)}>
                  <Archive />
                  Archive
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  variant="destructive"
                  onClick={() => handleDelete(row.original.id)}>
                  <Trash2 />
                  Delete
                </DropdownMenuItem>
              </PrimaryCell>
            )
          },
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
    getValue,
  ])

  /**
   * Define bulk actions for DynamicTable
   */
  const bulkActions = useMemo(
    () => [
      {
        label: 'Run workflow',
        icon: Play,
        variant: 'outline' as const,
        action: () => setIsWorkflowDialogOpen(true),
      },
      {
        label: 'Edit',
        icon: SquarePen,
        variant: 'outline' as const,
        action: () => setIsBulkUpdateDialogOpen(true),
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
   * Uses getStoreConfig for optimistic updates via PropertyProvider
   */
  const cellSelectionConfig: CellSelectionConfig = useMemo(
    () => ({
      enabled: true,
      getFieldDefinition: (columnId: string) => {
        // Column IDs are formatted as `field_${fieldId}`
        const fieldId = columnId.replace('field_', '')
        return customFields.find((f) => f.id === fieldId) ?? null
      },
      getCellValue: (rowId: string, columnId: string) => {
        const fieldId = columnId.replace('field_', '')
        return getValue(rowId, fieldId)
      },
      // Store config for optimistic updates via PropertyProvider
      getStoreConfig: (rowId: string): StoreConfig => ({
        resourceType: 'entity',
        resourceId: rowId,
        entityDefId: entityDefinitionId,
        modelType: ModelTypes.ENTITY,
      }),
      // Legacy path as fallback (can be removed after validation)
      onCellValueChange: async (rowId: string, columnId: string, value: unknown) => {
        const fieldId = columnId.replace('field_', '')
        // saveValue handles optimistic update + background mutation + rollback on error
        saveValue(rowId, fieldId, value)
      },
    }),
    [customFields, getValue, saveValue, entityDefinitionId]
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
    isDocked && isDrawerOpen && selectedInstanceId ? (
      <EntityRecordDrawer
        open={isDrawerOpen}
        onOpenChange={handleDrawerOpenChange}
        entityInstanceId={selectedInstanceId}
        entityDefinitionId={entityDefinitionId}
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
              data={items}
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
              onColumnVisibilityChange={setColumnVisibility}
              onScrollToBottom={handleScrollToBottom}
              emptyState={<EmptyStateComponent />}
              headerActions={
                <HeaderActionsDropdown onNewField={() => setIsFieldDialogOpen(true)} />
              }
              cellSelection={cellSelectionConfig}
              selectFields={selectFields}
              customFields={customFields}
              primaryFieldId={
                resource && isCustomResource(resource)
                  ? resource.display.primaryDisplayField?.id
                  : undefined
              }
              entityLabel={resource?.label}
              onAddNew={() => setIsCreateDialogOpen(true)}
              onCardClick={handleOpenDrawer}
              onAddCard={() => setIsCreateDialogOpen(true)}
              modelType="entity"
              entityDefinitionId={entityDefinitionId}
              selectedKanbanCardIds={selectedKanbanCardIds}
              onSelectedKanbanCardIdsChange={setSelectedKanbanCardIds}>
              <DynamicTableFooter>
                <div className="flex items-center justify-between px-4 py-2 text-sm text-muted-foreground">
                  <div>
                    {items.length}{' '}
                    {items.length === 1
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
      {entityDefinitionId && (
        <EntityInstanceDialog
          open={isCreateDialogOpen}
          onOpenChange={handleDialogOpenChange}
          entityDefinitionId={entityDefinitionId}
          editingInstanceId={editingInstance?.id}
          onSaved={handleDialogSaved}
        />
      )}

      {/* Bulk Update Dialog */}
      {entityDefinitionId && (
        <BulkUpdateEntityInstanceDialog
          open={isBulkUpdateDialogOpen}
          onOpenChange={setIsBulkUpdateDialogOpen}
          entityDefinitionId={entityDefinitionId}
          selectedInstanceIds={Array.from(selectedRowIds)}
          onSaved={() => {
            refresh()
            setSelectedRowIds(new Set())
          }}
        />
      )}

      {/* Custom Field Dialog */}
      <CustomFieldDialog
        open={isFieldDialogOpen}
        onOpenChange={setIsFieldDialogOpen}
        onSave={handleSaveField}
        isPending={isCreatingField}
        currentResourceId={resource?.id}
      />

      {/* Workflow Trigger Dialog */}
      <MassWorkflowTriggerDialog
        open={isWorkflowDialogOpen}
        onOpenChange={setIsWorkflowDialogOpen}
        resourceType="entity"
        entitySlug={slug}
        resourceIds={Array.from(selectedRowIds)}
        onSuccess={() => {
          setSelectedRowIds(new Set())
          refresh()
        }}
      />

      <ConfirmDeleteDialog />
      <ConfirmArchiveDialog />

      {/* Entity Record Drawer - only render overlay when NOT docked */}
      {!isDocked && (
        <EntityRecordDrawer
          open={isDrawerOpen}
          onOpenChange={handleDrawerOpenChange}
          entityInstanceId={selectedInstanceId}
          entityDefinitionId={entityDefinitionId}
          onDeleteInstance={handleDrawerDelete}
          onMutationSuccess={refresh}
        />
      )}
    </>
  )
}
