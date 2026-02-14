// apps/web/src/components/file-select/file-select-dialog.tsx

'use client'

import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@auxx/ui/components/dialog'
import { Check, FolderOpen } from 'lucide-react'
import type React from 'react'
import { useCallback, useMemo, useState } from 'react'
import { FilesManagement } from '~/components/files/files-management'
import type { FileItem } from '~/components/files/files-store'
import { useFileSystemStore } from '~/components/files/files-store'
import {
  FilesystemProvider,
  useFilesystemContext,
} from '~/components/files/provider/filesystem-provider'
import { FileSelectWrapper } from './file-select-wrapper'

/**
 * Props for FileSelectDialog component
 */
interface FileSelectDialogProps {
  trigger?: React.ReactNode
  open?: boolean
  onOpenChange?: (open: boolean) => void
  onFilesSelected: (files: FileItem[]) => void
  allowMultiple?: boolean
  title?: string
  description?: string
  confirmText?: string
  cancelText?: string
  fileTypeFilter?: 'files' | 'folders' | 'both'
  maxSelection?: number
  disabled?: boolean
}

/**
 * Internal dialog content that uses the filesystem context
 */
function FileSelectDialogContent({
  onFilesSelected,
  onClose,
  allowMultiple = true,
  title = 'Select Files',
  description,
  confirmText = 'Select',
  cancelText = 'Cancel',
  fileTypeFilter = 'files',
  maxSelection,
}: {
  onFilesSelected: (files: FileItem[]) => void
  onClose: () => void
  allowMultiple: boolean
  title: string
  description?: string
  confirmText: string
  cancelText: string
  fileTypeFilter: 'files' | 'folders' | 'both'
  maxSelection?: number
}) {
  const { clearSelection } = useFilesystemContext()

  // Direct store access to avoid context isolation issues
  // Use raw state to avoid computed getter issues
  const selectedItemIds = useFileSystemStore((state) => state.selectedItemIds)
  const itemsById = useFileSystemStore((state) => state.itemsById)
  const clearStoreSelection = useFileSystemStore((state) => state.clearSelection)

  // Compute selected items directly from store state
  const selectedItems = useMemo(() => {
    const items: FileItem[] = []
    selectedItemIds.forEach((id) => {
      const item = itemsById.get(id)
      if (item) items.push(item)
    })
    return items
  }, [selectedItemIds, itemsById])

  // Filter selected items based on type filter
  const filteredSelection = useMemo(() => {
    return selectedItems.filter((item) => {
      if (fileTypeFilter === 'files') return item.type === 'file'
      if (fileTypeFilter === 'folders') return item.type === 'folder'
      return true // both
    })
  }, [selectedItems, fileTypeFilter])

  const handleConfirmSelection = useCallback(() => {
    if (filteredSelection.length > 0) {
      onFilesSelected(filteredSelection)
      clearStoreSelection()
      onClose()
    }
  }, [filteredSelection, onFilesSelected, clearStoreSelection, onClose])

  const handleCancel = useCallback(() => {
    clearStoreSelection()
    onClose()
  }, [clearStoreSelection, onClose])

  const hasValidSelection = filteredSelection.length > 0
  const isOverLimit = maxSelection ? filteredSelection.length > maxSelection : false
  const canConfirm = hasValidSelection && !isOverLimit

  // Generate description if not provided
  const finalDescription =
    description ||
    (() => {
      const typeText =
        fileTypeFilter === 'files'
          ? 'files'
          : fileTypeFilter === 'folders'
            ? 'folders'
            : 'files or folders'
      const multipleText = allowMultiple ? `one or more ${typeText}` : `a ${typeText.slice(0, -1)}`
      const limitText = maxSelection ? ` (max ${maxSelection})` : ''
      return `Select ${multipleText} from your library${limitText}`
    })()

  return (
    <>
      <DialogHeader>
        <DialogTitle className='flex items-center gap-2'>
          <FolderOpen className='h-5 w-5' />
          {title}
        </DialogTitle>
        <DialogDescription>{finalDescription}</DialogDescription>
      </DialogHeader>

      {/* Files browser */}
      <div className='flex-1 min-h-[400px] max-h-[600px] overflow-hidden border rounded-lg flex flex-col'>
        <FilesManagement
          mode='selection'
          allowFileDetailDrawer={false}
          showHeader
          allowMultiple={allowMultiple}
        />
      </div>

      <DialogFooter className='sm:justify-between flex-col pt-4'>
        <div className=''>
          {/* Selection status */}
          {filteredSelection.length > 0 && (
            <div className='px-1 flex flex-row items-start gap-2'>
              <div className='flex items-center shrink-0'>
                <span className='text-sm font-medium shrink-0 pe-2'>
                  Selected: {filteredSelection.length}
                  {maxSelection && ` / ${maxSelection}`}
                </span>
                {isOverLimit && (
                  <Badge variant='destructive' className='text-xs'>
                    Too many selected
                  </Badge>
                )}
              </div>

              {/* Show selected items */}
              <div className='flex flex-wrap gap-1 max-h-20 overflow-y-auto'>
                {filteredSelection.slice(0, 10).map((item) => (
                  <Badge key={item.id} variant='outline' className='text-xs'>
                    {item.name}
                  </Badge>
                ))}
                {filteredSelection.length > 10 && (
                  <Badge variant='outline' className='text-xs'>
                    +{filteredSelection.length - 10} more
                  </Badge>
                )}
              </div>
            </div>
          )}
        </div>
        <div className='flex flex-col-reverse sm:flex-row gap-y-2 sm:space-y-0 sm:gap-x-2 shrink-0'>
          <Button variant='ghost' onClick={handleCancel} size='sm'>
            {cancelText}
          </Button>
          <Button
            onClick={handleConfirmSelection}
            disabled={!canConfirm}
            size='sm'
            variant='outline'>
            <Check />
            {confirmText} ({filteredSelection.length})
          </Button>
        </div>
      </DialogFooter>
    </>
  )
}

/**
 * Dialog component for selecting files from the filesystem
 *
 * Features:
 * - File browser with navigation
 * - Multiple/single selection modes
 * - File type filtering
 * - Selection limits
 * - Controlled/uncontrolled modes
 */
export function FileSelectDialog({
  trigger,
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange,
  onFilesSelected,
  allowMultiple = true,
  title = 'Select Files',
  description,
  confirmText = 'Select',
  cancelText = 'Cancel',
  fileTypeFilter = 'files',
  maxSelection,
  disabled = false,
}: FileSelectDialogProps) {
  // Internal state for uncontrolled mode
  const [internalOpen, setInternalOpen] = useState(false)

  // Use controlled or uncontrolled state
  const open = controlledOpen !== undefined ? controlledOpen : internalOpen
  const onOpenChange = controlledOnOpenChange || setInternalOpen

  const handleClose = useCallback(() => {
    onOpenChange(false)
  }, [onOpenChange])

  const defaultTrigger = (
    <Button variant='outline' disabled={disabled}>
      <FolderOpen />
      Browse Files
    </Button>
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>{trigger || defaultTrigger}</DialogTrigger>

      <DialogContent position='tc' className='max-w-4xl flex flex-col'>
        <FileSelectWrapper>
          <FilesystemProvider>
            <FileSelectDialogContent
              onFilesSelected={onFilesSelected}
              onClose={handleClose}
              allowMultiple={allowMultiple}
              title={title}
              description={description}
              confirmText={confirmText}
              cancelText={cancelText}
              fileTypeFilter={fileTypeFilter}
              maxSelection={maxSelection}
            />
          </FilesystemProvider>
        </FileSelectWrapper>
      </DialogContent>
    </Dialog>
  )
}
