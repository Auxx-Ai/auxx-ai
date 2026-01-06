// apps/web/src/components/workflow/share/inputs/public-file-input.tsx

'use client'

import { useState, useCallback, useRef, useId } from 'react'
import { FileUp, Loader2, AlertCircle, Trash2 } from 'lucide-react'
import { cn } from '@auxx/ui/lib/utils'
import { formatBytes } from '@auxx/utils/file'
import { Button } from '@auxx/ui/components/button'
import { FileIcon } from '~/components/files/utils/file-icon'

/**
 * File metadata returned from upload completion
 * Includes assetId + versionId for version locking support
 */
export interface PublicFileMetadata {
  id: string
  fileId: string
  assetId: string
  versionId: string
  filename: string
  mimeType: string
  size: number
  url?: string
}

/**
 * Internal file state for tracking uploads
 */
interface FileUploadState {
  id: string
  file: File
  status: 'pending' | 'uploading' | 'completed' | 'failed'
  progress: number
  error?: string
  result?: PublicFileMetadata
}

/**
 * Props for PublicFileInput component
 */
export interface PublicFileInputProps {
  name: string
  value: PublicFileMetadata | PublicFileMetadata[] | null
  onChange: (name: string, value: PublicFileMetadata | PublicFileMetadata[] | null) => void
  allowMultiple?: boolean
  maxFiles?: number
  maxFileSize?: number
  allowedTypes?: string[]
  disabled?: boolean
  shareToken: string
  passport: string
  nodeId: string
  placeholder?: string
}

/**
 * Simple public file upload component
 * Auto-uploads files immediately on selection
 * Uses passport authentication for shared workflow file uploads
 */
export function PublicFileInput({
  name,
  value,
  onChange,
  allowMultiple = false,
  maxFiles = 10,
  maxFileSize,
  allowedTypes,
  disabled,
  shareToken,
  passport,
  nodeId,
  placeholder = 'Drop files here or click to select',
}: PublicFileInputProps) {
  const inputId = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const [fileStates, setFileStates] = useState<FileUploadState[]>([])
  const [isDragOver, setIsDragOver] = useState(false)

  // Get completed files from value prop
  const completedFiles = Array.isArray(value) ? value : value ? [value] : []
  const hasFiles = fileStates.length > 0 || completedFiles.length > 0
  const isUploading = fileStates.some((f) => f.status === 'uploading')

  /**
   * Upload a single file to S3 via presigned URL
   */
  const uploadFile = useCallback(
    async (fileState: FileUploadState): Promise<PublicFileMetadata> => {
      const { file } = fileState

      // 1. Create upload session
      const sessionRes = await fetch(`/api/workflows/shared/${shareToken}/files/sessions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${passport}`,
        },
        body: JSON.stringify({
          filename: file.name,
          mimeType: file.type || 'application/octet-stream',
          size: file.size,
          nodeId,
        }),
      })

      if (!sessionRes.ok) {
        const err = await sessionRes.json().catch(() => ({}))
        throw new Error(err.error || 'Failed to create upload session')
      }

      const { sessionId, presignedUrl, fields, method } = await sessionRes.json()

      // 2. Upload directly to S3 with progress tracking
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest()

        xhr.upload.addEventListener('progress', (e) => {
          if (e.lengthComputable) {
            const progress = Math.round((e.loaded / e.total) * 100)
            setFileStates((prev) =>
              prev.map((f) => (f.id === fileState.id ? { ...f, progress } : f))
            )
          }
        })

        xhr.addEventListener('load', () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            resolve()
          } else {
            reject(new Error('Upload failed'))
          }
        })

        xhr.addEventListener('error', () => reject(new Error('Upload failed')))

        if (method === 'POST' && fields) {
          const formData = new FormData()
          Object.entries(fields).forEach(([key, val]) => formData.append(key, val as string))
          formData.append('file', file)
          xhr.open('POST', presignedUrl)
          xhr.send(formData)
        } else {
          xhr.open('PUT', presignedUrl)
          xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream')
          xhr.send(file)
        }
      })

      // 3. Complete upload
      const completeRes = await fetch(
        `/api/workflows/shared/${shareToken}/files/${sessionId}/complete`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${passport}` },
        }
      )

      if (!completeRes.ok) {
        const err = await completeRes.json().catch(() => ({}))
        throw new Error(err.error || 'Failed to complete upload')
      }

      return await completeRes.json()
    },
    [shareToken, passport, nodeId]
  )

  /**
   * Upload a single file and update state
   */
  const processFile = useCallback(
    async (fileState: FileUploadState) => {
      // Update to uploading
      setFileStates((prev) =>
        prev.map((f) =>
          f.id === fileState.id ? { ...f, status: 'uploading' as const, progress: 0 } : f
        )
      )

      try {
        // Validate file size
        if (maxFileSize && fileState.file.size > maxFileSize) {
          throw new Error(`File exceeds maximum size of ${formatBytes(maxFileSize)}`)
        }

        // Validate file type (supports MIME patterns and extension patterns)
        if (allowedTypes?.length) {
          const fileExtension = '.' + fileState.file.name.split('.').pop()?.toLowerCase()
          const fileMimeType = fileState.file.type

          const isAllowed = allowedTypes.some((type) => {
            // Extension pattern (e.g., ".pdf", ".doc")
            if (type.startsWith('.')) {
              return fileExtension === type.toLowerCase()
            }
            // Wildcard MIME pattern (e.g., "image/*")
            if (type.endsWith('/*')) {
              return fileMimeType.startsWith(type.slice(0, -2))
            }
            // Exact MIME type (e.g., "application/pdf")
            return fileMimeType === type
          })

          if (!isAllowed) {
            throw new Error(`File type ${fileExtension} not allowed`)
          }
        }

        const result = await uploadFile(fileState)

        // Update to completed
        setFileStates((prev) => {
          const updated = prev.map((f) =>
            f.id === fileState.id
              ? { ...f, status: 'completed' as const, progress: 100, result }
              : f
          )

          // After state update, update parent with completed files
          const allCompleted = updated.filter((f) => f.status === 'completed')
          const newResults = allCompleted.map((f) => f.result!)

          // Notify parent
          setTimeout(() => {
            if (allowMultiple) {
              onChange(name, [...completedFiles, ...newResults])
            } else {
              onChange(name, newResults[0] || null)
            }
            // Remove from local state after adding to parent
            setFileStates((s) => s.filter((f) => f.status !== 'completed'))
          }, 500) // Brief delay to show completion state

          return updated
        })
      } catch (err) {
        setFileStates((prev) =>
          prev.map((f) =>
            f.id === fileState.id
              ? {
                  ...f,
                  status: 'failed' as const,
                  error: err instanceof Error ? err.message : 'Upload failed',
                }
              : f
          )
        )
      }
    },
    [maxFileSize, allowedTypes, allowMultiple, completedFiles, name, onChange, uploadFile]
  )

  /**
   * Handle file selection - auto upload immediately
   */
  const handleFilesSelected = useCallback(
    async (files: File[]) => {
      const availableSlots = maxFiles - completedFiles.length - fileStates.length
      const filesToAdd = files.slice(0, allowMultiple ? availableSlots : 1)

      if (filesToAdd.length === 0) return

      // Create file states
      const newFileStates: FileUploadState[] = filesToAdd.map((file) => ({
        id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        file,
        status: 'pending' as const,
        progress: 0,
      }))

      if (!allowMultiple) {
        setFileStates(newFileStates)
      } else {
        setFileStates((prev) => [...prev, ...newFileStates])
      }

      // Auto-upload each file
      for (const fileState of newFileStates) {
        await processFile(fileState)
      }
    },
    [maxFiles, completedFiles.length, fileStates.length, allowMultiple, processFile]
  )

  /**
   * Remove a file
   */
  const handleRemoveFile = useCallback(
    (fileId: string) => {
      const isPending = fileStates.some((f) => f.id === fileId)
      if (isPending) {
        setFileStates((prev) => prev.filter((f) => f.id !== fileId))
      } else {
        const newCompleted = completedFiles.filter((f) => f.id !== fileId)
        onChange(name, allowMultiple && newCompleted.length > 0 ? newCompleted : null)
      }
    },
    [fileStates, completedFiles, allowMultiple, name, onChange]
  )

  /**
   * Handle native file input change
   */
  const handleFileInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files || [])
      if (files.length > 0) {
        handleFilesSelected(files)
        e.target.value = ''
      }
    },
    [handleFilesSelected]
  )

  /**
   * Handle drag and drop
   */
  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      setIsDragOver(false)
      if (!disabled) {
        const files = Array.from(e.dataTransfer.files)
        if (files.length > 0) handleFilesSelected(files)
      }
    },
    [handleFilesSelected, disabled]
  )

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(true)
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(false)
  }, [])

  // Build accept string for file input
  const acceptTypes = allowedTypes?.length ? allowedTypes.join(',') : undefined

  return (
    <div
      className={cn(
        'flex-1 flex flex-col transition-colors min-h-8.5 pe-1',
        !hasFiles && 'cursor-pointer ',
        isDragOver && 'border-primary-500 bg-primary-200/50',
        disabled && 'opacity-50 cursor-not-allowed'
      )}
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}>
      <input
        ref={inputRef}
        type="file"
        multiple={allowMultiple}
        onChange={handleFileInput}
        className="sr-only"
        id={inputId}
        accept={acceptTypes}
        disabled={disabled}
      />

      {hasFiles ? (
        <div className="space-y-1 w-full">
          {/* Files being uploaded (shown until moved to completedFiles after 500ms delay) */}
          {fileStates.map((fileState) => (
            <FileItem
              key={fileState.id}
              id={fileState.id}
              filename={fileState.file.name}
              mimeType={fileState.file.type}
              size={fileState.file.size}
              status={fileState.status}
              progress={fileState.progress}
              error={fileState.error}
              onRemove={handleRemoveFile}
            />
          ))}

          {/* Completed files from value prop */}
          {completedFiles.map((file) => (
            <FileItem
              key={file.id}
              id={file.id}
              filename={file.filename}
              mimeType={file.mimeType}
              size={file.size}
              onRemove={handleRemoveFile}
            />
          ))}

          {/* Add more link if multiple allowed */}
          {allowMultiple &&
            completedFiles.length + fileStates.length < maxFiles &&
            !isUploading && (
              <label
                htmlFor={inputId}
                className="block text-sm text-primary-400 cursor-pointer hover:underline py-1">
                + Add more files
              </label>
            )}
        </div>
      ) : (
        <label
          htmlFor={inputId}
          className="cursor-pointer flex flex-row items-center gap-1 h-8.5 flex-1">
          <FileUp className="size-4 text-primary-400" />
          <p className="text-sm text-primary-400">{placeholder}</p>
          {maxFileSize && (
            <p className="text-xs text-primary-400">Max file size: {formatBytes(maxFileSize)}</p>
          )}
        </label>
      )}
    </div>
  )
}

/**
 * Props for unified FileItem component
 */
interface FileItemProps {
  id: string
  filename: string
  mimeType: string
  size: number
  status?: 'pending' | 'uploading' | 'failed'
  progress?: number
  error?: string
  onRemove: (id: string) => void
}

/**
 * Unified file item component for displaying both uploading and completed files
 */
function FileItem({
  id,
  filename,
  mimeType,
  size,
  status,
  progress = 0,
  error,
  onRemove,
}: FileItemProps) {
  const isUploading = status === 'uploading'
  const isFailed = status === 'failed'
  const isCompleted = !status

  return (
    <div
      className={cn(
        'flex items-center gap-1 ps-0.5 h-8.5 pe-0.5 rounded-2xl border bg-gray-50/50 dark:bg-muted',
        'transition-all hover:bg-gray-100 dark:hover:bg-muted/80',
        'w-full overflow-hidden relative',
        isFailed && 'border-bad-200 bg-bad-50 dark:bg-bad-950/20'
      )}>
      {/* Progress bar - only when uploading */}
      {isUploading && (
        <div
          className="absolute inset-0 bg-primary-500/10 pointer-events-none transition-all duration-200"
          style={{ width: `${progress}%` }}
        />
      )}
      <div className="flex items-center justify-center size-7 bg-primary-200/50 rounded-full">
        <FileIcon mimeType={mimeType} className="size-4 text-primary-400 flex-shrink-0 z-10 " />
      </div>

      <div className="flex-1 min-w-0 z-10">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium truncate" title={filename}>
            {filename}
          </span>
          {/* Size inline for completed files */}
          {isCompleted ? (
            <div className="text-xs text-primary-400">{formatBytes(size)}</div>
          ) : (
            <div className="text-xs text-gray-500">
              {error ? (
                <span className="text-bad-500">{error}</span>
              ) : isUploading ? (
                <span className="text-primary-500">{progress}% uploading...</span>
              ) : (
                formatBytes(size)
              )}
            </div>
          )}
        </div>
      </div>

      <div className="flex items-center z-10">
        {isUploading && <Loader2 className="size-4 animate-spin text-primary-500" />}
        {isFailed && <AlertCircle className="size-4 text-bad-500" />}

        <Button
          variant="ghost"
          size="icon-sm"
          onClick={(e) => {
            e.stopPropagation()
            onRemove(id)
          }}
          disabled={isUploading}
          className="hover:bg-bad-200/50 hover:text-bad-500 rounded-full"
          title="Remove file">
          <Trash2 />
        </Button>
      </div>
    </div>
  )
}
