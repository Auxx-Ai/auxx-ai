// apps/web/src/components/file-upload/ui/file-item.tsx

'use client'

import React, { useMemo } from 'react'
import { cn } from '@auxx/ui/lib/utils'
import { Button } from '@auxx/ui/components/button'
import { CircularProgress } from '@auxx/ui/components/progress'
import { RotateCcw, Pause, Trash2 } from 'lucide-react'
import { useUploadStore, selectFile, selectFileProgress, selectFileStatus } from '../stores'
import { formatBytes } from '@auxx/utils/file'
import { FileIcon } from '~/components/files/utils/file-icon'
import {
  FileStatusDisplay,
  type FileStatus,
  canRetryStatus,
  canCancelStatus,
  isActiveStatus,
  isErrorStatus,
} from '~/components/files/utils/file-status'
import { Badge } from '@auxx/ui/components/badge'
import type { FileItem as FileItemType } from '~/components/files/files-store'

/**
 * Props for FileItem component
 */
export interface FileItemProps {
  fileId?: string // For Zustand store lookup (optional if file prop is provided)
  file?: FileItemType // Direct data passing
  showControls?: boolean
  showSource?: boolean // Show upload/filesystem badge
  onRemove?: (fileId: string) => void
  onRetry?: (fileId: string) => void
  onCancel?: (fileId: string) => void
  onDeleteServer?: () => Promise<void>
  className?: string
}

/**
 * FileItem - Individual file display component with real-time progress
 *
 * Features:
 * - File metadata display (name, size, type icon)
 * - Real-time progress bar with stage indicators
 * - Status indicators with appropriate colors and icons
 * - Individual file controls (retry, cancel, remove)
 * - Error display with retry options
 * - Compact mode for dense layouts
 */
export function FileItem({
  fileId,
  file: fileProp, // Accept file data directly
  showControls = true,
  showSource = false, // Show upload/filesystem badge
  onRemove,
  onRetry,
  onCancel,
  onDeleteServer,
  className,
}: FileItemProps) {
  // Get file data from store OR props
  const fileFromStore = useUploadStore(fileId ? selectFile(fileId) : () => null)
  const file = fileProp || fileFromStore

  // Adapt status/progress for direct data
  const statusFromStore = useUploadStore(fileId ? selectFileStatus(fileId) : () => 'ready')
  const progressFromStore = useUploadStore(fileId ? selectFileProgress(fileId) : () => 0)

  const status = (fileProp?.status || statusFromStore) as FileStatus
  const progress = fileProp?.progress ?? progressFromStore

  // Store actions
  const removeFile = useUploadStore((state) => state.removeFile)
  const retryFile = useUploadStore((state) => state.retryFile)
  const cancelFile = useUploadStore((state) => state.cancelFile)

  // Handle actions
  const handleRemove = () => {
    const id = fileId || file?.id
    if (id) {
      if (fileId) {
        removeFile(fileId)
      }
      onRemove?.(id)
    }
  }

  const handleDeleteServer = async () => {
    if (onDeleteServer) {
      await onDeleteServer()
    }
  }

  const handleRetry = () => {
    const id = fileId || file?.id
    if (id) {
      if (fileId) {
        retryFile(fileId)
      }
      onRetry?.(id)
    }
  }

  const handleCancel = () => {
    const id = fileId || file?.id
    if (id) {
      if (fileId) {
        cancelFile(fileId)
      }
      onCancel?.(id)
    }
  }

  if (!file) {
    return null
  }

  const isFailed = isErrorStatus(status)
  const isActive = isActiveStatus(status)
  const canRetry = canRetryStatus(status)
  const canCancel = canCancelStatus(status)
  const isDeleting = status === 'deleting'

  return (
    <div
      className={cn(
        'group/file-item overflow-hidden relative duration-100 flex items-center gap-1 p-1 ps-2 rounded-2xl border transition-all',
        isFailed && 'border-bad-200/50 text-bad-500 bg-bad-100/50',
        status === 'deleting' && 'opacity-50 pointer-events-none', // Disable during deletion
        className
      )}>
      <div
        className={cn(
          'absolute inset-0 transition-all duration-200 bg-primary-500/5 pointer-events-none',
          isFailed && 'bg-bad-500/5'
        )}
        style={{ width: `${progress}%` }}
      />
      <FileIcon
        mimeType={file.mimeType || (file as any).file?.type}
        className="size-4 text-gray-500 flex-shrink-0"
      />

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium truncate" title={file.name}>
            {file.name}
          </span>
          <FileStatusDisplay status={status} variant="icon" size="sm" showLabel={false} />
          {/* Source badge */}
          {showSource && file.source && (
            <Badge variant="secondary" className="text-xs">
              {file.source === 'upload' ? 'Upload' : 'Filesystem'}
            </Badge>
          )}
        </div>
      </div>

      <div className="flex items-center">
        <span className="text-xs text-gray-500 me-1">
          {formatBytes(file.displaySize || (file.size ? Number(file.size) : 0))}
        </span>

        {showControls && (
          <>
            {status === 'completed' && onDeleteServer ? (
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={handleDeleteServer}
                loading={isDeleting}
                title={isDeleting ? 'Deleting...' : 'Delete on server'}
                className=" hover:bg-bad-200/50 hover:text-bad-500 rounded-full">
                <Trash2 />
              </Button>
            ) : (
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={handleRemove}
                loading={isDeleting}
                title="Remove file"
                className=" hover:bg-bad-200/50 hover:text-bad-500 rounded-full">
                <Trash2 />
              </Button>
            )}
          </>
        )}
        {isActive && (
          <div className="relative flex items-center w-7 shrink-0">
            {canCancel && (
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={handleCancel}
                className="opacity-0 group-hover/file-item:opacity-100 hover:bg-primary-200 absolute z-3 transition-all rounded-full right-[0px]">
                <Pause />
              </Button>
            )}
            {canRetry && (
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={handleRetry}
                className="rounded-full hover:bg-accent-200 bg-accent-100">
                <RotateCcw />
              </Button>
            )}
            <div className="">
              <CircularProgress
                value={progress}
                // size={100}
                className="h-7 text-xs text-normal group-hover/file-item:opacity-0 transition-all shrink-0"
                gaugePrimary="text-accent-500"
                gaugeSecondary="text-primary-200"
              />
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
