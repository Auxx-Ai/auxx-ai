// apps/web/src/components/file-select/index.tsx

'use client'

import React, { useCallback, useEffect } from 'react'
import { cn } from '@auxx/ui/lib/utils'
import { AlertCircle, Upload, Trash2, Play, Square } from 'lucide-react'
import { Button } from '@auxx/ui/components/button'
import { Alert, AlertDescription } from '@auxx/ui/components/alert'
import { Tooltip } from '~/components/global/tooltip'
import { useFileSelect } from './hooks/use-file-select'
import { FileSelectDropZone } from './file-select-drop-zone'
import { FileItem } from '~/components/file-upload/ui/file-item'
import { FileSelectPickerButton } from './file-select-picker-button'
import type { FileSelectProps } from './types'

/**
 * Unified FileSelect component that combines file upload and existing file selection
 *
 * Features:
 * - Drag and drop file upload
 * - Browse and select existing files
 * - Upload progress tracking
 * - File validation
 * - Multiple/single selection modes
 * - Unified interface for both sources
 */
export function FileSelect({
  allowMultiple = true,
  maxFiles,
  fileExtensions,
  maxFileSize,
  entityType = 'FILE',
  entityId,
  uploadConfig,
  showDropZone = true,
  showFilePicker = true,
  compact = false,
  placeholder,
  onChange,
  onUploadComplete,
  onError,
  value,
  defaultValue,
  className,
  disabled = false,
}: FileSelectProps) {
  // Use our custom hook for state management
  const fileSelect = useFileSelect({
    entityType,
    entityId,
    uploadConfig,
    maxFiles,
    maxFileSize,
    fileExtensions,
    allowMultiple,
    onChange,
    onUploadComplete,
    onError,
  })

  // Handle controlled component behavior
  useEffect(() => {
    if (value !== undefined) {
      // Compare items by their IDs to avoid reference comparison issues
      const currentIds = fileSelect.selectedItems.map((item) => item.id).sort()
      const valueIds = value.map((item) => item.id).sort()

      // Only sync if the IDs are actually different
      const isDifferent =
        currentIds.length !== valueIds.length ||
        currentIds.some((id, index) => id !== valueIds[index])

      if (isDifferent) {
        fileSelect.clearItems()
        if (value.length > 0) {
          fileSelect.addItems(value)
        }
      }
    }
  }, [value])

  // Handle default value
  useEffect(() => {
    if (defaultValue && fileSelect.selectedItems.length === 0) {
      fileSelect.addItems(defaultValue)
    }
  }, [defaultValue])

  // File drop handler
  const handleFilesSelected = useCallback(
    async (files: File[]) => {
      if (disabled) return
      await fileSelect.addFiles(files)
    },
    [fileSelect, disabled]
  )

  // Existing files selection handler
  const handleExistingFilesSelected = useCallback(
    (files: any[]) => {
      if (disabled) return
      fileSelect.addExistingFiles(files)
    },
    [fileSelect, disabled]
  )

  // Upload control handlers
  const handleStartUpload = useCallback(async () => {
    await fileSelect.startUpload()
  }, [fileSelect])

  const handleCancelUpload = useCallback(() => {
    fileSelect.cancelUpload()
  }, [fileSelect])

  const handleClearAll = useCallback(() => {
    fileSelect.clearItems()
  }, [fileSelect])

  // Check if we have upload files that can be started
  const hasUploadFiles = fileSelect.selectedItems.some(
    (item) => item.source === 'upload' && (item.status === 'pending' || item.status === 'failed')
  )

  const hasUploadInProgress = fileSelect.selectedItems.some(
    (item) =>
      item.source === 'upload' && (item.status === 'uploading' || item.status === 'processing')
  )

  const hasItems = fileSelect.selectedItems.length > 0

  return (
    <div className={cn('space-y-4', className)}>
      {/* Error display */}
      {fileSelect.errors.length > 0 && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            <ul className="list-disc list-inside space-y-1">
              {fileSelect.errors.map((error, index) => (
                <li key={index}>{error}</li>
              ))}
            </ul>
            <Button variant="outline" size="sm" onClick={fileSelect.clearErrors} className="mt-2">
              Dismiss
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {/* Main content area */}
      {!hasItems ? (
        /* Empty state with drop zone */
        showDropZone && (
          <FileSelectDropZone
            onFilesSelected={handleFilesSelected}
            onBrowseExisting={fileSelect.openPicker}
            dragActive={fileSelect.dragActive}
            onDragActiveChange={fileSelect.setDragActive}
            maxFiles={maxFiles}
            disabled={disabled}
            placeholder={placeholder}
            showFilePicker={showFilePicker}
            fileExtensions={fileExtensions}
          />
        )
      ) : (
        /* Items list with controls */
        <div className="space-y-4">
          {/* Header with controls */}
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium">
              Selected Files ({fileSelect.selectedItems.length}){maxFiles && ` / ${maxFiles}`}
            </h3>

            <div className="flex items-center gap-2">
              {/* Upload controls */}
              {hasUploadFiles && !hasUploadInProgress && (
                <Tooltip content="Start Upload">
                  <Button size="sm" onClick={handleStartUpload} disabled={disabled}>
                    <Play />
                    <span className="sr-only sm:not-sr-only ml-2">Start Upload</span>
                  </Button>
                </Tooltip>
              )}

              {hasUploadInProgress && (
                <Tooltip content="Cancel Upload">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleCancelUpload}
                    disabled={disabled}>
                    <Square />
                    <span className="sr-only sm:not-sr-only ml-2">Cancel</span>
                  </Button>
                </Tooltip>
              )}

              {/* Add more files */}
              {showDropZone && (
                <Tooltip content="Add Files">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      const input = document.createElement('input')
                      input.type = 'file'
                      input.multiple = allowMultiple
                      input.accept = fileExtensions ? fileExtensions.join(',') : '*/*'
                      input.onchange = (e) => {
                        const files = Array.from((e.target as HTMLInputElement).files || [])
                        if (files.length > 0) {
                          handleFilesSelected(files)
                        }
                      }
                      input.click()
                    }}
                    disabled={disabled}>
                    <Upload />
                    <span className="sr-only sm:not-sr-only ml-2">Add Files</span>
                  </Button>
                </Tooltip>
              )}

              {/* Browse existing files */}
              {showFilePicker && (
                <FileSelectPickerButton
                  open={fileSelect.pickerOpen}
                  onOpenChange={(open) =>
                    open ? fileSelect.openPicker() : fileSelect.closePicker()
                  }
                  onFilesSelected={handleExistingFilesSelected}
                  allowMultiple={allowMultiple}
                  disabled={disabled}
                  variant="inline"
                  size="sm"
                />
              )}

              {/* Clear all */}
              <Tooltip content="Remove All">
                <Button variant="outline" size="sm" onClick={handleClearAll} disabled={disabled}>
                  <Trash2 />
                  <span className="sr-only sm:not-sr-only ml-2">Clear</span>
                </Button>
              </Tooltip>
            </div>
          </div>

          {/* Items list */}
          <div className={cn('space-y-2', compact && 'space-y-1')}>
            {fileSelect.selectedItems.map((item) => (
              <FileItem
                key={item.id}
                fileId={item.uploadFileId} // Pass upload file ID for store subscription
                file={item} // Pass file data as fallback
                onRemove={() => fileSelect.removeItem(item.id)}
                onRetry={() => fileSelect.retryUpload(item.id)}
                showControls={true}
                showSource={true}
                className={compact ? 'p-2' : ''}
              />
            ))}
          </div>
        </div>
      )}

      {/* File picker popover */}
      {showFilePicker && !hasItems && (
        <FileSelectPickerButton
          open={fileSelect.pickerOpen}
          onOpenChange={(open) => (open ? fileSelect.openPicker() : fileSelect.closePicker())}
          onFilesSelected={handleExistingFilesSelected}
          allowMultiple={allowMultiple}
          disabled={disabled}
          variant="button"
        />
      )}
    </div>
  )
}

// Export types for consumers
export type { FileSelectProps, FileSelectItem } from './types'
