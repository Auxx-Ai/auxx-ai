// apps/web/src/components/datasets/datasets-table-view.tsx

'use client'

import type { DatasetWithRelations } from '@auxx/lib/datasets'
import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@auxx/ui/components/dropdown-menu'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@auxx/ui/components/table'
import { formatBytes, formatRelativeTime } from '@auxx/utils'
import { Archive, MoreHorizontal, Search, Settings, Trash } from 'lucide-react'
import Link from 'next/link'
import { useDatasets } from './datasets-provider'
import { useDatasetActions } from './hooks/use-dataset-actions'

function DatasetTableRow({
  dataset,
  onActionComplete,
}: {
  dataset: DatasetWithRelations
  onActionComplete?: () => void
}) {
  const { handleBrowse, handleSettings, handleDelete, handleArchive, ConfirmDialog } =
    useDatasetActions({
      datasetId: dataset.id,
      datasetName: dataset.name,
      onSuccess: onActionComplete,
    })

  const getStatusVariant = (status: string) => {
    switch (status) {
      case 'ACTIVE':
        return 'bg-green-100 text-green-800'
      case 'PROCESSING':
        return 'bg-yellow-100 text-yellow-800'
      case 'ERROR':
        return 'bg-red-100 text-red-800'
      case 'ARCHIVED':
        return 'bg-gray-100 text-gray-800'
      default:
        return 'bg-gray-100 text-gray-800'
    }
  }

  return (
    <>
      <TableRow>
        <TableCell>
          <div>
            <Link
              href={`/app/datasets/${dataset.id}`}
              className='font-medium hover:text-primary hover:underline'>
              {dataset.name}
            </Link>
            {dataset.description && (
              <div className='text-sm text-muted-foreground truncate max-w-xs'>
                {dataset.description}
              </div>
            )}
          </div>
        </TableCell>

        <TableCell>
          <Badge className={getStatusVariant(dataset.status)} size='xs'>
            {dataset.status.toLowerCase()}
          </Badge>
        </TableCell>

        <TableCell className='text-muted-foreground'>{dataset.documentCount}</TableCell>

        <TableCell className='text-muted-foreground'>
          {formatBytes(Number(dataset.totalSize))}
        </TableCell>

        <TableCell className='text-muted-foreground'>{dataset.createdBy.name}</TableCell>

        <TableCell className='text-muted-foreground'>
          {formatRelativeTime(dataset.updatedAt)}
        </TableCell>

        <TableCell>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant='ghost' size='icon-sm'>
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align='end'>
              <DropdownMenuItem onClick={handleBrowse}>
                <Search />
                Browse
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleSettings}>
                <Settings />
                Settings
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={handleArchive}>
                <Archive />
                Archive
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleDelete} variant='destructive'>
                <Trash />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </TableCell>
      </TableRow>

      <ConfirmDialog />
    </>
  )
}

export function DatasetsTableView() {
  const { items, refetch } = useDatasets()

  return (
    <div className='border rounded-lg my-2 mx-3'>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Documents</TableHead>
            <TableHead>Size</TableHead>
            <TableHead>Created by</TableHead>
            <TableHead>Updated</TableHead>
            <TableHead className='w-[50px]' />
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((dataset) => (
            <DatasetTableRow key={dataset.id} dataset={dataset} onActionComplete={refetch} />
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
