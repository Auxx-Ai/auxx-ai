// apps/web/src/components/files/file-upload-dialog.tsx

'use client'

import { useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@auxx/ui/components/dialog'
import { Button } from '@auxx/ui/components/button'
import { Upload } from 'lucide-react'
import { useFilesystemContext } from './provider/filesystem-provider'

/**
 * Props for the FileUploadDialog component
 */
interface FileUploadDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  currentFolderId?: string | null
}

/**
 * Dialog component for file upload
 * TODO: Implement proper file upload interface
 */
export function FileUploadDialog({ open, onOpenChange, currentFolderId }: FileUploadDialogProps) {
  const [dragActive, setDragActive] = useState(false)
  const { handleFilesDropped } = useFilesystemContext()

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || [])
    if (files.length > 0) {
      handleFilesDropped(files)
      onOpenChange(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Upload Files</DialogTitle>
          <DialogDescription>Select files to upload to the current folder.</DialogDescription>
        </DialogHeader>

        <div
          className={`border-2 border-dashed rounded-lg p-6 text-center transition-colors ${
            dragActive
              ? 'border-blue-400 bg-blue-50'
              : 'border-gray-300 hover:border-gray-400 dark:border-gray-800 dark:hover:border-gray-700'
          }`}
          onDragEnter={() => setDragActive(true)}
          onDragLeave={() => setDragActive(false)}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault()
            setDragActive(false)
            const files = Array.from(e.dataTransfer.files)
            if (files.length > 0) {
              handleFilesDropped(files)
              onOpenChange(false)
            }
          }}>
          <Upload className="size-10 text-gray-400 mx-auto mb-2" />
          <p className="text-sm text-gray-600 mb-2">Drag and drop files here, or click to select</p>
          <Button variant="outline" onClick={() => document.getElementById('file-input')?.click()}>
            Select Files
          </Button>
          <input
            id="file-input"
            type="file"
            multiple
            className="hidden"
            onChange={handleFileSelect}
          />
        </div>
      </DialogContent>
    </Dialog>
  )
}
