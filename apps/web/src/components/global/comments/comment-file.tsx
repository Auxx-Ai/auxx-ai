// apps/web/src/components/global/comments/comment-file.tsx
'use client'
import React from 'react'
import { cn } from '@auxx/ui/lib/utils'
import { Button } from '@auxx/ui/components/button'
import { Trash2 } from 'lucide-react'
import { formatBytes } from '@auxx/utils/file'
import { FileIcon } from '~/components/files/utils/file-icon'
import type { MediaAssetEntity as MediaAsset } from '@auxx/database/models'
/**
 * Props for CommentFile component
 */
export interface CommentFileProps {
  file:
    | {
        id: string
        name?: string
        mimeType?: string
        size?: bigint
        source: 'upload' | 'existing'
      }
    | MediaAsset
  showRemoveButton?: boolean
  showFileSize?: boolean
  onRemove?: (fileId: string) => void
  className?: string
}
/**
 * CommentFile - Individual file display component for comment attachments
 *
 * Features:
 * - File metadata display (name, size, type icon)
 * - Remove button for editing comments
 * - Support for both uploaded files and existing MediaAssets
 * - Clean, compact design matching comment composer style
 */
export function CommentFile({
  file,
  showRemoveButton = true,
  showFileSize = true,
  onRemove,
  className,
}: CommentFileProps) {
  const handleRemove = () => {
    onRemove?.(file.id)
  }
  const fileName = file.name || 'Untitled file'
  const fileSize = file.size ? Number(file.size) : 0
  const mimeType = file.mimeType || 'application/octet-stream'
  return (
    <div
      className={cn(
        'flex items-center gap-2 p-2 ps-3 rounded-xl border bg-gray-50/50 dark:bg-muted transition-all',
        className
      )}>
      <FileIcon mimeType={mimeType} className="size-4 text-gray-500 flex-shrink-0" />

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium truncate" title={fileName}>
            {fileName}
          </span>
        </div>
        {showFileSize && <div className="text-xs text-gray-500">{formatBytes(fileSize)}</div>}
      </div>

      {showRemoveButton && onRemove && (
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={handleRemove}
          title="Remove file"
          className="hover:bg-bad-200/50 hover:text-bad-500 rounded-full text-muted-foreground">
          <Trash2 />
        </Button>
      )}
    </div>
  )
}
