// apps/web/src/components/datasets/documents/document-name-cell.tsx
'use client'

import {
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@auxx/ui/components/dropdown-menu'
import { Download, Eye, Trash2, Archive, ArchiveRestore } from 'lucide-react'
import { FileIcon } from '~/components/files/utils/file-icon'
import type { DocumentEntity as Document } from '@auxx/database/models'
import { PrimaryCell } from '~/components/dynamic-table'

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
 * Uses PrimaryCell component for consistent styling
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
    <PrimaryCell
      value={displayName}
      prefixIcon={
        <FileIcon
          mimeType={document.mimeType || undefined}
          ext={fileExtension}
          className="size-4 shrink-0"
        />
      }
      onTitleClick={() => onViewDetails(document)}>
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
    </PrimaryCell>
  )
}
