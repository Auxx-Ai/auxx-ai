// apps/web/src/components/manufacturing/parts/parts-content.tsx
'use client'

import type { PartEntity as Part } from '@auxx/database/models'
import { Button } from '@auxx/ui/components/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@auxx/ui/components/dropdown-menu'
import {
  MainPage,
  MainPageBreadcrumb,
  MainPageBreadcrumbItem,
  MainPageContent,
  MainPageHeader,
} from '@auxx/ui/components/main-page'
import { toastError, toastSuccess } from '@auxx/ui/components/toast'
import { Calculator, Package, PackagePlus, Plus, Trash2, Upload } from 'lucide-react'
import { parseAsBoolean, parseAsString, useQueryState } from 'nuqs'
import { useCallback, useMemo, useState } from 'react'
import { CSVColumnMapper } from '~/app/(protected)/app/parts/_components/column-mapper'
import { DynamicTable, DynamicTableFooter } from '~/components/dynamic-table'
import { EmptyState } from '~/components/global/empty-state'
import { toRecordId } from '~/components/resources'
import { useConfirm } from '~/hooks/use-confirm'
import { useEffectiveDockState } from '~/hooks/use-effective-dock-state'
import { useDockStore } from '~/stores/dock-store'
import { api } from '~/trpc/react'
import { PartFormDialog } from './part-form-dialog'
import { createPartColumns, type PartRow } from './parts-columns'
import { PartsDrawer } from './parts-drawer'

/** Parts content main component */
export function PartsContent() {
  const utils = api.useUtils()

  // Dock state for drawer
  const isDocked = useEffectiveDockState()
  const dockedWidth = useDockStore((state) => state.dockedWidth)
  const setDockedWidth = useDockStore((state) => state.setDockedWidth)
  const minWidth = useDockStore((state) => state.minWidth)
  const maxWidth = useDockStore((state) => state.maxWidth)

  // Drawer state - synced with URL for refresh persistence
  const [selectedPartId, setSelectedPartId] = useQueryState('p', parseAsString.withDefault(''))
  // Derive drawer open state from whether a part is selected
  const isDrawerOpen = !!selectedPartId
  const setIsDrawerOpen = useCallback(
    (open: boolean) => {
      if (!open) setSelectedPartId(null)
    },
    [setSelectedPartId]
  )

  // Convert partId to recordId for PartsDrawer
  const selectedRecordId = useMemo(
    () => (selectedPartId ? toRecordId('part', selectedPartId) : null),
    [selectedPartId]
  )

  // Dialog state - controlled via URL query param for kbar support
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useQueryState(
    'create',
    parseAsBoolean.withDefault(false)
  )
  const [editingPart, setEditingPart] = useState<Part | null>(null)

  // Import dialog state
  const [isImportDialogOpen, setIsImportDialogOpen] = useState(false)

  // Row selection for bulk actions
  const [selectedRowIds, setSelectedRowIds] = useState<Set<string>>(new Set())

  // Confirm dialogs
  const [confirmDelete, ConfirmDeleteDialog] = useConfirm()

  // Fetch parts
  const { data: partsData, isLoading, refetch } = api.part.all.useQuery({})
  const parts = partsData?.parts ?? []

  // Transform to table rows
  const rows: PartRow[] = useMemo(() => {
    return parts.map((part) => ({
      id: part.id,
      title: part.title,
      sku: part.sku,
      description: part.description,
      category: part.category,
      hsCode: part.hsCode,
      shopifyProductLinkId: part.shopifyProductLinkId,
      cost: part.cost,
      inventory: part.inventory ?? null,
      createdAt: part.createdAt,
      updatedAt: part.updatedAt,
    }))
  }, [parts])

  // Delete mutation
  const deletePart = api.part.delete.useMutation({
    onSuccess: () => {
      utils.part.all.invalidate()
    },
    onError: (error) => {
      toastError({ title: 'Failed to delete', description: error.message })
    },
  })

  // Recalculate all costs mutation
  const calculateAllCosts = api.part.calculateAllCosts.useMutation({
    onSuccess: () => {
      toastSuccess({ title: 'Costs recalculated successfully' })
      utils.part.all.invalidate()
    },
    onError: (error) => {
      toastError({ title: 'Error recalculating costs', description: error.message })
    },
  })

  // Recalculate single part cost mutation
  const calculateCost = api.part.calculateCost.useMutation({
    onSuccess: () => {
      toastSuccess({ title: 'Cost recalculated' })
      utils.part.all.invalidate()
    },
    onError: (error) => {
      toastError({ title: 'Error recalculating cost', description: error.message })
    },
  })

  /** Handle delete action with confirmation */
  const handleDelete = useCallback(
    async (partId: string) => {
      const confirmed = await confirmDelete({
        title: 'Delete Part',
        description:
          'Are you sure you want to delete this part? This action cannot be undone and will remove all associated inventory data.',
        confirmText: 'Delete',
        cancelText: 'Cancel',
        destructive: true,
      })
      if (confirmed) {
        deletePart.mutate({ id: partId })
        if (selectedPartId === partId) {
          setSelectedPartId(null)
        }
      }
    },
    [confirmDelete, deletePart, selectedPartId, setSelectedPartId]
  )

  /** Handle bulk delete with confirmation */
  const handleBulkDelete = useCallback(
    async (rowsToDelete: PartRow[]) => {
      const count = rowsToDelete.length
      const confirmed = await confirmDelete({
        title: `Delete ${count} Part${count > 1 ? 's' : ''}`,
        description: `Are you sure you want to delete ${count} part${count > 1 ? 's' : ''}? This cannot be undone.`,
        confirmText: `Delete ${count} Part${count > 1 ? 's' : ''}`,
        cancelText: 'Cancel',
        destructive: true,
      })
      if (confirmed) {
        for (const row of rowsToDelete) {
          await deletePart.mutateAsync({ id: row.id })
        }
        setSelectedRowIds(new Set())
      }
    },
    [confirmDelete, deletePart]
  )

  /** Handle opening drawer - sets URL param which opens drawer */
  const handleOpenDrawer = useCallback(
    (row: PartRow) => {
      setSelectedPartId(row.id)
    },
    [setSelectedPartId]
  )

  /** Handle opening edit dialog */
  const handleOpenEditDialog = useCallback(
    (row: PartRow) => {
      const part = parts.find((p) => p.id === row.id)
      if (part) {
        setEditingPart(part as Part)
        setIsCreateDialogOpen(true)
      }
    },
    [parts]
  )

  /** Handle recalculate cost for single part */
  const handleRecalculateCost = useCallback(
    (partId: string) => {
      calculateCost.mutate({ id: partId })
    },
    [calculateCost]
  )

  /** Handle row selection change */
  const handleRowSelectionChange = useCallback((selectedRows: Set<string>) => {
    setSelectedRowIds(selectedRows)
  }, [])

  /** Handle dialog open change */
  const handleDialogOpenChange = useCallback((open: boolean) => {
    setIsCreateDialogOpen(open)
    if (!open) {
      setEditingPart(null)
    }
  }, [])

  /** Handle dialog saved */
  const handleDialogSaved = useCallback(() => {
    setEditingPart(null)
    refetch()
  }, [refetch])

  /** Define columns using createPartColumns */
  const columns = useMemo(
    () =>
      createPartColumns({
        onViewDetails: handleOpenDrawer,
        onEdit: handleOpenEditDialog,
        onDelete: handleDelete,
        onRecalculateCost: handleRecalculateCost,
      }),
    [handleOpenDrawer, handleOpenEditDialog, handleDelete, handleRecalculateCost]
  )

  /** Define bulk actions */
  const bulkActions = useMemo(
    () => [
      {
        label: 'Delete',
        icon: Trash2,
        variant: 'destructive' as const,
        action: (selectedRows: PartRow[]) => handleBulkDelete(selectedRows),
      },
    ],
    [handleBulkDelete]
  )

  /** Empty state component */
  const EmptyStateComponent = useCallback(
    () => (
      <div className='flex h-full items-center justify-center'>
        <EmptyState
          icon={Package}
          title='No parts found'
          description='Create your first part to get started'
          button={
            <Button size='sm' variant='outline' onClick={() => setIsCreateDialogOpen(true)}>
              <Plus />
              Create Part
            </Button>
          }
        />
      </div>
    ),
    []
  )

  // Build docked panel content
  const dockedPanel =
    isDocked && isDrawerOpen && selectedRecordId ? (
      <PartsDrawer
        open={isDrawerOpen}
        onOpenChange={setIsDrawerOpen}
        recordId={selectedRecordId}
        onDelete={handleDelete}
        onEdit={(part) => {
          setEditingPart(part)
          setIsCreateDialogOpen(true)
        }}
      />
    ) : undefined

  return (
    <>
      <MainPage>
        <MainPageHeader
          action={
            <div className='flex items-center gap-2'>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button size='sm'>
                    <PackagePlus /> Create Part
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align='end'>
                  <DropdownMenuItem onClick={() => setIsCreateDialogOpen(true)}>
                    <PackagePlus />
                    Create Part
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setIsImportDialogOpen(true)}>
                    <Upload />
                    Import Parts
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => calculateAllCosts.mutate()}
                    disabled={calculateAllCosts.isPending}>
                    <Calculator />
                    Recalculate Costs
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          }>
          <MainPageBreadcrumb>
            <MainPageBreadcrumbItem
              title='Parts'
              href='/app/parts'
              icon={<Package className='size-4' />}
              last
            />
          </MainPageBreadcrumb>
        </MainPageHeader>
        <MainPageContent
          dockedPanel={dockedPanel}
          dockedPanelWidth={dockedWidth}
          onDockedPanelWidthChange={setDockedWidth}
          dockedPanelMinWidth={minWidth}
          dockedPanelMaxWidth={maxWidth}>
          <div className='flex-1 overflow-hidden rounded-lg bg-white dark:bg-muted/10'>
            <DynamicTable
              data={rows}
              className='h-full flex-1'
              tableId='parts-table'
              entityLabel='Part'
              bulkActions={bulkActions}
              enableSearch
              columns={columns}
              enableSorting
              enableFiltering
              isLoading={isLoading}
              onRowSelectionChange={handleRowSelectionChange}
              rowSelection={selectedRowIds}
              showRowNumbers={false}
              onAddNew={() => setIsCreateDialogOpen(true)}
              emptyState={<EmptyStateComponent />}>
              <DynamicTableFooter>
                <div className='flex items-center justify-between px-4 py-2 text-sm'>
                  <div>
                    {rows.length} {rows.length === 1 ? 'part' : 'parts'}
                  </div>
                </div>
              </DynamicTableFooter>
            </DynamicTable>
          </div>
        </MainPageContent>
      </MainPage>

      {/* Create/Edit Dialog */}
      <PartFormDialog
        open={isCreateDialogOpen}
        onOpenChange={handleDialogOpenChange}
        part={editingPart}
        onSuccess={handleDialogSaved}
      />

      {/* Import Dialog */}
      <CSVColumnMapper
        isOpen={isImportDialogOpen}
        setIsOpen={setIsImportDialogOpen}
        onDataImported={() => {
          refetch()
        }}
      />

      <ConfirmDeleteDialog />

      {/* Parts Drawer - only render overlay when NOT docked */}
      {!isDocked && (
        <PartsDrawer
          open={isDrawerOpen}
          onOpenChange={setIsDrawerOpen}
          recordId={selectedRecordId}
          onDelete={handleDelete}
          onEdit={(part) => {
            setEditingPart(part)
            setIsCreateDialogOpen(true)
          }}
        />
      )}
    </>
  )
}
