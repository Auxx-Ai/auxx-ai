// apps/web/src/components/datasets/dataset-card.tsx

'use client'

import type { DatasetWithRelations } from '@auxx/lib/datasets'
import { Avatar, AvatarFallback } from '@auxx/ui/components/avatar'
import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@auxx/ui/components/dropdown-menu'
import { LastUpdated } from '@auxx/ui/components/last-updated'
import { formatBytes } from '@auxx/utils'
import { Archive, Database, MoreVertical, Search, Settings, Trash } from 'lucide-react'
import { FavoriteToggleMenuItem } from '~/components/favorites/ui/favorite-toggle-menu-item'
import { Tooltip } from '~/components/global/tooltip'
import { useDatasetActions } from './hooks/use-dataset-actions'

interface DatasetCardProps {
  dataset: DatasetWithRelations
  onClick?: () => void
  onActionComplete?: () => void
}

const STATUS_DOT: Record<string, { color: string; label: string }> = {
  ACTIVE: { color: 'bg-good-500', label: 'Active' },
  PROCESSING: { color: 'bg-warning-500', label: 'Processing' },
  ERROR: { color: 'bg-destructive', label: 'Error' },
  ARCHIVED: { color: 'bg-muted-foreground/40', label: 'Archived' },
}

export function DatasetCard({ dataset, onClick, onActionComplete }: DatasetCardProps) {
  const { handleBrowse, handleSettings, handleDelete, handleArchive, ConfirmDialog } =
    useDatasetActions({
      datasetId: dataset.id,
      datasetName: dataset.name,
      onSuccess: onActionComplete,
    })

  const status = STATUS_DOT[dataset.status] ?? STATUS_DOT.ARCHIVED
  const creatorName = dataset.createdBy.name ?? dataset.createdBy.email ?? '?'
  const creatorInitial = creatorName.charAt(0).toUpperCase()

  const stop = (e: React.MouseEvent) => e.stopPropagation()
  const wrap = (fn: () => void | Promise<void>) => (e: React.MouseEvent) => {
    e.stopPropagation()
    void fn()
  }

  return (
    <>
      <ConfirmDialog />
      <div
        className='rounded-2xl bg-background dark:bg-primary-50 hover:bg-primary-50/50 hover:outline-5 dark:hover:outline-primary-50/50 hover:outline-primary-100 flex flex-col p-3 gap-2 border cursor-pointer group/dataset-card relative'
        onClick={onClick}>
        <div className='flex flex-row items-start gap-2 w-full'>
          <div className='relative shrink-0'>
            <div className='size-8 rounded-xl border flex items-center justify-center overflow-hidden'>
              <Database className='size-4' />
            </div>
            <Tooltip content={status.label}>
              <div
                className={`absolute -top-0.5 -right-0.5 size-2.5 rounded-full border-2 border-primary-50 ${status.color}`}
              />
            </Tooltip>
          </div>

          <div className='flex flex-col flex-1 min-w-0'>
            <div className='flex flex-row justify-between items-start gap-1'>
              <p className='text-sm font-semibold line-clamp-2 group-hover/dataset-card:text-info'>
                {dataset.name}
              </p>
            </div>
            <LastUpdated
              timestamp={dataset.updatedAt}
              prefix=''
              includeSeconds={true}
              className='text-xs text-muted-foreground'
            />
          </div>
        </div>

        <div className='flex items-center justify-between mt-auto gap-2'>
          <Badge variant='pill' size='sm' className='shrink-0 mt-0.5'>
            {dataset.documentCount} docs
            <span className='mx-1 text-muted-foreground/60'>|</span>
            {formatBytes(Number(dataset.totalSize))}
          </Badge>
          <div className='flex items-center gap-1'>
            <Tooltip content={`Created by ${creatorName}`}>
              <Avatar className='size-5'>
                <AvatarFallback className='text-[10px] font-medium'>
                  {creatorInitial}
                </AvatarFallback>
              </Avatar>
            </Tooltip>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  className='opacity-0 group-hover/dataset-card:opacity-100 duration-300 data-[state=open]:opacity-100! data-[state=open]:bg-muted! transition-opacity rounded-lg'
                  variant='ghost'
                  size='icon-xs'
                  onClick={stop}>
                  <MoreVertical />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align='end' onClick={stop}>
                <DropdownMenuItem onClick={wrap(handleBrowse)}>
                  <Search />
                  Browse
                </DropdownMenuItem>
                <DropdownMenuItem onClick={wrap(handleSettings)}>
                  <Settings />
                  Settings
                </DropdownMenuItem>
                <FavoriteToggleMenuItem
                  targetType='DATASET'
                  targetIds={{ datasetId: dataset.id }}
                />
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={wrap(handleArchive)}>
                  <Archive />
                  Archive
                </DropdownMenuItem>
                <DropdownMenuItem onClick={wrap(handleDelete)} variant='destructive'>
                  <Trash />
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </div>
    </>
  )
}
