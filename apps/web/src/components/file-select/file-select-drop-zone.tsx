// apps/web/src/components/file-select/file-select-drop-zone.tsx

'use client'

import React, { useCallback, useId } from 'react'
import { cn } from '@auxx/ui/lib/utils'
import { Upload, FileUp, FolderOpen } from 'lucide-react'
import { Button } from '@auxx/ui/components/button'

/**
 * Props for FileSelectDropZone component
 */
interface FileSelectDropZoneProps {
  onFilesSelected: (files: File[]) => void
  onBrowseExisting: () => void
  dragActive: boolean
  onDragActiveChange: (active: boolean) => void
  maxFiles?: number
  disabled?: boolean
  placeholder?: string
  showFilePicker?: boolean
  fileExtensions?: string[]
  className?: string
}

/**
 * Drop zone component for FileSelect - handles both file uploads and existing file browsing
 */
export function FileSelectDropZone({
  onFilesSelected,
  onBrowseExisting,
  dragActive,
  onDragActiveChange,
  maxFiles,
  disabled = false,
  placeholder = 'Drop files here or click to select',
  showFilePicker = true,
  fileExtensions,
  className,
}: FileSelectDropZoneProps) {
  const inputId = useId()

  // File input handler
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

  // Drag and drop handlers
  const handleDragEnter = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      e.stopPropagation()

      if (disabled) return

      // Check if dragged items contain files
      if (e.dataTransfer.items) {
        const hasFiles = Array.from(e.dataTransfer.items).some((item) => item.kind === 'file')
        if (hasFiles) {
          onDragActiveChange(true)
        }
      }
    },
    [disabled, onDragActiveChange]
  )

  const handleDragLeave = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      e.stopPropagation()

      // Only hide drag state if leaving the main container
      if (e.currentTarget === e.target) {
        onDragActiveChange(false)
      }
    },
    [onDragActiveChange]
  )

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
  }, [])

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      e.stopPropagation()

      onDragActiveChange(false)

      if (disabled) return

      const files = Array.from(e.dataTransfer.files)
      if (files.length > 0) {
        onFilesSelected(files)
      }
    },
    [onFilesSelected, disabled, onDragActiveChange]
  )

  // Generate accept string for file input
  const acceptString = fileExtensions ? fileExtensions.join(',') : '*/*'

  return (
    <div
      className={cn(
        'flex h-full w-full items-center justify-center',
        dragActive && 'bg-primary-100 ',
        className
      )}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}>
      {/* Hidden file input */}
      <input
        type="file"
        multiple
        onChange={handleFileInput}
        className="sr-only"
        id={inputId}
        accept={acceptString}
        disabled={disabled}
      />

      {/* Visual drop zone container */}
      <div
        className={cn(
          'relative border-1 border-dashed rounded-lg p-8 text-center transition-all duration-200 w-md mx-4',
          dragActive
            ? 'border-primary-500 bg-primary-50 dark:bg-primary-950/20'
            : 'border-primary-300 hover:border-primary-400 hover:bg-gray-50 dark:hover:bg-gray-950/20',
          disabled && 'opacity-50 cursor-not-allowed',
          !disabled && 'cursor-pointer'
        )}>
        {/* Drop zone content */}
        <div className="flex flex-col items-center gap-4">
          {/* Icon */}
          <div
            className={cn(
              'rounded-full p-3 transition-colors',
              dragActive ? 'bg-primary-100 dark:bg-primary-900/30' : 'bg-gray-100 dark:bg-gray-800'
            )}>
            <Upload
              className={cn(
                'size-6 transition-colors',
                dragActive ? 'text-primary-600 dark:text-primary-400' : 'text-gray-500'
              )}
            />
          </div>

          {/* Text content */}
          <div className="space-y-2">
            <label
              htmlFor={inputId}
              className={cn(
                'text-base font-medium cursor-pointer transition-colors',
                dragActive
                  ? 'text-primary-700 dark:text-primary-300'
                  : 'text-gray-700 dark:text-gray-300',
                disabled && 'cursor-not-allowed'
              )}>
              {dragActive ? 'Drop files to add them' : placeholder}
            </label>

            {/* File constraints info */}
            <div className="space-y-1 text-sm text-gray-500">
              {maxFiles && <p>Maximum {maxFiles} files</p>}
              {fileExtensions && fileExtensions.length > 0 && (
                <p>Allowed types: {fileExtensions.join(', ')}</p>
              )}
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex gap-3">
            {/* Upload button */}
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => document.getElementById(inputId)?.click()}
              disabled={disabled}
              className="cursor-pointer">
              <FileUp />
              Choose Files
            </Button>

            {/* Browse existing button */}
            {showFilePicker && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={onBrowseExisting}
                disabled={disabled}>
                <FolderOpen />
                Browse Existing
              </Button>
            )}
          </div>
        </div>

        {/* Drag overlay for visual feedback */}
        {dragActive && (
          <div className="absolute inset-0 bg-primary-500/10 rounded-lg flex items-center justify-center backdrop-blur-sm">
            <div className="text-center">
              <Upload className="size-8 text-primary-600 mx-auto mb-2 animate-bounce" />
              <p className="text-lg font-semibold text-primary-700 dark:text-primary-300">
                Drop files to add them
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
