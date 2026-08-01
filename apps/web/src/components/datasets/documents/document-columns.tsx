// apps/web/src/components/datasets/documents/document-columns.tsx
'use client'

import type {
  DocumentEntity as Document,
  DocumentStatus as DocumentStatusType,
} from '@auxx/database/types'
import { Badge } from '@auxx/ui/components/badge'
import { Calendar, FileText, FileType, HardDrive, Hash, ToggleLeft } from 'lucide-react'
import type { ExtendedColumnDef } from '~/components/dynamic-table'
import { FormattedCell } from '~/components/dynamic-table'
import { ItemsCellView } from '~/components/ui/items-list-view'
import { DocumentNameCell } from './document-name-cell'
import { DocumentStatus } from './document-utils'

/**
 * Actions configuration for document columns
 */
interface DocumentColumnsActions {
  onViewDetails: (document: Document) => void
  onDownload: (document: Document) => void
  onDelete: (document: Document) => void
  onArchive: (document: Document) => void
  onUnarchive: (document: Document) => void
  /** Edit-instance gate on the parent dataset — hides archive/unarchive/delete when false. */
  canEdit: boolean
}

/**
 * Creates column definitions for the documents table
 * Actions are integrated into the DocumentNameCell component
 */
export function createDocumentColumns({
  onViewDetails,
  onDownload,
  onDelete,
  onArchive,
  onUnarchive,
  canEdit,
}: DocumentColumnsActions): ExtendedColumnDef<Document>[] {
  return [
    {
      accessorKey: 'filename',
      header: 'Document',
      cell: ({ row }) => (
        <DocumentNameCell
          document={row.original}
          onViewDetails={onViewDetails}
          onDownload={onDownload}
          onDelete={onDelete}
          onArchive={onArchive}
          onUnarchive={onUnarchive}
          canEdit={canEdit}
        />
      ),
      enableHiding: false,
      defaultVisible: true,
      fieldType: 'TEXT',
      icon: FileText,
      minSize: 200,
      maxSize: 400,
      size: 300,
      primaryCell: true,
    },
    {
      accessorKey: 'status',
      header: 'Status',
      cell: ({ row }) => {
        const status = row.getValue('status') as DocumentStatusType
        return (
          <ItemsCellView
            item={{ id: status }}
            renderItem={() => <DocumentStatus status={status} size='sm' />}
          />
        )
      },
      fieldType: 'SINGLE_SELECT',
      defaultVisible: true,
      icon: FileType,
      size: 120,
    },
    {
      accessorKey: 'enabled',
      header: 'Availability',
      cell: ({ row }) => {
        const enabled = row.getValue('enabled') as boolean
        return (
          <ItemsCellView
            item={{ id: String(enabled) }}
            renderItem={() =>
              enabled ? (
                <Badge variant='green'>Available</Badge>
              ) : (
                <Badge variant='gray'>Disabled</Badge>
              )
            }
          />
        )
      },
      fieldType: 'SINGLE_SELECT',
      defaultVisible: true,
      icon: ToggleLeft,
      size: 110,
    },
    {
      accessorKey: 'totalChunks',
      header: 'Segments',
      cell: ({ getValue }) => (
        <FormattedCell
          value={getValue() ?? 0}
          fieldType='NUMBER'
          columnId='totalChunks'
          formatting={{ type: 'number', decimalPlaces: 0 }}
        />
      ),
      fieldType: 'NUMBER',
      defaultVisible: true,
      icon: Hash,
      size: 100,
    },
    {
      accessorKey: 'size',
      header: 'Size',
      cell: ({ getValue }) => (
        <FormattedCell
          value={getValue()}
          fieldType='NUMBER'
          columnId='size'
          formatting={{ type: 'number', displayAs: 'bytes', decimalPlaces: 2 }}
        />
      ),
      fieldType: 'NUMBER',
      defaultVisible: true,
      icon: HardDrive,
      size: 100,
    },
    {
      accessorKey: 'mimeType',
      header: 'Type',
      cell: ({ getValue }) => (
        <FormattedCell value={getValue()} fieldType='TEXT' columnId='mimeType' />
      ),
      fieldType: 'TEXT',
      defaultVisible: true,
      icon: FileType,
      size: 100,
    },
    {
      accessorKey: 'createdAt',
      header: 'Uploaded',
      cell: ({ getValue }) => (
        <FormattedCell value={getValue()} fieldType='DATE' columnId='createdAt' />
      ),
      fieldType: 'DATE',
      defaultVisible: true,
      icon: Calendar,
      size: 140,
    },
  ]
}
