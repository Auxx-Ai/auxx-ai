// apps/web/src/components/files/utils/attachment-display.tsx

'use client'

import type { CommentAttachmentInfo } from '@auxx/lib/comments'
import { Button } from '@auxx/ui/components/button'
import { cn } from '@auxx/ui/lib/utils'
import { formatBytes, isPreviewableImage } from '@auxx/utils/file'
import { Trash2 } from 'lucide-react'
import type React from 'react'
import { FileIcon } from '~/components/files/utils/file-icon'
import { AttachmentThumbnail } from './attachment-thumbnail'

/**
 * Props for AttachmentDisplay component
 */
export interface AttachmentDisplayProps {
  attachment: CommentAttachmentInfo
  showRemoveButton?: boolean
  onRemove?: (attachmentId: string) => void
  className?: string
}

/**
 * AttachmentDisplay - Individual file display component for comment attachments
 *
 * Features:
 * - File metadata display (name, size, type icon)
 * - Click whole component to download (except remove button)
 * - Remove button for editing comments
 * - Support for both uploaded files and existing MediaAssets
 * - Clean, compact design matching comment composer style
 */
export function AttachmentDisplay({
  attachment,
  showRemoveButton = true,
  onRemove,
  className,
}: AttachmentDisplayProps) {
  const handleRemove = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    onRemove?.(attachment.id)
  }

  const handleDownload = () => {
    // Open download in new window to handle file download
    window.open(`/api/attachments/${attachment.id}/download`, '_blank')
  }

  const isImage = isPreviewableImage(attachment.mimeType)
  const isAudio = attachment.mimeType?.toLowerCase().startsWith('audio/') ?? false

  // Audio (voicemail / call recording) attachments get an inline player
  // instead of the click-to-download chip — nesting <audio controls> inside
  // the download <button> below would make play/seek clicks also trigger a
  // download navigation, so this is a separate, non-button container. The
  // player streams from the same `/download` route the button uses (a 302 to
  // a presigned URL); the route's Content-Disposition only applies to direct
  // navigation, not to a media element's fetch.
  if (isAudio) {
    return (
      <div
        className={cn(
          'flex flex-col gap-2 rounded-xl border bg-gray-50/50 p-2 ps-3 dark:bg-muted',
          className
        )}>
        <div className='flex min-w-0 items-center gap-3'>
          <FileIcon
            mimeType={attachment.mimeType || 'audio/mpeg'}
            className='size-4 shrink-0 text-gray-500'
          />
          <div className='min-w-0 flex-1'>
            <span className='block truncate text-sm font-medium' title={attachment.name}>
              {attachment.name}
            </span>
            {attachment.size && (
              <div className='text-xs text-gray-500'>{formatBytes(attachment.size ?? 0)}</div>
            )}
          </div>
          {showRemoveButton && onRemove && (
            <Button
              variant='ghost'
              size='icon-sm'
              onClick={handleRemove}
              title='Remove file'
              className='rounded-full hover:bg-bad-200/50 hover:text-bad-500'>
              <Trash2 />
            </Button>
          )}
        </div>
        <audio
          controls
          preload='none'
          className='h-8 w-full min-w-0'
          src={`/api/attachments/${attachment.id}/download`}>
          <track kind='captions' />
        </audio>
      </div>
    )
  }

  return (
    <button
      onClick={handleDownload}
      className={cn(
        'flex items-center gap-3 p-2 ps-3 rounded-xl border bg-gray-50/50 dark:bg-muted',
        'transition-all hover:bg-gray-100 dark:hover:bg-muted/80 cursor-pointer',
        'text-left w-full',
        className
      )}
      aria-label={`Download ${attachment.name}`}
      type='button'>
      {isImage ? (
        <AttachmentThumbnail
          attachmentId={attachment.id}
          alt={attachment.name}
          className='size-12 object-cover rounded'
          fallback={
            <FileIcon
              mimeType={attachment.mimeType || 'application/octet-stream'}
              className='size-4 text-gray-500 flex-shrink-0'
            />
          }
        />
      ) : (
        <FileIcon
          mimeType={attachment.mimeType || 'application/octet-stream'}
          className='size-4 text-gray-500 flex-shrink-0'
        />
      )}

      <div className='flex-1 min-w-0'>
        <div className='flex items-center gap-2'>
          <span className='text-sm font-medium truncate' title={attachment.name}>
            {attachment.name}
          </span>
        </div>
        {attachment.size && (
          <div className='text-xs text-gray-500'>{formatBytes(attachment.size ?? 0)}</div>
        )}
      </div>

      {showRemoveButton && onRemove && (
        <Button
          variant='ghost'
          size='icon-sm'
          onClick={handleRemove}
          title='Remove file'
          className='hover:bg-bad-200/50 hover:text-bad-500 rounded-full'>
          <Trash2 />
        </Button>
      )}
    </button>
  )
}
