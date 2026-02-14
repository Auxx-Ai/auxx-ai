// apps/web/src/components/files/create-folder-dialog.tsx

'use client'

import { Button } from '@auxx/ui/components/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@auxx/ui/components/dialog'
import { Input } from '@auxx/ui/components/input'
import { Kbd, KbdSubmit } from '@auxx/ui/components/kbd'
import { useState } from 'react'
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
  const { isCreatingFolder } = useFilesystemContext()

  const handleOpenChange = (newOpen: boolean) => {
    if (!isCreatingFolder) {
      onOpenChange(newOpen)
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className='sm:max-w-md'>
        <CreateFolderDialogContent
          parentFolderId={parentFolderId}
          onClose={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  )
}

/** Inner content props */
interface CreateFolderDialogContentProps {
  parentFolderId?: string | null
  onClose: () => void
}

/** Inner content component */
function CreateFolderDialogContent({ parentFolderId, onClose }: CreateFolderDialogContentProps) {
  const [folderName, setFolderName] = useState('')
  const { createFolder, isCreatingFolder } = useFilesystemContext()

  const handleSubmit = async () => {
    if (!folderName.trim()) return

    try {
      await createFolder(folderName.trim(), parentFolderId)
      setFolderName('')
      onClose()
    } catch (error) {
      // Error is already handled in the hook
      console.error('Failed to create folder:', error)
    }
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        handleSubmit()
      }}>
      <DialogHeader>
        <DialogTitle>Create New Folder</DialogTitle>
        <DialogDescription>Enter a name for the new folder.</DialogDescription>
      </DialogHeader>

      <Input
        id='folder-name'
        placeholder='Enter folder name...'
        value={folderName}
        onChange={(e) => setFolderName(e.target.value)}
        disabled={isCreatingFolder}
        autoFocus
      />

      <DialogFooter>
        <Button
          type='button'
          variant='ghost'
          size='sm'
          onClick={onClose}
          disabled={isCreatingFolder}>
          Cancel <Kbd shortcut='esc' variant='ghost' size='sm' />
        </Button>
        <Button
          type='submit'
          size='sm'
          variant='outline'
          disabled={!folderName.trim() || isCreatingFolder}
          loading={isCreatingFolder}
          loadingText='Creating...'
          data-dialog-submit>
          Create Folder <KbdSubmit variant='outline' size='sm' />
        </Button>
      </DialogFooter>
    </form>
  )
}
