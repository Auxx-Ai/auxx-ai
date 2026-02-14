// apps/web/src/components/files/file-name-cell.tsx

'use client'

import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@auxx/ui/components/dropdown-menu'
import { Progress } from '@auxx/ui/components/progress'
import { cn } from '@auxx/ui/lib/utils'
import {
  AlertCircle,
  CheckCircle,
  Clock,
  Download,
  FolderIcon,
  Loader2,
  MoreVertical,
  PanelRight,
  Pencil,
  RotateCcw,
  Trash2,
  X,
} from 'lucide-react'
import type { FileItem } from './files-store'
import { getFileIcon } from './utils/file-icon'

/**
 * Props for FileNameCell actions
 */
interface FileNameCellActions {
  onItemClick: (item: FileItem) => void
  onQuickView: (item: FileItem) => void
  onNavigate: (folderId: string | null) => void
  onRetryUpload?: (tempId: string) => void
  onCancelUpload?: (tempId: string) => void
  onDelete?: (item: FileItem) => void
  onDownload?: (item: FileItem) => void
  onRename?: (item: FileItem) => void
}

/**
 * Props for FileNameCell component
 */
interface FileNameCellProps {
  item: FileItem
  depth?: number
  isMoving?: boolean
  actions: FileNameCellActions
}

/**
 * Upload status icon component with progress indication
 */
function UploadStatusIcon({ status, progress }: { status: string; progress?: number }) {
  switch (status) {
    case 'pending':
      return <Clock className='size-4 text-yellow-600' />
    case 'uploading':
      return (
        <div className='relative'>
          <div className='size-4 border-2 border-blue-600 border-t-transparent rounded-full animate-spin' />
          {progress !== undefined && (
            <div className='absolute inset-0 flex items-center justify-center'>
              <span className='text-[8px] font-bold text-blue-600'>{Math.round(progress)}</span>
            </div>
          )}
        </div>
      )
    case 'processing':
      return <Loader2 className='size-4 text-blue-600 animate-spin' />
    case 'failed':
      return <AlertCircle className='size-4 text-red-600' />
    case 'cancelled':
      return <X className='size-4 text-gray-600' />
    case 'completed':
      return <CheckCircle className='size-4 text-green-600' />
    default:
      return null
  }
}

/**
 * FileNameCell component with integrated actions dropdown
 * Follows the same pattern as ContactNameCell with hover-based dropdown visibility
 * Handles its own padding for proper table cell layout
 */
export function FileNameCell({ item, depth = 0, isMoving = false, actions }: FileNameCellProps) {
  const {
    onItemClick,
    onQuickView,
    onNavigate,
    onRetryUpload,
    onCancelUpload,
    onDelete,
    onDownload,
    onRename,
  } = actions

  const isUploading = item.isUploading
  const isFolder = item.type === 'folder'
  const isCurrentlyMoving = item.isOptimisticMove || isMoving

  // Calculate left padding: base pl-3 (0.75rem) + depth indentation
  const leftPadding = `${0.75 + depth * 1.5}rem`

  return (
    <div
      className='flex items-center justify-between w-full pr-2 text-sm group/name'
      style={{ paddingLeft: leftPadding }}>
      {/* Left side: Icon + Name + Status */}
      <div
        className={cn('flex items-center gap-3 flex-1 min-w-0', !isUploading && 'cursor-pointer')}
        onClick={!isUploading ? () => onItemClick(item) : undefined}>
        {/* Icon */}
        {isUploading && item.status ? (
          <UploadStatusIcon status={item.status} progress={item.progress} />
        ) : isFolder ? (
          <FolderIcon className='size-4 text-blue-600 shrink-0' />
        ) : (
          getFileIcon(item.mimeType, item.ext, 'size-4 shrink-0')
        )}

        <div className='min-w-0 flex-1'>
          <div className='flex items-center gap-2'>
            <p
              className={cn(
                'font-medium truncate',
                isUploading && 'text-muted-foreground',
                isCurrentlyMoving && 'text-amber-700 dark:text-amber-300'
              )}>
              {item.name}
            </p>

            {/* Moving indicator */}
            {isCurrentlyMoving && (
              <div className='flex items-center gap-1 text-xs text-amber-600 shrink-0'>
                <Loader2 className='size-3 animate-spin' />
                <span>Moving...</span>
              </div>
            )}

            {/* Upload status badge */}
            {isUploading && item.status && (
              <Badge variant='secondary' className='text-xs capitalize shrink-0'>
                {item.status}
              </Badge>
            )}
          </div>

          {/* Upload Progress Bar */}
          {isUploading && item.status === 'uploading' && item.progress !== undefined && (
            <div className='mt-1'>
              <Progress value={item.progress} className='h-1.5' />
            </div>
          )}

          {/* Upload Error */}
          {isUploading && item.error && (
            <p className='text-red-600 text-xs mt-1 truncate'>{item.error}</p>
          )}
        </div>
      </div>

      {/* Right side: Actions dropdown */}
      <div onClick={(e) => e.stopPropagation()} className='shrink-0'>
        {isUploading ? (
          // Upload-specific actions
          <div className='flex items-center gap-1'>
            {item.status === 'failed' && onRetryUpload && (
              <Button
                variant='ghost'
                size='sm'
                className='size-6 p-0'
                onClick={() => onRetryUpload(item.tempId!)}
                title='Retry Upload'>
                <RotateCcw className='size-3' />
              </Button>
            )}
            {['pending', 'uploading'].includes(item.status!) && onCancelUpload && (
              <Button
                variant='ghost'
                size='sm'
                className='size-6 p-0'
                onClick={() => onCancelUpload(item.tempId!)}
                title='Cancel Upload'>
                <X className='size-3' />
              </Button>
            )}
          </div>
        ) : (
          // Regular file/folder actions dropdown
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant='ghost'
                size='icon-sm'
                className='opacity-0 group-hover/name:opacity-100 transition-opacity data-[state=open]:opacity-100! rounded-full'>
                <MoreVertical />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align='end'>
              <DropdownMenuItem onClick={() => onQuickView(item)}>
                <PanelRight />
                Quick View
              </DropdownMenuItem>

              {onRename && (
                <DropdownMenuItem onClick={() => onRename(item)}>
                  <Pencil />
                  Rename
                </DropdownMenuItem>
              )}

              {item.type === 'file' && onDownload && (
                <DropdownMenuItem onClick={() => onDownload(item)}>
                  <Download />
                  Download
                </DropdownMenuItem>
              )}

              {item.type === 'folder' && (
                <DropdownMenuItem onClick={() => onNavigate(item.id)}>
                  <FolderIcon />
                  Open Folder
                </DropdownMenuItem>
              )}

              <DropdownMenuSeparator />

              {onDelete && (
                <DropdownMenuItem variant='destructive' onClick={() => onDelete(item)}>
                  <Trash2 />
                  Delete
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </div>
  )
}
