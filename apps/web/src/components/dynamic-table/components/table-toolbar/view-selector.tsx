// apps/web/src/components/dynamic-table/components/table-toolbar/view-selector.tsx

'use client'

import { useState } from 'react'
import type {
  VisibilityState,
  ColumnOrderState,
  ColumnSizingState,
  ColumnPinningState,
  SortingState,
} from '@tanstack/react-table'
import {
  ChevronDown,
  MoreHorizontal,
  Lock,
  Check,
  Pin,
  Plus,
  Copy,
  Edit,
  Trash,
  RotateCcw,
  Save,
  Table2,
  LayoutGrid,
} from 'lucide-react'
import { Button } from '@auxx/ui/components/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@auxx/ui/components/dropdown-menu'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@auxx/ui/components/command'
import { Popover, PopoverContent, PopoverTrigger } from '@auxx/ui/components/popover'
import { toastSuccess, toastError } from '@auxx/ui/components/toast'
import type { TableView, ViewAction, ViewConfig } from '../../types'
import { cn } from '@auxx/ui/lib/utils'
import { useConfirm } from '~/hooks/use-confirm'
import { Tooltip } from '~/components/global/tooltip'
import { CreateViewDialog, RenameViewDialog } from '../dialogs'
import { useViewMutations } from '../../hooks/use-view-mutations'

/** Select field for kanban grouping */
interface SelectField {
  id: string
  name: string
  options?: { options?: Array<{ id: string; label: string; color?: string }> }
}

interface ViewSelectorProps {
  views: TableView[]
  activeView: TableView | null
  tableId: string
  onViewSelect: (viewId: string | null) => void
  isSaving?: boolean
  hasUnsavedChanges?: boolean
  onSave?: () => Promise<void> | void
  onReset?: () => void
  /** SINGLE_SELECT fields available for kanban grouping */
  selectFields?: SelectField[]
  /** Entity definition ID for field creation */
  entityDefinitionId?: string
  /** Current filters to pre-populate when creating a new view */
  currentFilters?: ViewConfig['filters']
  /** External control to open the create dialog */
  openCreateDialog?: boolean
  /** Callback when create dialog open state changes */
  onCreateDialogChange?: (open: boolean) => void
  /** Table instance to capture state from when creating view */
  table: import('@tanstack/react-table').Table<any>
}

/**
 * View selector dropdown with management options
 */
export function ViewSelector({
  views,
  activeView,
  tableId,
  onViewSelect,
  isSaving = false,
  hasUnsavedChanges = false,
  onSave,
  onReset,
  selectFields,
  entityDefinitionId,
  currentFilters,
  openCreateDialog,
  onCreateDialogChange,
  table,
}: ViewSelectorProps) {
  const [searchTerm, setSearchTerm] = useState('')
  const [showCreateDialog, setShowCreateDialog] = useState(false)
  const [showRenameDialog, setShowRenameDialog] = useState(false)
  const [open, setOpen] = useState(false)

  // Capture table state only when dialog opens
  const [capturedTableState, setCapturedTableState] = useState<{
    columnVisibility: VisibilityState
    columnOrder: ColumnOrderState
    columnSizing: ColumnSizingState
    columnPinning: ColumnPinningState
    sorting: SortingState
  } | undefined>(undefined)
  const [confirmDelete, ConfirmDeleteDialog] = useConfirm()

  // Sync external control with internal state
  const isCreateDialogOpen = openCreateDialog ?? showCreateDialog
  const handleCreateDialogChange = (open: boolean) => {
    // Capture table state when opening dialog
    if (open) {
      const state = table.getState()
      setCapturedTableState({
        columnVisibility: state.columnVisibility,
        columnOrder: state.columnOrder,
        columnSizing: state.columnSizing,
        columnPinning: state.columnPinning,
        sorting: state.sorting,
      })
    } else {
      // Clear captured state when closing
      setCapturedTableState(undefined)
    }

    setShowCreateDialog(open)
    onCreateDialogChange?.(open)
  }

  // View mutations hook
  const { duplicateView, deleteView, setDefaultView } = useViewMutations(tableId, onViewSelect)

  // Filter views based on search
  const filteredViews = views.filter((view) =>
    view.name.toLowerCase().includes(searchTerm.toLowerCase())
  )

  // Handle view actions
  const handleViewAction = async (viewId: string, action: ViewAction) => {
    const view = views.find((v) => v.id === viewId)
    if (!view) return

    switch (action) {
      case 'duplicate':
        const duplicateName = `${view.name} (Copy)`
        await duplicateView.mutateAsync({ id: viewId, name: duplicateName })
        break

      case 'rename':
        setShowRenameDialog(true)
        break

      case 'delete':
        const isDefault = view.isDefault
        const deleteDescription = isDefault
          ? `Are you sure you want to delete "${view.name}"? This is your default view. After deletion, you'll be switched to "All rows".`
          : `Are you sure you want to delete "${view.name}"? This action cannot be undone.`
        const confirmed = await confirmDelete({
          title: 'Delete View',
          description: deleteDescription,
          confirmText: 'Delete',
          cancelText: 'Cancel',
          destructive: true,
        })
        if (confirmed) {
          await deleteView.mutateAsync({ id: viewId })
          // If deleting active view, switch to session (All rows)
          if (activeView?.id === viewId) {
            onViewSelect(null)
          }
        }
        break

      case 'setDefault':
        await setDefaultView.mutateAsync({ tableId, viewId })
        break
    }
  }

  const handleSave = async () => {
    if (!activeView || !onSave) {
      return
    }

    try {
      await onSave()
      toastSuccess({ title: 'View saved successfully' })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      toastError({ title: 'Failed to save view', description: message })
    }
  }

  const isDefaultView = activeView?.isDefault || false
  const canSave = Boolean(activeView && hasUnsavedChanges && !isSaving)
  const showUnsavedBadge = Boolean(activeView && hasUnsavedChanges && !isSaving)

  return (
    <>
      <div className="flex">
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className={cn('text-xs', activeView && 'rounded-r-none')}>
              {activeView ? (
                <>
                  <span className="max-w-40 truncate">{activeView.name}</span>
                </>
              ) : (
                <>
                  <Lock className="size-3.5!" />
                  <span>All rows</span>
                </>
              )}
              <ChevronDown className="size-3 text-muted-foreground" />
            </Button>
          </PopoverTrigger>

          <PopoverContent className="w-[250px] p-0" align="start">
            <Command>
              <CommandInput
                placeholder="Search views..."
                value={searchTerm}
                onValueChange={setSearchTerm}
              />
              <CommandList>
                <CommandEmpty>No views found.</CommandEmpty>

                {/* Default view */}
                <CommandGroup>
                  <CommandItem
                    onSelect={() => {
                      onViewSelect(null)
                      setOpen(false)
                    }}>
                    <Lock className="size-3.5!" />
                    <span className="flex-1">All rows</span>
                    {!activeView && <Check className="size-4 ml-auto" />}
                  </CommandItem>
                </CommandGroup>

                {/* User views */}
                {filteredViews.length > 0 && (
                  <>
                    <CommandSeparator />
                    <CommandGroup heading="Saved views">
                      {filteredViews.map((view) => (
                        <CommandItem
                          key={view.id}
                          value={view.name}
                          onSelect={() => {
                            onViewSelect(view.id)
                            setOpen(false)
                          }}>
                          {/* View type icon */}
                          {view.config.viewType === 'kanban' ? (
                            <LayoutGrid className="size-3.5 text-muted-foreground" />
                          ) : (
                            <Table2 className="size-3.5 text-muted-foreground" />
                          )}
                          <span className="flex-1">{view.name}</span>
                          {activeView?.id === view.id && (
                            <Tooltip content="Active">
                              <Check className="" />
                            </Tooltip>
                          )}
                          {view.isDefault && (
                            <Tooltip content="Default view">
                              <Pin className="size-3 text-muted-foreground" />
                            </Tooltip>
                          )}
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  </>
                )}

                <CommandSeparator />
                <CommandGroup>
                  <CommandItem
                    onSelect={() => {
                      handleCreateDialogChange(true)
                      setOpen(false)
                    }}>
                    <Plus />
                    Create new view
                  </CommandItem>
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>

        {/* View options button */}
        {activeView && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className="px-1 rounded-l-none border-l-0 relative focus:ring-offset-0">
                <MoreHorizontal className="size-3" />
                {showUnsavedBadge && (
                  <span className="absolute bg-info rounded-full -top-2 left-full size-3 -translate-x-1/2"></span>
                )}
              </Button>
            </DropdownMenuTrigger>

            <DropdownMenuContent align="end">
              {activeView && (
                <DropdownMenuItem disabled={!canSave} onClick={handleSave}>
                  <Save />
                  Save
                </DropdownMenuItem>
              )}
              {hasUnsavedChanges && onReset && (
                <DropdownMenuItem onClick={onReset}>
                  <RotateCcw />
                  Reset Changes
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />

              <DropdownMenuItem onClick={() => handleViewAction(activeView.id, 'duplicate')}>
                <Copy />
                Duplicate
              </DropdownMenuItem>

              <DropdownMenuItem onClick={() => handleViewAction(activeView.id, 'rename')}>
                <Edit />
                Rename
              </DropdownMenuItem>

              <DropdownMenuItem
                onClick={() => handleViewAction(activeView.id, 'setDefault')}
                disabled={isDefaultView}>
                <Pin />
                Make Default
              </DropdownMenuItem>

              <DropdownMenuSeparator />

              <DropdownMenuItem
                onClick={() => handleViewAction(activeView.id, 'delete')}
                variant="destructive">
                <Trash />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      {/* Create view dialog */}
      <CreateViewDialog
        open={isCreateDialogOpen}
        onOpenChange={handleCreateDialogChange}
        tableId={tableId}
        views={views}
        selectFields={selectFields}
        entityDefinitionId={entityDefinitionId}
        currentFilters={currentFilters}
        onViewCreated={onViewSelect}
        currentTableState={capturedTableState}
      />

      {/* Rename view dialog */}
      <RenameViewDialog
        open={showRenameDialog}
        onOpenChange={setShowRenameDialog}
        view={activeView}
        tableId={tableId}
      />

      <ConfirmDeleteDialog />
    </>
  )
}
