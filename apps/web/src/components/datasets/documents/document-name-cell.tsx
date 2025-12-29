// apps/web/src/components/datasets/documents/document-name-cell.tsx
'use client'

import { Button } from '@auxx/ui/components/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@auxx/ui/components/dropdown-menu'
import { MoreVertical, Download, Eye, Trash2, Archive, ArchiveRestore } from 'lucide-react'
import { FileIcon } from '~/components/files/utils/file-icon'
import type { DocumentEntity as Document } from '@auxx/database/models'

/**
 * Props for DocumentNameCell component
 */
interface DocumentNameCellProps {
  document: Document
  onViewDetails: (document: Document) => void
  onDownload: (document: Document) => void
  onDelete: (document: Document) => void
  onArchive: (document: Document) => void
  onUnarchive: (document: Document) => void
}

/**
 * Document name cell component with integrated actions
 * Shows the document name with file icon and actions dropdown on hover
 * Handles its own padding for proper table cell layout
 */
export function DocumentNameCell({
  document,
  onViewDetails,
  onDownload,
  onDelete,
  onArchive,
  onUnarchive,
}: DocumentNameCellProps) {
  const fileExtension = document.filename?.split('.').pop()
  const displayName = document.title || document.filename || 'Unnamed Document'

  return (
    <div className="flex items-center justify-between w-full pl-3 pr-2 text-sm group/name">
      <button
        className="flex items-center gap-1 text-left hover:underline decoration-muted-foreground/50 hover:decoration-primary truncate max-w-[calc(100%-40px)]"
        onClick={(e) => {
          e.stopPropagation()
          onViewDetails(document)
        }}>
        <FileIcon
          mimeType={document.mimeType || undefined}
          ext={fileExtension}
          className="size-4 shrink-0"
        />
        <span className="min-w-0 truncate">{displayName}</span>
      </button>

      <div onClick={(e) => e.stopPropagation()} className="shrink-0">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="size-6 p-0 opacity-0 group-hover/name:opacity-100 transition-opacity data-[state=open]:opacity-100!">
              <MoreVertical />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => onViewDetails(document)}>
              <Eye />
              View Details
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onDownload(document)}>
              <Download />
              Download
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            {document.status === 'ARCHIVED' ? (
              <DropdownMenuItem onClick={() => onUnarchive(document)}>
                <ArchiveRestore />
                Unarchive
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem onClick={() => onArchive(document)}>
                <Archive />
                Archive
              </DropdownMenuItem>
            )}
            <DropdownMenuItem variant="destructive" onClick={() => onDelete(document)}>
              <Trash2 />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  )
}
