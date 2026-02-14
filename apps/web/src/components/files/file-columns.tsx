// apps/web/src/components/files/file-columns.tsx

'use client'

import { cn } from '@auxx/ui/lib/utils'
import { formatBytes, getDirectoryPath } from '@auxx/utils/file'
import type { ExtendedColumnDef } from '~/components/dynamic-table'
import { CellPadding, FormattedCell } from '~/components/dynamic-table'
import { FileNameCell } from './file-name-cell'
import type { FileItem } from './files-store'
import { getStandardFileType } from './utils/file-type'

/**
 * Interface for actions that can be performed on files
 */
interface FileColumnsActions {
  onItemClick: (item: FileItem) => void
  onQuickView: (item: FileItem) => void
  onNavigate: (folderId: string | null) => void
  onRetryUpload?: (tempId: string) => void
  onCancelUpload?: (tempId: string) => void
  onDelete?: (item: FileItem) => void
  onDownload?: (item: FileItem) => void
  onRename?: (item: FileItem) => void
  isMoving?: (id: string) => boolean
}

/**
 * Create table columns for the files list
 * Now uses FileNameCell component with integrated actions (following ContactNameCell pattern)
 */
export function createFileColumns(actions: FileColumnsActions): ExtendedColumnDef<FileItem>[] {
  return [
    // Name column with integrated actions (following ContactNameCell pattern)
    {
      accessorKey: 'name',
      header: 'Name',
      minSize: 300,
      primaryCell: true,
      enableHiding: false,
      defaultVisible: true,
      cell: ({ row }) => (
        <FileNameCell
          item={row.original}
          depth={row.depth}
          isMoving={actions.isMoving?.(row.original.id)}
          actions={actions}
        />
      ),
    },

    // Size column
    {
      accessorKey: 'displaySize',
      header: 'Size',
      defaultVisible: true,
      cell: ({ row }) => {
        const item = row.original
        const isUploading = item.isUploading

        if (item.type === 'folder') {
          return <CellPadding className='text-sm text-muted-foreground'>—</CellPadding>
        }

        return (
          <CellPadding>
            <div className='flex items-center gap-2'>
              <span className={cn('text-sm text-muted-foreground', isUploading && 'text-blue-600')}>
                {formatBytes(item.displaySize)}
              </span>
              {isUploading && item.status === 'uploading' && item.progress !== undefined && (
                <div className='text-xs text-blue-600'>({item.progress}%)</div>
              )}
            </div>
          </CellPadding>
        )
      },
    },

    // Type column
    {
      accessorKey: 'type',
      header: 'Type',
      defaultVisible: true,
      cell: ({ row }) => {
        const item = row.original
        if (item.type === 'folder') {
          return <CellPadding className='text-sm font-medium'>Folder</CellPadding>
        }
        const standardType = getStandardFileType(item.mimeType, item.ext)
        return <CellPadding className='text-sm font-mono'>{standardType}</CellPadding>
      },
    },

    // Created column
    {
      accessorKey: 'createdAt',
      header: 'Created',
      fieldType: 'DATE',
      columnType: 'date',
      defaultVisible: true,
      cell: ({ getValue }) => (
        <FormattedCell value={getValue()} fieldType='DATE' columnId='createdAt' />
      ),
    },

    // Path column
    {
      accessorKey: 'path',
      header: 'Path',
      defaultVisible: true,
      cell: ({ row }) => {
        const item = row.original
        const fullPath = item.path || '/'
        const displayPath = item.hierarchy?.folderPath || getDirectoryPath(fullPath)

        return (
          <CellPadding className='text-sm text-muted-foreground font-mono' title={fullPath}>
            {displayPath}
          </CellPadding>
        )
      },
    },

    // NOTE: Actions column REMOVED - now integrated into FileNameCell
  ]
}
