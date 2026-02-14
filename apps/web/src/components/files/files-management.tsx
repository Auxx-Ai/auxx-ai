// apps/web/src/components/files/files-management.tsx

'use client'

import { Button } from '@auxx/ui/components/button'
import { toastSuccess } from '@auxx/ui/components/toast'
import { cn } from '@auxx/ui/lib/utils'
import {
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  pointerWithin,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import { FolderPlus, Trash2, Upload } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import { type DragDropConfig, DynamicTable } from '~/components/dynamic-table'
import { EmptyState } from '~/components/global/empty-state'
import MailThreadItemDragOverlay from '~/components/mail/mail-thread-item-drag-overlay'
import { useConfirm } from '~/hooks/use-confirm'
import { CreateFolderDialog } from './create-folder-dialog'
import { createFileColumns } from './file-columns'
import { FileDetailDrawer } from './file-detail-drawer'
import { FileDropZone } from './file-drop-zone'
import { FileFilterBar } from './file-filter-bar'
import { FileUploadDialog } from './file-upload-dialog'
import { FilesBreadcrumb } from './files-breadcrumb'
import type { FileItem } from './files-store'
import { useFileSystemStore } from './files-store'
import { useFilesystemContext } from './provider/filesystem-provider'
import { RenameItemDialog } from './rename-item-dialog'

// Helper function removed - now using Maps-based getItemDescendants from store for O(log n) performance

/**
 * Props for FilesManagement component
 */
interface FilesManagementProps {
  /**
   * Mode determines the behavior of the component
   * - 'management': Full file management with upload, delete, etc. (default)
   * - 'selection': File selection mode for dialogs/pickers
   */
  mode?: 'management' | 'selection'

  /**
   * Whether to allow the file detail drawer to open when clicking files
   * Defaults to true in management mode, false in selection mode
   */
  allowFileDetailDrawer?: boolean

  /**
   * Whether to show the header with breadcrumbs and action buttons
   * Defaults to true in management mode, false in selection mode
   */
  showHeader?: boolean

  /**
   * Whether to show upload functionality
   * Defaults to true in management mode, false in selection mode
   */
  showUploadControls?: boolean

  /**
   * Whether to show bulk actions like delete
   * Defaults to true in management mode, false in selection mode
   */
  showBulkActions?: boolean

  /**
   * Whether to allow selecting multiple files in selection mode
   * Defaults to true
   */
  allowMultiple?: boolean

  /**
   * Custom class name for the component
   */
  className?: string

  /**
   * Callback when a file is selected for viewing details.
   * When provided, the drawer is managed externally (parent controls open/close).
   */
  onFileSelect?: (file: FileItem) => void
}

/**
 * Main files management component with integrated upload functionality
 * Provides a unified interface for file and folder operations
 */
export function FilesManagement({
  mode = 'management',
  allowFileDetailDrawer,
  showHeader,
  showUploadControls,
  showBulkActions,
  allowMultiple = true,
  className,
  onFileSelect,
}: FilesManagementProps = {}) {
  const {
    currentFolderId,
    items,
    hierarchicalItems,
    selectedItems,
    isLoading,
    breadcrumbs,
    filterSettings,
    setFilterSettings,
    navigateToFolder,
    deleteItems,
    setSelectedItems,
    refetchFileSystem: refetchFiles,
    moveItems,
    getItemDescendants,
    showUploading,
    // Optimistic move helper
    isMoving,
    // File upload handler
    handleFilesDropped,
  } = useFilesystemContext()

  // Direct store access for selection state to avoid context isolation issues
  const selectedItemIds = useFileSystemStore((state) => state.selectedItemIds)
  const storeItemsById = useFileSystemStore((state) => state.itemsById)

  // In selection mode, ensure we have data in the store for "select all" to work
  const dataForTable = useMemo(() => {
    if (mode === 'selection' && hierarchicalItems.length > 0 && storeItemsById.size === 0) {
      // If store is empty but we have context data, use context data
      // This happens when FilesystemProvider loads data but store is empty
      return hierarchicalItems
    }
    return hierarchicalItems
  }, [mode, hierarchicalItems, storeItemsById.size])

  // Compute default values based on mode
  const isManagementMode = mode === 'management'
  const shouldShowFileDetailDrawer = allowFileDetailDrawer ?? isManagementMode
  const shouldShowHeader = showHeader ?? isManagementMode
  const shouldShowUploadControls = showUploadControls ?? isManagementMode
  const shouldShowBulkActions = showBulkActions ?? isManagementMode

  // console.log('foldertree', folderTree)
  // console.log('hierarchicalItems', hierarchicalItems)

  // Local state for dialogs
  const [selectedFile, setSelectedFile] = useState<FileItem | null>(null)
  const [detailDrawerOpen, setDetailDrawerOpen] = useState(false)
  const [uploadDialogOpen, setUploadDialogOpen] = useState(false)
  const [createFolderDialogOpen, setCreateFolderDialogOpen] = useState(false)
  const [renameDialogOpen, setRenameDialogOpen] = useState(false)
  const [itemToRename, setItemToRename] = useState<FileItem | null>(null)

  const [confirm, ConfirmDialog] = useConfirm()

  // DnD state management
  const [draggingItems, setDraggingItems] = useState<FileItem[] | null>(null)
  const [allowedBreadcrumbIds, setAllowedBreadcrumbIds] = useState<Set<string>>(new Set())

  // DnD sensors
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor)
  )

  // Get current folder name for drop zone
  const currentFolderName = useMemo(() => {
    if (!currentFolderId) return 'Files'
    const folder = items.find((item) => item.id === currentFolderId && item.type === 'folder')
    return folder?.name || breadcrumbs[breadcrumbs.length - 1]?.name || 'Current Folder'
  }, [currentFolderId, items, breadcrumbs])

  // Handle item click - folders navigate, files open drawer (conditionally)
  const handleItemClick = useCallback(
    (item: FileItem) => {
      // Don't navigate/open drawer for uploading files
      if (item.isUploading) return

      if (item.type === 'folder') {
        navigateToFolder(item.id)
        setSelectedFile(null)
      } else {
        // Only set selected file if we should show the detail drawer
        if (shouldShowFileDetailDrawer) {
          if (onFileSelect) {
            // External drawer management
            onFileSelect(item)
          } else {
            // Internal drawer management
            setSelectedFile(item)
            setDetailDrawerOpen(true)
          }
        }
      }
    },
    [navigateToFolder, shouldShowFileDetailDrawer, onFileSelect]
  )

  // Handle quick view (conditionally opens drawer)
  const handleQuickView = useCallback(
    (item: FileItem) => {
      // Don't show drawer for uploading files
      if (item.isUploading) return

      // Only show drawer if allowed
      if (shouldShowFileDetailDrawer) {
        if (onFileSelect) {
          // External drawer management
          onFileSelect(item)
        } else {
          // Internal drawer management
          setSelectedFile(item)
          setDetailDrawerOpen(true)
        }
      }
    },
    [shouldShowFileDetailDrawer, onFileSelect]
  )

  // Handle single item delete
  const handleDelete = useCallback(
    async (item: FileItem) => {
      if (item.isUploading) return

      const confirmed = await confirm({
        title: `Delete ${item.type === 'folder' ? 'Folder' : 'File'}`,
        description: `Are you sure you want to delete "${item.name}"? ${item.type === 'folder' ? 'All contents will be deleted. ' : ''}This action cannot be undone.`,
        confirmText: 'Delete',
        cancelText: 'Cancel',
        destructive: true,
      })

      if (confirmed) {
        await deleteItems([item.id])
      }
    },
    [confirm, deleteItems]
  )

  // Handle download
  const handleDownload = useCallback((item: FileItem) => {
    if (item.type === 'file' && item.url) {
      window.open(item.url, '_blank')
    }
  }, [])

  // Handle rename
  const handleRename = useCallback((item: FileItem) => {
    // Don't allow renaming uploading files
    if (item.isUploading) return

    setItemToRename(item)
    setRenameDialogOpen(true)
  }, [])

  // Handle bulk delete
  const handleBulkDelete = useCallback(
    async (items: FileItem[]) => {
      // Filter out uploading files
      const deletableItems = items.filter((item) => !item.isUploading)
      if (deletableItems.length === 0) return

      const confirmed = await confirm({
        title: 'Delete Items',
        description: `Are you sure you want to delete ${deletableItems.length} item(s)? This action cannot be undone.`,
        confirmText: 'Delete',
        cancelText: 'Cancel',
        destructive: true,
      })

      if (confirmed) {
        await deleteItems(deletableItems.map((item) => item.id))
      }
    },
    [confirm, deleteItems]
  )

  // Handle export
  const handleExport = useCallback(() => {
    toastSuccess({
      title: 'Export started',
      description: 'File list export will be available soon.',
    })
  }, [])

  // Handle table row selection changes - optimized for Set-based selection
  const handleRowSelectionChange = useCallback(
    (ids: Set<string>) => {
      // Direct Set to store - optimized for O(1) operations
      setSelectedItems(Array.from(ids))
    },
    [setSelectedItems]
  )

  // Handle row clicks - different behavior based on mode and item type
  const handleRowClick = useCallback(
    (item: FileItem) => {
      // In selection mode and item is a file: toggle/set checkbox
      if (mode === 'selection' && item.type === 'file') {
        if (allowMultiple) {
          // Multi-select: toggle item in selection
          const currentSelection = new Set(selectedItemIds)

          if (currentSelection.has(item.id)) {
            currentSelection.delete(item.id)
          } else {
            currentSelection.add(item.id)
          }

          handleRowSelectionChange(currentSelection)
        } else {
          // Single-select: replace selection with this item (or deselect if already selected)
          if (selectedItemIds.has(item.id)) {
            handleRowSelectionChange(new Set())
          } else {
            handleRowSelectionChange(new Set([item.id]))
          }
        }
      } else {
        // For folders or in management mode, use existing behavior
        handleItemClick(item)
      }
    },
    [mode, allowMultiple, selectedItemIds, handleRowSelectionChange, handleItemClick]
  )

  // Column definitions with upload actions
  const columns = useMemo(
    () =>
      createFileColumns({
        onItemClick: handleItemClick,
        onQuickView: handleQuickView,
        onNavigate: navigateToFolder,
        // onRetryUpload: retryUpload,
        // onCancelUpload: cancelUpload,
        onDelete: handleDelete,
        onDownload: handleDownload,
        onRename: handleRename,
        isMoving,
      }),
    [
      handleItemClick,
      handleQuickView,
      navigateToFolder,
      handleDelete,
      handleDownload,
      handleRename,
      isMoving,
    ]
  )

  // Enhanced bulk actions that exclude uploading files (conditional)
  const bulkActions = useMemo(
    () =>
      shouldShowBulkActions
        ? [
            {
              label: 'Delete Selected',
              icon: Trash2,
              variant: 'destructive' as const,
              action: handleBulkDelete,
              disabled: (items: FileItem[]) => {
                // Disable if no real files selected (only uploading files)
                return items.every((item) => item.isUploading)
              },
            },
          ]
        : [],
    [handleBulkDelete, shouldShowBulkActions]
  )

  // Count uploading files
  const uploadingCount = useMemo(() => {
    return items.filter((item) => item.isUploading).length
  }, [items])

  // Compute allowed breadcrumb drop targets using existing canDrop logic
  const computeAllowedCrumbs = useCallback(
    (items: FileItem[]) => {
      const set = new Set<string>()
      for (const crumb of breadcrumbs) {
        // Create lightweight folder object for validation
        const folderLike = { id: crumb.id, type: 'folder', name: crumb.name } as FileItem

        // Reuse existing canDrop validation logic
        if (folderLike.type === 'folder') {
          let canDropHere = true

          for (const draggedItem of items) {
            // Don't allow dropping into self
            if (draggedItem.id === folderLike.id) {
              canDropHere = false
              break
            }

            // Don't allow dropping into current parent folder (item already there)
            if (draggedItem.parentId === folderLike.id) {
              canDropHere = false
              break
            }

            // Don't allow dropping folder into its own descendant
            if (draggedItem.type === 'folder') {
              const descendants = getItemDescendants ? getItemDescendants(draggedItem.id) : []
              if (descendants.some((desc) => desc.id === folderLike.id)) {
                canDropHere = false
                break
              }
            }
          }

          if (canDropHere) {
            set.add(crumb.id || 'root')
          }
        }
      }
      setAllowedBreadcrumbIds(set)
    },
    [breadcrumbs, getItemDescendants, setAllowedBreadcrumbIds]
  )

  // Drag and drop configuration
  const dragDropConfig: DragDropConfig<FileItem> = useMemo(
    () => ({
      enabled: true,

      canDrag: (item) => {
        // Don't allow dragging uploading files
        if (item.isUploading) return false

        // Don't allow dragging the current folder you're viewing
        if (item.id === currentFolderId) return false

        // Allow dragging all other items (including root-level items)
        return true
      },

      canDrop: (draggedItems, targetItem) => {
        // Only folders can accept drops
        if (targetItem.type !== 'folder') return false

        // Check all dragged items
        for (const draggedItem of draggedItems) {
          // Don't allow dropping into self
          if (draggedItem.id === targetItem.id) return false

          // Don't allow dropping into current parent folder (item already there)
          if (draggedItem.parentId === targetItem.id) return false

          // Don't allow dropping folder into its own descendant - O(log n) with Maps
          if (draggedItem.type === 'folder') {
            // Use Maps-based descendant check instead of O(n²) search
            const descendants = getItemDescendants ? getItemDescendants(draggedItem.id) : []
            if (descendants.some((desc) => desc.id === targetItem.id)) {
              return false
            }
          }
        }

        return true
      },

      getSelectedItems: (currentRow) => {
        // Respect canDrag logic: no uploading files, no current folder
        const canDrag = (item: FileItem) => !item.isUploading && item.id !== currentFolderId

        // O(1) check if current row is selected using selectedItems array
        const currentIsSelected = selectedItems.some((item) => item.id === currentRow.id)
        if (currentIsSelected && selectedItems.length > 0) {
          // selectedItems is already resolved from Maps in the hook
          return selectedItems.filter(canDrag)
        }

        // Otherwise, just the row we started on
        return canDrag(currentRow) ? [currentRow] : []
      },

      onDrop: async (draggedItems, targetFolder) => {
        try {
          // Check if any items actually need to move
          const itemsToMove = draggedItems.filter((item) => item.parentId !== targetFolder.id)
          // If no items need to move, skip the operation
          if (itemsToMove.length === 0) {
            console.log('Drop operation skipped: items are already in target folder')
            return
          }
          await moveItems(
            itemsToMove.map((item) => ({
              id: item.id,
              type: item.type,
            })),
            targetFolder.id
          )
        } catch (error) {
          console.error('Drop operation failed:', error)
        }
      },

      // NEW: External DnD configuration
      externalDnd: true,

      onDragStart: (items) => {
        setDraggingItems(items)
        computeAllowedCrumbs(items)
      },

      onDragCancel: () => {
        setDraggingItems(null)
        setAllowedBreadcrumbIds(new Set())
      },

      onDragEnd: () => {
        setDraggingItems(null)
        setAllowedBreadcrumbIds(new Set())
      },

      onDropExternal: async (items, target) => {
        if (target?.type === 'breadcrumb') {
          const folderId = String((target.data as any)?.folderId ?? target.id)
          const toMove = items.filter((i) => i.parentId !== folderId)
          if (toMove.length) {
            try {
              await moveItems(
                toMove.map((i) => ({ id: i.id, type: i.type })),
                folderId
              )
            } catch (error) {
              console.error('External drop operation failed:', error)
            }
          }
        }
      },

      getExternalTargetData: (over) => {
        const data = over?.data?.current
        if (data?.type === 'breadcrumb') {
          return { id: `breadcrumb:${(data as any).folderId}`, type: 'breadcrumb', data }
        }
        return null
      },

      dragPreview: MailThreadItemDragOverlay,
    }),
    [
      selectedItems,
      moveItems,
      getItemDescendants,
      computeAllowedCrumbs,
      setDraggingItems,
      setAllowedBreadcrumbIds,
    ]
  )

  return (
    <DndContext sensors={sensors} collisionDetection={pointerWithin}>
      <FileDropZone
        onFilesDropped={handleFilesDropped}
        currentFolderName={currentFolderName}
        disabled={isLoading}>
        <div className={cn('min-h-0 flex flex-col flex-1', className)}>
          {/* Header with breadcrumbs and actions - conditional */}
          {shouldShowHeader && (
            <div className='flex items-center justify-between bg-primary-200 h-9 px-2 shrink-0'>
              <FilesBreadcrumb
                draggingItems={draggingItems}
                allowedBreadcrumbIds={allowedBreadcrumbIds}
                highlightClassName='border-dashed border-1 border-primary-400'
              />
              <div className='flex items-center space-x-2'>
                {shouldShowUploadControls && (
                  <>
                    <Button
                      variant='outline'
                      size='xs'
                      onClick={() => setCreateFolderDialogOpen(true)}>
                      <FolderPlus />
                      New Folder
                    </Button>
                    <Button size='xs' onClick={() => setUploadDialogOpen(true)}>
                      <Upload />
                      Upload Files
                    </Button>
                  </>
                )}
              </div>
            </div>
          )}

          {/* Dynamic Table */}
          <div className='flex-1 h-full flex flex-col'>
            <DynamicTable<FileItem>
              tableId='filesystem-items'
              className='h-full flex flex-col'
              entityLabel='File'
              columns={columns}
              data={dataForTable}
              onRowClick={handleRowClick}
              bulkActions={shouldShowBulkActions ? bulkActions : []}
              getRowId={(row) => row.id}
              onRowSelectionChange={handleRowSelectionChange}
              rowSelection={selectedItemIds}
              onExport={handleExport}
              enableSearch
              onRefresh={refetchFiles}
              searchPlaceholder='Search files and folders...'
              searchKeys={['name', 'path', 'mimeType', 'ext']}
              onAddNew={() => setUploadDialogOpen(true)}
              dragDrop={dragDropConfig}
              customFilter={
                <FileFilterBar
                  filterSettings={filterSettings}
                  onFilterChange={setFilterSettings}
                  items={items}
                  currentFolderId={currentFolderId}
                />
              }
              emptyState={
                <EmptyState
                  icon={FolderPlus}
                  className='mt-20'
                  title={'No files yet'}
                  description={'Upload your first files to get started.'}
                  button={
                    <Button onClick={() => setUploadDialogOpen(true)} variant='outline'>
                      <Upload />
                      Upload Files
                    </Button>
                  }
                />
              }
              // Enhanced row styling for uploading and moving files
              rowClassName={(row) => {
                const item = row

                if (item.isUploading) {
                  return cn(
                    'bg-blue-50 dark:bg-blue-950/20 border-l-2 border-l-blue-400',
                    item.status === 'failed' && 'bg-red-50 dark:bg-red-950/20 border-l-red-400',
                    item.status === 'completed' &&
                      'bg-green-50 dark:bg-green-950/20 border-l-green-400'
                  )
                }

                // Add transitioning state (from mergeFileItems)
                if ((item as any).isTransitioning) {
                  return 'transitioning'
                }

                // NEW: Optimistic move styling (using both methods for robustness)
                if (item.isOptimisticMove || isMoving(item.id)) {
                  return cn(
                    'bg-amber-50 dark:bg-amber-950/20 border-l-2 border-l-amber-400',
                    'opacity-75 transition-opacity duration-200'
                  )
                }

                return ''
              }}
              // debug={{
              //   enabled: true, // Show debug overlay
              //   showRects: true, // Show collision rectangles (blue for draggables, yellow for droppables)
              //   showCenters: true, // Show center points of elements
              //   showDistances: true, // Show distance info when dragging
              // }}
            />
          </div>

          {/* Dialogs - conditional based on mode */}
          {shouldShowUploadControls && (
            <>
              <FileUploadDialog
                open={uploadDialogOpen}
                onOpenChange={setUploadDialogOpen}
                currentFolderId={currentFolderId}
              />

              <CreateFolderDialog
                open={createFolderDialogOpen}
                onOpenChange={setCreateFolderDialogOpen}
                parentFolderId={currentFolderId}
              />

              <RenameItemDialog
                item={itemToRename}
                open={renameDialogOpen}
                onOpenChange={setRenameDialogOpen}
              />
            </>
          )}

          {/* Drawer - only render internally when not using external callback */}
          {!onFileSelect &&
            shouldShowFileDetailDrawer &&
            selectedFile &&
            !selectedFile.isUploading && (
              <FileDetailDrawer
                file={selectedFile}
                setSelectedFile={setSelectedFile}
                onOpenChange={setDetailDrawerOpen}
              />
            )}

          <ConfirmDialog />
        </div>
      </FileDropZone>
    </DndContext>
  )
}
