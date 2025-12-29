// apps/web/src/components/file-upload/ui/file-queue-manager.tsx

'use client'

import React, { useCallback, useId, type ComponentType } from 'react'
import { cn } from '@auxx/ui/lib/utils'
import { Button } from '@auxx/ui/components/button'
import { Upload, Play, Square, RotateCcw, Trash2, FileUp, UploadIcon } from 'lucide-react'
import { useFileUpload } from '../hooks/use-file-upload'
import type { FileItemProps } from './file-item'
import { FileItem } from './file-item'
import type { EntityType } from '@auxx/lib/files/types'
import type { EntityUploadConfig } from '../types'
import { Tooltip } from '~/components/global/tooltip'
import { useUploadStore } from '../stores'
/**
 * Props for FileQueueManager component
 */
export interface FileQueueManagerProps {
  entityType: EntityType
  entityId?: string
  fileItemComponent?: ComponentType<FileItemProps>
  showDropZone?: boolean
  showControls?: boolean
  showProgress?: boolean
  maxFiles?: number
  compact?: boolean
  emptyState?: React.ReactNode
  className?: string
  onComplete?: (results: any) => void
  onError?: (error: string) => void
  onProgress?: (progress: any) => void
  autoStart?: boolean
  config?: Partial<EntityUploadConfig>
  open?: boolean // Dialog open state for reset management
  deleteOnServer?: (file: {
    id: string
    serverFileId?: string
    name: string
    size: number
    type: string
    mimeType?: string
    url?: string
  }) => Promise<void>
}

/**
 * Default drop zone component
 */
function DefaultDropZone({
  onFilesSelected,
  maxFiles,
}: {
  onFilesSelected: (files: File[]) => void
  maxFiles?: number
}) {
  const inputId = useId() // ✅ Generate unique ID

  const handleFileInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files || [])
      if (files.length > 0) {
        onFilesSelected(files)
        e.target.value = '' // Reset input
      }
    },
    [onFilesSelected]
  )

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      const files = Array.from(e.dataTransfer.files)
      if (files.length > 0) {
        onFilesSelected(files)
      }
    },
    [onFilesSelected]
  )

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
  }, [])

  return (
    <div
      className="border-[0.5px] border-dashed rounded-lg p-8 text-center transition-colors border-primary-300 hover:border-primary-400 hover:bg-primary-50 cursor-pointer"
      onDrop={handleDrop}
      onDragOver={handleDragOver}>
      <input
        type="file"
        multiple
        onChange={handleFileInput}
        className="sr-only"
        id={inputId} // ✅ Use unique ID
        accept="*/*"
      />

      <label
        htmlFor={inputId} // ✅ Match unique ID
        className="cursor-pointer flex flex-col items-center gap-2">
        <FileUp className="size-8 text-gray-500" />

        <div className="space-y-1">
          <p className="text-sm font-medium text-gray-700">Drop files here or click to select</p>
          <p className="text-xs text-gray-500">
            {maxFiles ? `Maximum ${maxFiles} files` : 'Multiple files supported'}
          </p>
        </div>
      </label>
    </div>
  )
}

/**
 * Default empty state component
 */
function DefaultEmptyState() {
  return (
    <div className="text-center py-8">
      <Upload className="h-12 w-12 text-gray-400 mx-auto mb-4" />
      <h3 className="text-sm font-medium text-gray-700 mb-1">No files added</h3>
      <p className="text-xs text-gray-500">Add files to get started</p>
    </div>
  )
}

/**
 * FileQueueManager using the unified useFileUpload hook
 *
 * Features the simplified architecture:
 * - Single hook provides all functionality
 * - No more complex hook interactions
 * - Cleaner, more predictable component code
 */
export function FileQueueManager({
  entityType,
  entityId,
  fileItemComponent: FileItemComponent = FileItem,
  showDropZone = true,
  showControls = true,
  showProgress = true,
  maxFiles,
  compact = false,
  emptyState,
  className,
  onComplete,
  onError,
  onProgress,
  autoStart = false,
  config,
  open = true,
  deleteOnServer,
}: FileQueueManagerProps) {
  // Single hook provides everything we need!
  const upload = useFileUpload({
    entityType,
    entityId,
    config,
    onComplete,
    onError,
    onProgress,
    autoStart,
  })

  // Start fresh whenever the dialog opens; fully clean on close/unmount
  React.useEffect(() => {
    if (open) {
      upload.reset()
      upload.clearErrors()
      upload.createNewSession().catch(() => {})
    } else {
      upload.cancelUpload()
      upload.reset()
    }
    return () => {
      upload.cancelUpload()
      upload.reset()
    }
  }, [open])

  // Ensure cleanup on unmount regardless of other effects
  React.useEffect(() => {
    return () => {
      upload.cancelUpload()
      upload.reset()
    }
  }, [])

  // Clear completed files and errors when entityType or entityId changes to prevent repeated toast notifications
  React.useEffect(() => {
    // Clear any completed files and errors from previous contexts to prevent stale toast notifications
    const hasCompletedFiles = upload.files.some(
      (f) => f.status === 'completed' || f.status === 'failed'
    )

    if (hasCompletedFiles || upload.errors.length > 0) {
      // Reset the entire upload state when switching contexts
      const timer = setTimeout(() => {
        upload.reset()
      }, 50) // Reduced delay and removed function from dependencies

      return () => clearTimeout(timer)
    }
  }, [entityType, entityId])
  // Extract state and actions from unified hook
  const {
    files,
    uploadSummary,
    isUploading,
    addFiles,
    removeFile,
    startUpload,
    cancelUpload,
    retry,
    reset,
  } = upload

  // Get addError and updateFileStatus from store for error handling and status management
  const addError = useUploadStore((state) => state.addError)
  const updateFileStatus = useUploadStore((state) => state.updateFileStatus)

  // Computed values
  const hasFiles = files.length > 0
  const hasFailedFiles = uploadSummary?.failedFiles ?? 0 > 0
  const hasCompletedFiles = uploadSummary?.completedFiles ?? 0 > 0
  const allFilesProcessed = uploadSummary
    ? uploadSummary.completedFiles + uploadSummary.failedFiles === uploadSummary.totalFiles
    : false
  // Can upload if we have files and they're not all completed, regardless of session state
  const canUpload =
    hasFiles && !isUploading && files.some((f) => f.status === 'pending' || f.status === 'failed')

  // Handle server-side file deletion
  const handleDeleteOnServer = React.useCallback(
    async (fileId: string) => {
      if (!deleteOnServer) return
      const f = files.find((x) => x.id === fileId)
      if (!f) return

      // Prevent multiple delete attempts
      if (f.status === 'deleting') return

      try {
        // Set deleting status
        updateFileStatus(fileId, 'deleting')

        await deleteOnServer({
          id: f.id,
          serverFileId: f.serverFileId,
          name: f.name,
          size: f.size,
          type: f.type,
          mimeType: f.mimeType || f.file?.type,
          url: f.url,
        })

        // Success: Remove file locally
        removeFile(fileId)
      } catch (e: any) {
        // Error: Revert to completed status AND add error
        updateFileStatus(fileId, 'completed')
        addError({
          message: e?.message || 'Delete failed',
          code: 'DELETE_FAILED',
          fileId,
          recoverable: false,
        })
      }
    },
    [deleteOnServer, files, removeFile, addError, updateFileStatus]
  )

  // Handle file selection - much simpler now!
  const handleFilesSelected = useCallback(
    async (newFiles: File[]) => {
      let filesToAdd = newFiles
      if (maxFiles) {
        const availableSlots = maxFiles - files.length
        filesToAdd = newFiles.slice(0, availableSlots)
      }

      if (filesToAdd.length > 0) {
        await addFiles(filesToAdd)
      }
    },
    [addFiles, maxFiles, files.length]
  )

  // Upload actions - simplified
  const handleStartUpload = useCallback(async () => {
    try {
      await startUpload()
    } catch (error) {
      console.error('Upload failed:', error)
    }
  }, [startUpload])

  const handleCancelUpload = useCallback(() => {
    cancelUpload()
  }, [cancelUpload])

  const handleRetryFailed = useCallback(async () => {
    try {
      await retry() // Retry all failed files
    } catch (error) {
      console.error('Retry failed:', error)
    }
  }, [retry])

  const handleClearQueue = useCallback(() => {
    reset()
  }, [reset])

  const inputId = useId() // ✅ Generate unique ID
  const fileInputRef = React.useRef<HTMLInputElement>(null)

  const handleFileInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files || [])
      if (files.length > 0) {
        handleFilesSelected(files)
        e.target.value = '' // Reset input
      }
    },
    [handleFilesSelected]
  )

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      const files = Array.from(e.dataTransfer.files)
      if (files.length > 0) {
        handleFilesSelected(files)
      }
    },
    [handleFilesSelected]
  )

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
  }, [])

  const handleAddFiles = useCallback(() => {
    fileInputRef.current?.click()
  }, [])

  return (
    <div
      className={cn(
        '@container border-[0.5px] flex flex-col border-dashed relative min-h-50 rounded-lg p-2 text-center transition-colors border-primary-300  ',
        !hasFiles &&
          'cursor-pointer items-center justify-center hover:border-primary-400 hover:bg-primary-200/50'
      )}
      onDrop={handleDrop}
      onDragOver={handleDragOver}>
      <input
        ref={fileInputRef}
        type="file"
        multiple
        onChange={handleFileInput}
        className="sr-only"
        id={inputId} // ✅ Use unique ID
        accept="*/*"
      />
      {hasFiles ? (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h3 className="truncate text-sm font-medium mb-0">Files ({files.length})</h3>
            <div className="flex gap-2">
              {canUpload && !isUploading && (
                <Tooltip content="Start Upload">
                  <Button onClick={handleStartUpload} size="sm">
                    <Play />
                    <span className="sr-only @sm:not-sr-only">Start Upload</span>
                  </Button>
                </Tooltip>
              )}
              {!!isUploading && (
                <Tooltip content="Cancel Upload">
                  <Button variant="outline" onClick={handleCancelUpload} size="sm">
                    <Square />
                    <span className="sr-only @sm:not-sr-only">Cancel</span>
                  </Button>
                </Tooltip>
              )}

              {/* Secondary Actions */}
              {!!(hasFailedFiles && !isUploading) && (
                <Tooltip content="Retry Failed">
                  <Button variant="outline" onClick={handleRetryFailed} size="sm">
                    <RotateCcw />
                    <span className="sr-only @sm:not-sr-only">Retry Failed</span>
                  </Button>
                </Tooltip>
              )}
              <Tooltip content="Add Files">
                <Button variant="outline" size="sm" onClick={handleAddFiles}>
                  <UploadIcon />
                  <span className="sr-only @sm:not-sr-only">Add Files</span>
                </Button>
              </Tooltip>
              {hasFiles && !isUploading && (
                <Tooltip content="Remove all">
                  <Button variant="outline" size="sm" onClick={handleClearQueue}>
                    <Trash2 />
                    <span className="sr-only @sm:not-sr-only">Remove all</span>
                  </Button>
                </Tooltip>
              )}
            </div>
          </div>

          <div className={cn('space-y-2', compact && 'space-y-1')}>
            {files.map((file) => (
              <FileItemComponent
                key={file.id}
                fileId={file.id}
                compact={compact}
                showProgress={showProgress}
                showControls={showControls}
                onDeleteServer={deleteOnServer ? () => handleDeleteOnServer(file.id) : undefined}
              />
            ))}
          </div>
        </div>
      ) : (
        <label
          htmlFor={inputId} // ✅ Match unique ID
          className="cursor-pointer flex flex-col items-center gap-2 inset-0 absolute justify-center">
          <FileUp className="size-8 text-gray-500" />

          <div className="space-y-1">
            <p className="text-sm font-medium text-gray-700">Drop files here or click to select</p>
            <p className="text-xs text-gray-500">
              {maxFiles ? `Maximum ${maxFiles} files` : 'Multiple files supported'}
            </p>
          </div>
        </label>
      )}
    </div>
  )
}
