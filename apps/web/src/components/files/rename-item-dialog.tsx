// apps/web/src/components/files/rename-item-dialog.tsx

'use client'

import { useState, useEffect } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@auxx/ui/components/dialog'
import { Button } from '@auxx/ui/components/button'
import { Input } from '@auxx/ui/components/input'
import { useFilesystemContext } from './provider/filesystem-provider'
import type { FileItem } from './files-store'

/**
 * Props for the RenameItemDialog component
 */
interface RenameItemDialogProps {
  /** The item to rename (file or folder) */
  item: FileItem | null
  /** Whether the dialog is open */
  open: boolean
  /** Callback when open state changes */
  onOpenChange: (open: boolean) => void
}

/**
 * Dialog component for renaming files and folders
 * Works with both file and folder types automatically
 */
export function RenameItemDialog({ item, open, onOpenChange }: RenameItemDialogProps) {
  const [newName, setNewName] = useState('')
  const [isRenaming, setIsRenaming] = useState(false)
  const { renameItem } = useFilesystemContext()

  // Reset input when item changes or dialog opens
  useEffect(() => {
    if (item && open) {
      setNewName(item.name)
    }
  }, [item, open])

  /**
   * Handle form submission
   */
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!item || !newName.trim()) return

    // Skip if name hasn't changed
    if (newName.trim() === item.name) {
      onOpenChange(false)
      return
    }

    try {
      setIsRenaming(true)
      await renameItem(item.id, newName.trim())
      onOpenChange(false)
    } catch (error) {
      // Error is already handled in renameItem hook with toast
      console.error('Failed to rename item:', error)
    } finally {
      setIsRenaming(false)
    }
  }

  /**
   * Handle dialog close
   */
  const handleOpenChange = (newOpen: boolean) => {
    if (!isRenaming) {
      onOpenChange(newOpen)
    }
  }

  /**
   * Get dialog content based on item type
   */
  const itemType = item?.type === 'folder' ? 'folder' : 'file'
  const itemTypeCapitalized = item?.type === 'folder' ? 'Folder' : 'File'

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Rename {itemTypeCapitalized}</DialogTitle>
            <DialogDescription>Enter a new name for this {itemType}.</DialogDescription>
          </DialogHeader>

          <Input
            id="item-name"
            placeholder={`Enter ${itemType} name...`}
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            disabled={isRenaming}
            autoFocus
            // Select the filename (without extension) on focus for files
            onFocus={(e) => {
              if (item?.type === 'file' && item.ext) {
                // Select name without extension
                const nameWithoutExt = newName.lastIndexOf('.')
                if (nameWithoutExt > 0) {
                  e.target.setSelectionRange(0, nameWithoutExt)
                } else {
                  e.target.select()
                }
              } else {
                e.target.select()
              }
            }}
          />

          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => handleOpenChange(false)}
              disabled={isRenaming}>
              Cancel
            </Button>
            <Button
              type="submit"
              size="sm"
              variant="outline"
              disabled={!newName.trim() || newName.trim() === item?.name || isRenaming}
              loading={isRenaming}
              loadingText="Renaming...">
              Rename
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
