// apps/web/src/components/workflow/nodes/shared/node-inputs/file-input.tsx

'use client'

import { Button } from '@auxx/ui/components/button'
import { File as FileIcon } from 'lucide-react'
import React, { useEffect, useMemo, useState } from 'react'
import { useFileSystemStore } from '~/components/files/files-store'
import { CommentFile } from '~/components/global/comments/comment-file'
import type { FileSelection } from '~/components/pickers/files-picker'
import { FilesPicker } from '~/components/pickers/files-picker'
import { createNodeInput, type NodeInputProps } from './base-node-input'

interface FileInputProps extends NodeInputProps {
  /** Field name */
  name: string
  /** Placeholder text */
  placeholder?: string
  /** Allow multiple file selection */
  allowMultiple?: boolean
  /** File type filtering */
  fileExtensions?: string[]
  /** Max file size limit */
  maxFileSize?: number
}

/**
 * File input component for selecting files from the filesystem
 * Stores file IDs as an array of strings
 */
export const FileInput = createNodeInput<FileInputProps>(
  ({
    inputs,
    errors,
    onChange,
    onError,
    isLoading,
    name,
    placeholder = 'Select files...',
    allowMultiple = true,
    fileExtensions,
    maxFileSize,
  }) => {
    // Get file IDs from inputs (stored as array, JSON string, or plain string ID)
    let fileIds: string[] = []
    const rawValue = inputs[name]

    if (Array.isArray(rawValue)) {
      fileIds = rawValue
    } else if (typeof rawValue === 'string' && rawValue) {
      try {
        const parsed = JSON.parse(rawValue)
        fileIds = Array.isArray(parsed) ? parsed : [parsed].filter((v) => typeof v === 'string')
      } catch {
        // Not valid JSON, treat as a single file ID string
        fileIds = [rawValue]
      }
    }

    // Access filesystem store to get file metadata
    const itemsById = useFileSystemStore((state) => state.itemsById)

    // Build file metadata for selected files
    const selectedFiles = useMemo(() => {
      return fileIds
        .map((fileId) => {
          const item = itemsById.get(fileId)
          if (!item) return null

          return {
            id: item.id,
            name: item.name,
            mimeType: item.mimeType,
            size: BigInt(item.displaySize || item.size || 0),
            source: 'existing' as const,
          }
        })
        .filter(Boolean) as Array<{
        id: string
        name: string
        mimeType?: string
        size: bigint
        source: 'existing'
      }>
    }, [fileIds, itemsById])

    // Handle file selection from picker
    const handleSelectionChange = (selection: FileSelection) => {
      const newFileIds = selection.files

      // Check for missing files first
      const missingFiles = newFileIds.filter((fileId) => !itemsById.has(fileId))
      if (missingFiles.length > 0) {
        onError(name, `${missingFiles.length} file(s) not found`)
        return
      }

      // Validate file types if specified
      if (fileExtensions && fileExtensions.length > 0) {
        const invalidFiles = newFileIds.filter((fileId) => {
          const item = itemsById.get(fileId)
          if (!item?.ext) return true
          return !fileExtensions.map((ext) => ext.toLowerCase()).includes(item.ext.toLowerCase())
        })

        if (invalidFiles.length > 0) {
          onError(name, `Invalid file type. Allowed types: ${fileExtensions.join(', ')}`)
          return
        }
      }

      // Validate file size if specified
      if (maxFileSize) {
        const oversizedFiles = newFileIds.filter((fileId) => {
          const item = itemsById.get(fileId)
          return item && (item.displaySize || item.size || 0) > maxFileSize
        })

        if (oversizedFiles.length > 0) {
          onError(name, `File size exceeds maximum limit`)
          return
        }
      }

      // Clear any validation errors
      onError(name, null)

      // Update parent with new file IDs
      onChange(name, newFileIds)
    }

    // Handle removing individual files
    const handleRemoveFile = (fileId: string) => {
      const newFileIds = fileIds.filter((id) => id !== fileId)
      onChange(name, newFileIds)
    }

    const inputId = `input-${name}`

    return (
      <div className='flex gap-2 w-full group' id={inputId}>
        {/* Left: Selected files display */}
        <div className='flex-1 min-w-0'>
          {selectedFiles.length === 0 ? (
            <span className='text-sm text-primary-400 truncate pointer-events-none'>
              {placeholder}
            </span>
          ) : (
            <div className='flex flex-row gap-1 max-h-[200px] overflow-y-auto'>
              {selectedFiles.map((file) => (
                <CommentFile
                  key={file.id}
                  file={file}
                  showRemoveButton={!isLoading}
                  showFileSize={false}
                  className='py-0 pe-0 ps-2 rounded-2xl'
                  onRemove={handleRemoveFile}
                />
              ))}
            </div>
          )}
        </div>

        {/* Right: File picker trigger */}
        <FilesPicker
          trigger={
            <Button
              size='icon-xs'
              variant='ghost'
              className='mt-[2px] hover:bg-primary-200/50'
              disabled={isLoading}
              type='button'
              title='Select files'>
              <FileIcon />
            </Button>
          }
          selectedFiles={fileIds}
          selectedFolders={[]}
          onChange={handleSelectionChange}
          allowFiles
          showPath
          allowFolders={false}
          allowMultiple={allowMultiple}
          fileExtensions={fileExtensions}
          maxFileSize={maxFileSize}
          enableGlobalSearch
          width={450}
          maxHeight={400}
        />
      </div>
    )
  }
)
