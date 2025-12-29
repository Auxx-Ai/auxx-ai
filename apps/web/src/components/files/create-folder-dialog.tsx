// apps/web/src/components/files/create-folder-dialog.tsx

'use client'

import { useState } from 'react'
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
import { Label } from '@auxx/ui/components/label'
import { useFilesystemContext } from './provider/filesystem-provider'

/**
 * Props for the CreateFolderDialog component
 */
interface CreateFolderDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  parentFolderId?: string | null
}

/**
 * Dialog component for creating new folders
 */
export function CreateFolderDialog({
  open,
  onOpenChange,
  parentFolderId,
}: CreateFolderDialogProps) {
  const [folderName, setFolderName] = useState('')
  const { createFolder, isCreatingFolder } = useFilesystemContext()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!folderName.trim()) return

    try {
      await createFolder(folderName.trim(), parentFolderId)
      setFolderName('')
      onOpenChange(false)
    } catch (error) {
      // Error is already handled in the hook
      console.error('Failed to create folder:', error)
    }
  }

  const handleOpenChange = (newOpen: boolean) => {
    if (!isCreatingFolder) {
      setFolderName('')
      onOpenChange(newOpen)
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Create New Folder</DialogTitle>
            <DialogDescription>Enter a name for the new folder.</DialogDescription>
          </DialogHeader>

          <Input
            id="folder-name"
            placeholder="Enter folder name..."
            value={folderName}
            onChange={(e) => setFolderName(e.target.value)}
            disabled={isCreatingFolder}
            autoFocus
          />

          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => handleOpenChange(false)}
              disabled={isCreatingFolder}>
              Cancel
            </Button>
            <Button
              type="submit"
              size="sm"
              variant="outline"
              disabled={!folderName.trim() || isCreatingFolder}
              loading={isCreatingFolder}
              loadingText="Creating...">
              Create Folder
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
