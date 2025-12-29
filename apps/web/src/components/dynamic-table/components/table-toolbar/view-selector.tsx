// apps/web/src/components/dynamic-table/components/table-toolbar/view-selector.tsx

'use client'

import { useState } from 'react'
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
} from 'lucide-react'
import { Button } from '@auxx/ui/components/button'
import { Input } from '@auxx/ui/components/input'
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@auxx/ui/components/dialog'
import { Label } from '@auxx/ui/components/label'
import { api } from '~/trpc/react'
import { toastSuccess, toastError } from '@auxx/ui/components/toast'
import type { TableView, ViewAction } from '../../types'
import { cn } from '@auxx/ui/lib/utils'
import { Tooltip } from '~/components/global/tooltip'

interface ViewSelectorProps {
  views: TableView[]
  activeView: TableView | null
  tableId: string
  onViewSelect: (viewId: string | null) => void
  isSaving?: boolean
  hasUnsavedChanges?: boolean
  onSave?: () => Promise<void> | void
  onReset?: () => void
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
}: ViewSelectorProps) {
  const [searchTerm, setSearchTerm] = useState('')
  const [showCreateDialog, setShowCreateDialog] = useState(false)
  const [showRenameDialog, setShowRenameDialog] = useState(false)
  const [newViewName, setNewViewName] = useState('')
  const [open, setOpen] = useState(false)

  const utils = api.useUtils()

  // Mutations
  const createView = api.tableView.create.useMutation({
    onSuccess: () => {
      toastSuccess({ description: 'View created successfully' })
      setShowCreateDialog(false)
      setNewViewName('')
      utils.tableView.list.invalidate({ tableId })
    },
    onError: (error) => {
      toastError({ title: 'Failed to create view', description: error.message })
    },
  })

  const updateView = api.tableView.update.useMutation({
    onSuccess: () => {
      toastSuccess({ description: 'View updated successfully' })
      setShowRenameDialog(false)
      setNewViewName('')
      utils.tableView.list.invalidate({ tableId })
    },
    onError: (error) => {
      toastError({ title: 'Failed to update view', description: error.message })
    },
  })

  const deleteView = api.tableView.delete.useMutation({
    onSuccess: () => {
      toastSuccess({ description: 'View deleted successfully' })
      if (activeView?.id === deleteView.variables?.id) {
        onViewSelect(null)
      }
      utils.tableView.list.invalidate({ tableId })
    },
    onError: (error) => {
      toastError({ title: 'Failed to delete view', description: error.message })
    },
  })

  const duplicateView = api.tableView.duplicate.useMutation({
    onSuccess: () => {
      toastSuccess({ description: 'View duplicated successfully' })
      utils.tableView.list.invalidate({ tableId })
    },
    onError: (error) => {
      toastError({ title: 'Failed to duplicate view', description: error.message })
    },
  })

  const setDefaultView = api.tableView.setDefault.useMutation({
    onSuccess: () => {
      toastSuccess({ description: 'Default view updated' })
      utils.tableView.list.invalidate({ tableId })
    },
    onError: (error) => {
      toastError({ title: 'Failed to set default view', description: error.message })
    },
  })

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
        setNewViewName(view.name)
        setShowRenameDialog(true)
        break

      case 'delete':
        if (confirm(`Are you sure you want to delete "${view.name}"?`)) {
          await deleteView.mutateAsync({ id: viewId })
        }
        break

      case 'setDefault':
        await setDefaultView.mutateAsync({ tableId, viewId })
        break
    }
  }

  const handleCreateView = async () => {
    if (!newViewName.trim()) return

    await createView.mutateAsync({
      tableId,
      name: newViewName,
      config: { filters: [], sorting: [], columnVisibility: {}, columnOrder: [], columnSizing: {} },
    })
  }

  const handleRenameView = async () => {
    if (!activeView || !newViewName.trim()) return

    await updateView.mutateAsync({ id: activeView.id, name: newViewName })
  }

  const isDefaultView = activeView?.isDefault || false
  const canSave = Boolean(activeView && hasUnsavedChanges && !isSaving)
  const showUnsavedBadge = Boolean(activeView && hasUnsavedChanges && !isSaving)

  const handleSave = async () => {
    if (!activeView || !onSave) {
      return
    }

    try {
      await onSave()
      toastSuccess({ description: 'View saved successfully' })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      toastError({ title: 'Failed to save view', description: message })
    }
  }

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
                      setShowCreateDialog(true)
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
                variant="destructive"
                disabled={isDefaultView}>
                <Trash />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      {/* Create view dialog */}
      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <DialogContent size="sm" position="tc">
          <DialogHeader>
            <DialogTitle>Create New View</DialogTitle>
            <DialogDescription>
              Create a new view to save your current table configuration
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-2">
            <Input
              id="view-name"
              value={newViewName}
              onChange={(e) => setNewViewName(e.target.value)}
              placeholder="My custom view"
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  handleCreateView()
                }
              }}
            />
          </div>

          <DialogFooter>
            <Button size="sm" variant="ghost" onClick={() => setShowCreateDialog(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleCreateView}
              size="sm"
              variant="outline"
              disabled={!newViewName.trim() || createView.isPending}>
              Create View
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Rename view dialog */}
      <Dialog open={showRenameDialog} onOpenChange={setShowRenameDialog}>
        <DialogContent size="sm" position="tc">
          <DialogHeader>
            <DialogTitle>Rename View</DialogTitle>
            <DialogDescription>Enter a new name for this view</DialogDescription>
          </DialogHeader>

          <div className="grid gap-2">
            <Label htmlFor="rename-view">View name</Label>
            <Input
              id="rename-view"
              value={newViewName}
              onChange={(e) => setNewViewName(e.target.value)}
              placeholder="My custom view"
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  handleRenameView()
                }
              }}
            />
          </div>

          <DialogFooter>
            <Button size="sm" variant="ghost" onClick={() => setShowRenameDialog(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={handleRenameView}
              disabled={!newViewName.trim() || updateView.isPending}>
              Rename View
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
