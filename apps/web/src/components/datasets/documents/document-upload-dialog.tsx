// apps/web/src/components/datasets/documents/document-upload-dialog.tsx

'use client'

import { useCallback, useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@auxx/ui/components/dialog'
import { FileSelect } from '~/components/file-select'
import { toastSuccess, toastError, toastInfo } from '@auxx/ui/components/toast'
import { api } from '~/trpc/react'
import type { FileSelectItem } from '~/components/file-select/types'

interface DocumentUploadDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  datasetId: string
}

export function DocumentUploadDialog({ open, onOpenChange, datasetId }: DocumentUploadDialogProps) {
  const [isProcessing, setIsProcessing] = useState(false)

  // Get utils for cache invalidation
  const utils = api.useUtils()

  // API mutation for existing files
  const createFromExisting = api.document.createFromExistingFiles.useMutation()

  /**
   * Handle file selection/upload completion
   * FileSelect will handle uploads internally and call this for both cases
   */
  const handleFilesChange = useCallback(
    async (items: FileSelectItem[]) => {
      // Filter filesystem files that need to be processed
      const filesystemFiles = items.filter(
        (item) => item.source === 'filesystem' && item.status !== 'completed'
      )

      if (filesystemFiles.length === 0) {
        // All files are either uploads or already processed
        return
      }

      setIsProcessing(true)
      try {
        // Create documents from existing files
        const result = await createFromExisting.mutateAsync({
          fileSelections: filesystemFiles.map((file) => ({
            fileId: file.id,
            title: file.name,
          })),
          datasetId,
          skipDuplicates: true,
          processImmediately: true,
        })

        // Show results
        if (result.created.length > 0) {
          toastSuccess({
            title: 'Documents added',
            description: `${result.created.length} documents added from existing files`,
          })
        }

        if (result.skipped.length > 0) {
          toastInfo({
            title: 'Duplicates skipped',
            description: `${result.skipped.length} files were already in the dataset`,
          })
        }

        if (result.failed.length > 0) {
          toastError({
            title: 'Some files failed',
            description: `${result.failed.length} files could not be added`,
          })
        }

        // Invalidate document list so new documents appear
        // (processing completion will refresh dataset stats via parent's onAllComplete)
        void utils.document.list.invalidate({ datasetId })

        // Close dialog if successful
        if (result.created.length > 0 && result.failed.length === 0) {
          setTimeout(() => onOpenChange(false), 1500)
        }
      } catch (error: any) {
        toastError({
          title: 'Failed to add documents',
          description: error.message,
        })
      } finally {
        setIsProcessing(false)
      }
    },
    [createFromExisting, datasetId, utils, onOpenChange]
  )

  /**
   * Handle upload completion for new files
   * FileSelect handles the upload, we just refresh after
   */
  const handleUploadComplete = useCallback(
    (uploadedItems: FileSelectItem[]) => {
      const successCount = uploadedItems.filter((item) => item.status === 'completed').length

      if (successCount > 0) {
        toastSuccess({
          title: 'Documents uploaded',
          description: `${successCount} document${successCount !== 1 ? 's' : ''} uploaded and queued for processing.`,
        })

        // Invalidate document list so new documents appear
        // (processing completion will refresh dataset stats via parent's onAllComplete)
        void utils.document.list.invalidate({ datasetId })

        setTimeout(() => onOpenChange(false), 1500)
      }
    },
    [utils, datasetId, onOpenChange]
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[80vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>Add Documents to Dataset</DialogTitle>
          <DialogDescription>
            Upload new documents or select existing files from your library. Supported formats: PDF,
            DOCX, TXT, MD, CSV, and more (up to 50MB each).
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto p-4">
          <FileSelect
            entityType="DATASET"
            entityId={datasetId}
            allowMultiple={true}
            maxFiles={20}
            maxFileSize={50 * 1024 * 1024} // 50MB
            fileExtensions={[
              '.pdf',
              '.docx',
              '.doc',
              '.txt',
              '.md',
              '.csv',
              '.tsv',
              '.json',
              '.xml',
              '.html',
            ]}
            showDropZone={true}
            showFilePicker={true}
            onChange={handleFilesChange}
            onUploadComplete={handleUploadComplete}
            onError={(error) => {
              toastError({
                title: 'Error',
                description: error,
              })
            }}
            disabled={isProcessing}
            placeholder="Drag & drop files here or browse from your library"
          />
        </div>
      </DialogContent>
    </Dialog>
  )
}
