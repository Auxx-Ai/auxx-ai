// apps/web/src/components/datasets/documents/document-columns.tsx
'use client'

import { FileText, Calendar, HardDrive, FileType, Hash, ToggleLeft } from 'lucide-react'
import { Badge } from '@auxx/ui/components/badge'
import { DocumentNameCell } from './document-name-cell'
import { DocumentStatus } from './document-utils'
import type { ExtendedColumnDef } from '~/components/dynamic-table'
import { FormattedCell } from '~/components/dynamic-table'
import { ItemsCellView } from '~/components/ui/items-list-view'
import type { DocumentStatus as DocumentStatusType } from '@auxx/database/types'
import type { DocumentEntity as Document } from '@auxx/database/models'

/**
 * Actions configuration for document columns
 */
interface DocumentColumnsActions {
  onViewDetails: (document: Document) => void
  onDownload: (document: Document) => void
  onDelete: (document: Document) => void
  onArchive: (document: Document) => void
  onUnarchive: (document: Document) => void
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
        />
      ),
      enableHiding: false,
      columnType: 'text',
      icon: FileText,
      minSize: 200,
      maxSize: 400,
      size: 300,
      defaultPinned: true,
    },
    {
      accessorKey: 'status',
      header: 'Status',
      cell: ({ row }) => {
        const status = row.getValue('status') as DocumentStatusType
        return (
          <ItemsCellView
            item={{ id: status }}
            renderItem={() => <DocumentStatus status={status} size="sm" />}
          />
        )
      },
      columnType: 'select',
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
                <Badge variant="green">Available</Badge>
              ) : (
                <Badge variant="gray">Disabled</Badge>
              )
            }
          />
        )
      },
      columnType: 'select',
      icon: ToggleLeft,
      size: 110,
    },
    {
      accessorKey: 'totalChunks',
      header: 'Segments',
      cell: ({ getValue }) => (
        <FormattedCell
          value={getValue() ?? 0}
          fieldType="NUMBER"
          columnId="totalChunks"
          formatting={{ type: 'number', decimalPlaces: 0 }}
        />
      ),
      columnType: 'number',
      fieldType: 'NUMBER',
      icon: Hash,
      size: 100,
    },
    {
      accessorKey: 'size',
      header: 'Size',
      cell: ({ getValue }) => (
        <FormattedCell
          value={getValue()}
          fieldType="NUMBER"
          columnId="size"
          formatting={{ type: 'number', displayAs: 'bytes', decimalPlaces: 2 }}
        />
      ),
      columnType: 'number',
      fieldType: 'NUMBER',
      icon: HardDrive,
      size: 100,
    },
    {
      accessorKey: 'mimeType',
      header: 'Type',
      cell: ({ getValue }) => (
        <FormattedCell
          value={getValue()}
          fieldType="TEXT"
          columnId="mimeType"
          className="font-mono"
        />
      ),
      columnType: 'text',
      fieldType: 'TEXT',
      icon: FileType,
      size: 100,
    },
    {
      accessorKey: 'createdAt',
      header: 'Uploaded',
      cell: ({ getValue }) => (
        <FormattedCell value={getValue()} fieldType="DATE" columnId="createdAt" />
      ),
      columnType: 'date',
      fieldType: 'DATE',
      icon: Calendar,
      size: 140,
    },
  ]
}
