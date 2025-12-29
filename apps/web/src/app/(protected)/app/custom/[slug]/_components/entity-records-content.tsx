// apps/web/src/app/(protected)/app/custom/[slug]/_components/entity-records-content.tsx
'use client'

import { useEffect, useMemo, useState, useCallback, useRef } from 'react'
import { useParams } from 'next/navigation'
import type { VisibilityState } from '@tanstack/react-table'
import { api } from '~/trpc/react'
import { Button } from '@auxx/ui/components/button'
import {
  Plus,
  MoreVertical,
  Trash2,
  Archive,
  Database,
  FileText,
  SquarePen,
  BookPlus,
  Play,
} from 'lucide-react'
import { useConfirm } from '~/hooks/use-confirm'
import { toastError } from '@auxx/ui/components/toast'
import { DynamicTable, DynamicTableFooter, useTableContext } from '~/components/dynamic-table'
import type {
  ExtendedColumnDef,
  CellSelectionConfig,
} from '~/components/dynamic-table'
import type { StoreConfig } from '~/components/contacts/drawer/property-provider'
import { ModelTypes } from '@auxx/lib/custom-fields/types'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@auxx/ui/components/dropdown-menu'
import { EmptyState } from '~/components/global/empty-state'
import {
  mapFieldTypeToColumnType,
  getIconForFieldType,
} from '~/components/dynamic-table/custom-field-column-factory'
import { FormattedCell } from '~/components/dynamic-table'
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
import { useEntityRecords } from '~/components/custom-fields/context/entity-records-context'
import { RelationshipCell } from '~/components/custom-fields/components/relationship-cell'
import { useCustomField } from '~/components/custom-fields/hooks/use-custom-field'
import { EntityRecordDrawer } from './entity-record-drawer'
import { useEffectiveDockState } from '~/hooks/use-effective-dock-state'
import { useDockStore } from '~/stores/dock-store'
import { MassWorkflowTriggerDialog } from '~/components/workflow/mass-workflow-trigger-dialog'
import { useCustomFieldValueSyncer } from '~/hooks/use-custom-field-value-syncer'
import {
  useCustomFieldValueStore,
  buildValueKey,
} from '~/stores/custom-field-value-store'

/**
 * Row data type for the table
 * Normalized to have customFieldValues for compatibility with existing column helpers
 */
interface EntityRow {
  id: string
  entityDefinitionId: string
  createdAt: string
  updatedAt: string
  archivedAt: string | null
  customFieldValues: Array<{
    fieldId: string
    value: unknown
  }>
  /** Original values array from API */
  _originalValues: Array<{
    id: string
    fieldId: string
    value: unknown
    createdAt?: Date
    updatedAt?: Date
    entityId?: string
  }>
}

/**
 * Props for PrimaryDisplayCell component
 */
interface PrimaryDisplayCellProps {
  row: EntityRow
  value: unknown
  onOpenDrawer: (row: EntityRow) => void
  onEdit: (row: EntityRow) => void
  onArchive: (id: string) => void
  onDelete: (id: string) => void
}

/**
 * Primary display cell component with integrated actions
 * Shows the primary display value as clickable link and actions dropdown
 * Handles its own padding for proper table cell layout
 */
function PrimaryDisplayCell({
  row,
  value,
  onOpenDrawer,
  onEdit,
  onArchive,
  onDelete,
}: PrimaryDisplayCellProps) {
  const displayValue = value != null ? String(value) : null

  return (
    <div className="flex items-center justify-between w-full pl-3 pr-2 text-sm group/primary">
      <button
        className="text-left underline decoration-muted-foreground/50 hover:decoration-primary truncate max-w-[calc(100%-40px)]"
        onClick={(e) => {
          e.stopPropagation()
          onOpenDrawer(row)
        }}>
        {displayValue || 'Untitled'}
      </button>

      <div onClick={(e) => e.stopPropagation()} className="shrink-0">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              className=" opacity-0 group-hover/primary:opacity-100 transition-opacity data-[state=open]:opacity-100! data-[state=open]:bg-primary-200 rounded-full">
              <MoreVertical />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => onEdit(row)}>
              <SquarePen />
              Edit
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onArchive(row.id)}>
              <Archive />
              Archive
            </DropdownMenuItem>
            <DropdownMenuItem variant="destructive" onClick={() => onDelete(row.id)}>
              <Trash2 />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  )
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
  const utils = api.useUtils()

  // Dock state
  const isDocked = useEffectiveDockState()
  const dockedWidth = useDockStore((state) => state.dockedWidth)
  const setDockedWidth = useDockStore((state) => state.setDockedWidth)
  const minWidth = useDockStore((state) => state.minWidth)
  const maxWidth = useDockStore((state) => state.maxWidth)

  // Get data from context
  const { resource, entityDefinitionId, customFields, isLoadingResource, isLoadingFields } =
    useEntityRecords()

  // State
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false)
  const [editingInstance, setEditingInstance] = useState<EntityRow | null>(null)
  const [selectedRowIds, setSelectedRowIds] = useState<Set<string>>(new Set())
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({})

  // Drawer state
  const [selectedInstance, setSelectedInstance] = useState<EntityRow | null>(null)
  const [isDrawerOpen, setIsDrawerOpen] = useState(false)

  // Confirm dialogs
  const [confirmDelete, ConfirmDeleteDialog] = useConfirm()
  const [confirmArchive, ConfirmArchiveDialog] = useConfirm()

  // Custom field dialog state
  const [isFieldDialogOpen, setIsFieldDialogOpen] = useState(false)

  // Bulk update dialog state
  const [isBulkUpdateDialogOpen, setIsBulkUpdateDialogOpen] = useState(false)

  // Workflow dialog state
  const [isWorkflowDialogOpen, setIsWorkflowDialogOpen] = useState(false)

  // Custom field mutations
  const { create: createField } = useCustomField({
    modelType: 'entity',
    entityDefinitionId,
  })

  // Page size for infinite query
  const PAGE_SIZE = 100

  // Fetch entity instances with infinite query for pagination
  const {
    data,
    isLoading: instancesLoading,
    isFetchingNextPage,
    hasNextPage,
    fetchNextPage,
    refetch,
  } = api.entityInstance.list.useInfiniteQuery(
    { entityDefinitionId: entityDefinitionId ?? '', includeArchived: false, limit: PAGE_SIZE },
    {
      enabled: !!entityDefinitionId,
      getNextPageParam: (lastPage) => lastPage?.nextCursor ?? null,
    }
  )

  // Flatten pages to get all instances
  const rawInstances = useMemo(() => {
    return data?.pages?.flatMap((page) => page.items) ?? []
  }, [data])

  // Transform instances to have customFieldValues for column compatibility
  const instances: EntityRow[] = useMemo(() => {
    return rawInstances.map((instance) => ({
      id: instance.id,
      entityDefinitionId: instance.entityDefinitionId,
      createdAt: instance.createdAt,
      updatedAt: instance.updatedAt,
      archivedAt: instance.archivedAt,
      // Normalize to customFieldValues format for column helpers
      customFieldValues: instance.values.map((v) => ({
        fieldId: v.fieldId,
        value: v.value,
      })),
      // Keep original for dialog
      _originalValues: instance.values,
    }))
  }, [rawInstances])

  /**
   * Handle scrolling to bottom - load more data
   */
  const handleScrollToBottom = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage && !instancesLoading) {
      fetchNextPage()
    }
  }, [hasNextPage, isFetchingNextPage, instancesLoading, fetchNextPage])

  // Row IDs for syncer
  const rowIds = useMemo(() => instances.map((i) => i.id), [instances])

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

  // Get store setValues for hydration
  const setValues = useCustomFieldValueStore((s) => s.setValues)

  // Hydrate store with values from API response
  // This ensures values are available immediately without waiting for syncer fetch
  useEffect(() => {
    if (!entityDefinitionId || rawInstances.length === 0) return

    const entries: Array<{ key: string; value: unknown }> = []
    for (const instance of rawInstances) {
      for (const v of instance.values) {
        // Unwrap {data: ...} wrapper if present
        const rawValue =
          v.value && typeof v.value === 'object' && 'data' in (v.value as object)
            ? (v.value as { data: unknown }).data
            : v.value
        entries.push({
          key: buildValueKey('entity', instance.id, v.fieldId, entityDefinitionId),
          value: rawValue,
        })
      }
    }

    if (entries.length > 0) {
      setValues(entries)
    }
  }, [rawInstances, entityDefinitionId, setValues])

  /**
   * Sync selectedInstance with fresh data when instances changes
   * This ensures drawer shows updated data after workflow completion or inline edits
   */
  useEffect(() => {
    if (selectedInstance && instances.length > 0) {
      const freshInstance = instances.find((i) => i.id === selectedInstance.id)
      if (freshInstance) {
        const currentValuesJson = JSON.stringify(selectedInstance._originalValues)
        const freshValuesJson = JSON.stringify(freshInstance._originalValues)
        if (currentValuesJson !== freshValuesJson) {
          setSelectedInstance(freshInstance)
        }
      }
    }
  }, [instances, selectedInstance])

  // Archive mutation
  const archiveInstance = api.entityInstance.archive.useMutation({
    onSuccess: () => {
      utils.entityInstance.list.invalidate()
    },
    onError: (error) => {
      toastError({ title: 'Failed to archive', description: error.message })
    },
  })

  // Delete mutation
  const deleteInstance = api.entityInstance.delete.useMutation({
    onSuccess: () => {
      utils.entityInstance.list.invalidate()
    },
    onError: (error) => {
      toastError({ title: 'Failed to delete', description: error.message })
    },
  })

  // Bulk delete mutation
  const bulkDeleteInstances = api.entityInstance.bulkDelete.useMutation({
    onSuccess: () => {
      utils.entityInstance.list.invalidate()
      setSelectedRowIds(new Set())
    },
    onError: (error) => {
      toastError({ title: 'Failed to delete', description: error.message })
    },
  })

  // Bulk archive mutation
  const bulkArchiveInstances = api.entityInstance.bulkArchive.useMutation({
    onSuccess: () => {
      utils.entityInstance.list.invalidate()
      setSelectedRowIds(new Set())
    },
    onError: (error) => {
      toastError({ title: 'Failed to archive', description: error.message })
    },
  })

  // Cell value mutation for inline editing
  const setFieldValue = api.customField.setValue.useMutation({
    onSuccess: () => {
      utils.entityInstance.list.invalidate({ entityDefinitionId: entityDefinitionId ?? '' })
    },
    onError: (error) => {
      toastError({ title: 'Failed to update field', description: error.message })
    },
  })

  /**
   * Handle archive action with confirmation
   */
  const handleArchive = useCallback(
    async (instanceId: string) => {
      const confirmed = await confirmArchive({
        title: `Archive ${resource?.label ?? 'Record'}`,
        description: `Are you sure you want to archive this ${resource?.label?.toLowerCase() ?? 'record'}? You can restore it later.`,
        confirmText: 'Archive',
        cancelText: 'Cancel',
        destructive: false,
      })
      if (confirmed) {
        archiveInstance.mutate({ id: instanceId })
      }
    },
    [confirmArchive, resource?.label, archiveInstance]
  )

  /**
   * Handle delete action with confirmation
   */
  const handleDelete = useCallback(
    async (instanceId: string) => {
      const confirmed = await confirmDelete({
        title: `Delete ${resource?.label ?? 'Record'}`,
        description: `Are you sure you want to permanently delete this ${resource?.label?.toLowerCase() ?? 'record'}? This action cannot be undone.`,
        confirmText: 'Delete',
        cancelText: 'Cancel',
        destructive: true,
      })
      if (confirmed) {
        deleteInstance.mutate({ id: instanceId })
      }
    },
    [confirmDelete, resource?.label, deleteInstance]
  )

  /**
   * Handle bulk delete action with confirmation
   */
  const handleBulkDelete = useCallback(
    async (rows: EntityRow[]) => {
      const count = rows.length
      const confirmed = await confirmDelete({
        title: `Delete ${count} ${count === 1 ? resource?.label : resource?.plural}`,
        description: `Are you sure you want to permanently delete ${count} ${count === 1 ? resource?.label?.toLowerCase() : resource?.plural?.toLowerCase()}? This action cannot be undone.`,
        confirmText: `Delete ${count} ${count === 1 ? resource?.label : resource?.plural}`,
        cancelText: 'Cancel',
        destructive: true,
      })
      if (confirmed) {
        await bulkDeleteInstances.mutateAsync({ ids: rows.map((r) => r.id) })
      }
    },
    [confirmDelete, resource?.label, resource?.plural, bulkDeleteInstances]
  )

  /**
   * Handle bulk archive action with confirmation
   */
  const handleBulkArchive = useCallback(
    async (rows: EntityRow[]) => {
      const count = rows.length
      const confirmed = await confirmArchive({
        title: `Archive ${count} ${count === 1 ? resource?.label : resource?.plural}`,
        description: `Are you sure you want to archive ${count} ${count === 1 ? resource?.label?.toLowerCase() : resource?.plural?.toLowerCase()}? You can restore them later.`,
        confirmText: 'Archive',
        cancelText: 'Cancel',
        destructive: false,
      })
      if (confirmed) {
        await bulkArchiveInstances.mutateAsync({ ids: rows.map((r) => r.id) })
      }
    },
    [confirmArchive, resource?.label, resource?.plural, bulkArchiveInstances]
  )

  /**
   * Handle opening drawer from primary display cell
   */
  const handleOpenDrawer = useCallback((row: EntityRow) => {
    setSelectedInstance(row)
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
      setSelectedInstance(null)
    }
  }, [])

  /**
   * Handle delete from drawer with confirmation
   */
  const handleDrawerDelete = useCallback(
    async (instanceId: string) => {
      const confirmed = await confirmDelete({
        title: `Delete ${resource?.label ?? 'Record'}`,
        description: `Are you sure you want to permanently delete this ${resource?.label?.toLowerCase() ?? 'record'}? This action cannot be undone.`,
        confirmText: 'Delete',
        cancelText: 'Cancel',
        destructive: true,
      })
      if (confirmed) {
        deleteInstance.mutate({ id: instanceId })
        setIsDrawerOpen(false)
        setSelectedInstance(null)
      }
    },
    [confirmDelete, resource?.label, deleteInstance]
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
    refetch()
  }, [refetch])

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
   * Handle saving a new custom field
   */
  const handleSaveField = useCallback(
    async (fieldData: any) => {
      await createField.mutateAsync({
        ...fieldData,
        modelType: 'entity',
        entityDefinitionId,
      })
      // Invalidate the query used by EntityRecordsProvider to refresh the table columns
      utils.customField.getByEntityDefinition.invalidate({ entityDefinitionId })
    },
    [createField, entityDefinitionId, utils]
  )

  /**
   * Create column for entity instance field
   * Uses getValue from syncer for reactive updates when drawer edits values
   */
  const createEntityFieldColumn = useCallback(
    (field: (typeof customFields)[0]): ExtendedColumnDef<EntityRow> => {
      // Use RelationshipCell for RELATIONSHIP type
      if (field.type === 'RELATIONSHIP') {
        return {
          id: `field_${field.id}`,
          accessorFn: (row) => getValue(row.id, field.id),
          header: field.name,
          columnType: 'text',
          fieldType: field.type,
          icon: getIconForFieldType(field.type),
          enableSorting: false, // Relationships can't be sorted directly
          enableFiltering: false,
          enableResizing: true,
          minSize: 100,
          size: 180,
          cell: ({ row }) => {
            const value = getValue(row.original.id, field.id)
            return <RelationshipCell field={field} value={value} />
          },
        }
      }

      // Build default formatting from field options for CURRENCY type
      const fieldOptions = field.options as { currency?: Record<string, unknown> } | undefined
      const defaultFormatting =
        field.type === 'CURRENCY' && fieldOptions?.currency
          ? { type: 'currency' as const, ...fieldOptions.currency }
          : undefined

      const columnId = `field_${field.id}`
      const enumOptions = field.options?.options ?? field.enumValues ?? []

      // Default column for other types
      // Cell renderers (FormattedCell) handle their own padding
      // Uses getValue from syncer for reactive updates
      return {
        id: columnId,
        accessorFn: (row) => getValue(row.id, field.id),
        header: field.name,
        columnType: mapFieldTypeToColumnType(field.type),
        fieldType: field.type,
        defaultFormatting,
        icon: getIconForFieldType(field.type),
        enableSorting: true,
        enableFiltering: true,
        enableResizing: true,
        minSize: 100,
        size: 150,
        cell: ({ row }) => {
          const value = getValue(row.original.id, field.id)
          return (
            <FormattedCell
              value={value}
              fieldType={field.type}
              columnId={columnId}
              options={enumOptions}
            />
          )
        },
      }
    },
    [getValue]
  )

  /**
   * Generate columns from custom field definitions
   * Primary display column is first with integrated actions
   */
  const columns: ExtendedColumnDef<EntityRow>[] = useMemo(() => {
    // Sort fields by position
    const sortedFields = [...customFields]
      .filter((f) => f.active !== false)
      .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))

    // Find primary display field
    const primaryFieldId = resource?.display.primaryDisplayField?.id
    const primaryField = primaryFieldId
      ? sortedFields.find((f) => f.id === primaryFieldId)
      : sortedFields[0] // Fallback to first field

    // Create primary display column with integrated actions
    // Uses getValue from syncer for reactive updates
    const primaryColumn: ExtendedColumnDef<EntityRow> | null = primaryField
      ? {
          id: `field_${primaryField.id}`,
          accessorFn: (row) => getValue(row.id, primaryField.id),
          header: primaryField.name,
          defaultPinned: true,
          columnType: 'text',
          fieldType: primaryField.type,
          icon: getIconForFieldType(primaryField.type),
          enableSorting: true,
          enableResizing: true,
          enableHiding: false, // Primary column cannot be hidden
          minSize: 200,
          size: 300,
          cell: ({ row }) => {
            const value = getValue(row.original.id, primaryField.id)
            return (
              <PrimaryDisplayCell
                row={row.original}
                value={value}
                onOpenDrawer={handleOpenDrawer}
                onEdit={handleOpenEditDialog}
                onArchive={handleArchive}
                onDelete={handleDelete}
              />
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
    resource?.display.primaryDisplayField?.id,
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
   * Get selected instances for bulk update dialog
   */
  const selectedInstances = useMemo(() => {
    return instances.filter((instance) => selectedRowIds.has(instance.id))
  }, [instances, selectedRowIds])

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
        await setFieldValue.mutateAsync({
          entityId: rowId,
          fieldId,
          value: value === null ? null : { data: value },
          modelType: ModelTypes.ENTITY,
        })
      },
    }),
    [customFields, getValue, setFieldValue, entityDefinitionId]
  )

  /**
   * Prepare entity definition with custom fields for dialog
   */
  const entityDefinitionForDialog = useMemo(() => {
    if (!resource || !entityDefinitionId) return null
    return {
      id: entityDefinitionId,
      singular: resource.label,
      plural: resource.plural,
      icon: resource.icon,
      color: resource.color,
      customFields: customFields.map((f) => ({
        ...f,
        type: f.type as FieldType,
      })),
    }
  }, [resource, entityDefinitionId, customFields])

  /**
   * Prepare editing instance for dialog
   * Looks up field info from customFields since _originalValues may not include it
   */
  const editingInstanceForDialog = useMemo(() => {
    if (!editingInstance) return null

    // Create a lookup map for custom fields
    const fieldMap = new Map(customFields.map((f) => [f.id, f]))

    return {
      id: editingInstance.id,
      entityDefinitionId: editingInstance.entityDefinitionId,
      values: editingInstance._originalValues
        .map((v) => {
          const field = fieldMap.get(v.fieldId)
          if (!field) return null
          return {
            id: v.id,
            fieldId: v.fieldId,
            value: v.value,
            field: {
              id: field.id,
              name: field.name,
              type: field.type as FieldType,
            },
          }
        })
        .filter(Boolean) as Array<{
        id: string
        fieldId: string
        value: unknown
        field: { id: string; name: string; type: FieldType }
      }>,
    }
  }, [editingInstance, customFields])

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
  if (isLoadingResource) {
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
    isDocked && isDrawerOpen && selectedInstance ? (
      <EntityRecordDrawer
        open={isDrawerOpen}
        onOpenChange={handleDrawerOpenChange}
        instance={selectedInstance}
        onDeleteInstance={handleDrawerDelete}
        onMutationSuccess={refetch}
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
          <div className="flex-1 overflow-hidden rounded-lg bg-white dark:bg-muted/10">
            <DynamicTable
              data={instances}
              className="h-full flex-1"
              tableId={`entity-${entityDefinitionId}`}
              bulkActions={bulkActions}
              enableSearch
              columns={columns}
              enableSorting
              enableFiltering
              isLoading={instancesLoading || isLoadingFields}
              onRowSelectionChange={handleRowSelectionChange}
              rowSelection={selectedRowIds}
              showRowNumbers={false}
              importHref={`/app/custom/${slug}/import`}
              onColumnVisibilityChange={setColumnVisibility}
              onScrollToBottom={handleScrollToBottom}
              emptyState={<EmptyStateComponent />}
              headerActions={
                <HeaderActionsDropdown onNewField={() => setIsFieldDialogOpen(true)} />
              }
              cellSelection={cellSelectionConfig}>
              <DynamicTableFooter>
                <div className="flex items-center justify-between px-4 py-2 text-sm text-muted-foreground">
                  <div>
                    {instances.length}{' '}
                    {instances.length === 1
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
            </DynamicTable>
          </div>
        </MainPageContent>
      </MainPage>

      {/* Create/Edit Dialog */}
      {entityDefinitionForDialog && (
        <EntityInstanceDialog
          open={isCreateDialogOpen}
          onOpenChange={handleDialogOpenChange}
          entityDefinition={entityDefinitionForDialog}
          editingInstance={editingInstanceForDialog}
          onSaved={handleDialogSaved}
        />
      )}

      {/* Bulk Update Dialog */}
      {entityDefinitionForDialog && (
        <BulkUpdateEntityInstanceDialog
          open={isBulkUpdateDialogOpen}
          onOpenChange={setIsBulkUpdateDialogOpen}
          selectedInstances={selectedInstances}
          entityDefinition={entityDefinitionForDialog}
          onSaved={() => {
            refetch()
            setSelectedRowIds(new Set())
          }}
        />
      )}

      {/* Custom Field Dialog */}
      <CustomFieldDialog
        open={isFieldDialogOpen}
        onOpenChange={setIsFieldDialogOpen}
        onSave={handleSaveField}
        isPending={createField.isPending}
        currentResourceId={`entity_${slug}`}
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
          refetch()
        }}
      />

      <ConfirmDeleteDialog />
      <ConfirmArchiveDialog />

      {/* Entity Record Drawer - only render overlay when NOT docked */}
      {!isDocked && (
        <EntityRecordDrawer
          open={isDrawerOpen}
          onOpenChange={handleDrawerOpenChange}
          instance={selectedInstance}
          onDeleteInstance={handleDrawerDelete}
          onMutationSuccess={refetch}
        />
      )}
    </>
  )
}
