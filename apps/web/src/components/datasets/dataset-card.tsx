// apps/web/src/components/datasets/dataset-card.tsx

'use client'

import type { DatasetWithRelations } from '@auxx/lib/datasets'
import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import { Card, CardContent, CardHeader, CardTitle } from '@auxx/ui/components/card'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@auxx/ui/components/dropdown-menu'
import { formatBytes, formatRelativeTime } from '@auxx/utils'
import {
  Archive,
  Calendar,
  Database,
  FileText,
  MoreVertical,
  Search,
  Settings,
  Trash,
} from 'lucide-react'
import { useDatasetActions } from './hooks/use-dataset-actions'

interface DatasetCardProps {
  dataset: DatasetWithRelations
  onClick?: () => void
  onActionComplete?: () => void
}

/**
 * Card component for displaying dataset information in grid view
 */
export function DatasetCard({ dataset, onClick, onActionComplete }: DatasetCardProps) {
  const { handleBrowse, handleSettings, handleDelete, handleArchive, ConfirmDialog } =
    useDatasetActions({
      datasetId: dataset.id,
      datasetName: dataset.name,
      onSuccess: onActionComplete,
    })

  /**
   * Get badge color based on dataset status
   */
  const getStatusColor = (status: string) => {
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
      <Card className='group cursor-pointer transition-shadow hover:shadow-md' onClick={onClick}>
        <CardHeader>
          <div className='flex items-start justify-between'>
            <div className='relative'>
              <div className={`p-2 rounded-lg bg-good-50 text-good-500`}>
                <Database className='size-4' />
              </div>
              <div className='absolute -top-1 -right-1'>
                <div className='flex items-center gap-2'>
                  <div className={`size-2.5 rounded-full bg-good-500 flex-shrink-0`} />
                </div>
              </div>
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant='ghost'
                  size='icon-sm'
                  className='opacity-0 group-hover:opacity-100'
                  onClick={(e) => e.stopPropagation()}>
                  <MoreVertical />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align='end' onClick={(e) => e.stopPropagation()}>
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
          </div>

          <CardTitle className='text-sm truncate'>
            <div className='flex justify-between items-center'>
              <span className=''>{dataset.name}</span>
              <Badge className={getStatusColor(dataset.status)} size='xs'>
                {dataset.status.toLowerCase()}
              </Badge>
            </div>
          </CardTitle>
        </CardHeader>

        <CardContent onClick={onClick}>
          {/* Status */}
          <div className='flex items-center gap-2 mb-3'></div>

          {/* Stats */}
          <div className='grid grid-cols-2 gap-4 text-sm'>
            <div className='flex items-center gap-2'>
              <FileText className='h-4 w-4 text-muted-foreground' />
              <span className='text-muted-foreground'>{dataset.documentCount} docs</span>
            </div>
            <div className='flex items-center gap-2'>
              <Calendar className='h-4 w-4 text-muted-foreground' />
              <span className='text-muted-foreground'>{formatRelativeTime(dataset.updatedAt)}</span>
            </div>
          </div>

          {/* Size and Created By */}
          <div className='mt-3 pt-3 border-t text-xs text-muted-foreground'>
            <div className='flex justify-between items-center'>
              <span>Size: {formatBytes(Number(dataset.totalSize))}</span>
              <span>by {dataset.createdBy.name}</span>
            </div>
          </div>
        </CardContent>
      </Card>

      <ConfirmDialog />
    </>
  )
}
