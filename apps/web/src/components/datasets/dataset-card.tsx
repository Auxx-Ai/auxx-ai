// apps/web/src/components/datasets/dataset-card.tsx

'use client'

import type { DatasetWithRelations } from '@auxx/lib/datasets'
import { Avatar, AvatarFallback } from '@auxx/ui/components/avatar'
import { Badge } from '@auxx/ui/components/badge'
import { DropdownMenuItem, DropdownMenuSeparator } from '@auxx/ui/components/dropdown-menu'
import { LastUpdated } from '@auxx/ui/components/last-updated'
import { ListCard, type ListCardStatusTone } from '@auxx/ui/components/list-card'
import { Tooltip } from '@auxx/ui/components/tooltip'
import { formatBytes } from '@auxx/utils'
import { Archive, Database, Search, Settings, Trash } from 'lucide-react'
import { FavoriteToggleMenuItem } from '~/components/favorites/ui/favorite-toggle-menu-item'
import {
  useBulkMode,
  useIsPending,
  useIsSelected,
  useListSelection,
  usePendingLabel,
} from '~/components/list-selection'
import { useDatasetActions } from './hooks/use-dataset-actions'

interface DatasetCardProps {
  dataset: DatasetWithRelations
  onClick?: () => void
  onActionComplete?: () => void
}

const STATUS_DOT: Record<string, { tone: ListCardStatusTone; label: string }> = {
  ACTIVE: { tone: 'good', label: 'Active' },
  PROCESSING: { tone: 'warning', label: 'Processing' },
  ERROR: { tone: 'error', label: 'Error' },
  ARCHIVED: { tone: 'muted', label: 'Archived' },
}

export function DatasetCard({ dataset, onClick, onActionComplete }: DatasetCardProps) {
  const { handleBrowse, handleSettings, handleDelete, handleArchive, ConfirmDialog } =
    useDatasetActions({
      datasetId: dataset.id,
      datasetName: dataset.name,
      onSuccess: onActionComplete,
    })

  const bulkMode = useBulkMode()
  const selected = useIsSelected(dataset.id)
  const pending = useIsPending(dataset.id)
  const pendingLabel = usePendingLabel()
  const toggle = useListSelection((s) => s.toggle)

  const status = STATUS_DOT[dataset.status] ?? STATUS_DOT.ARCHIVED
  const creatorName = dataset.createdBy.name ?? dataset.createdBy.email ?? '?'
  const creatorInitial = creatorName.charAt(0).toUpperCase()

  const wrap = (fn: () => void | Promise<void>) => (e: React.MouseEvent) => {
    e.stopPropagation()
    void fn()
  }

  return (
    <>
      <ConfirmDialog />
      <ListCard
        onClick={onClick}
        ariaLabel={dataset.name}
        selectable
        selecting={bulkMode}
        selected={selected}
        onSelectChange={(_, e) => toggle(dataset.id, { shiftKey: e.shiftKey })}
        pending={pending}
        pendingLabel={pendingLabel}
        title={dataset.name}
        icon={<Database className='size-4' />}
        status={status}
        subtitle={<LastUpdated timestamp={dataset.updatedAt} prefix='' includeSeconds={true} />}
        descriptionLines={0}
        badges={
          <Badge variant='pill' size='sm' className='shrink-0'>
            {dataset.documentCount} docs
            <span className='mx-1 text-muted-foreground/60'>|</span>
            {formatBytes(Number(dataset.totalSize))}
          </Badge>
        }
        trailing={
          <Tooltip content={`Created by ${creatorName}`}>
            <Avatar className='size-5'>
              <AvatarFallback className='text-[10px] font-medium'>{creatorInitial}</AvatarFallback>
            </Avatar>
          </Tooltip>
        }
        menu={
          <>
            <DropdownMenuItem onClick={wrap(handleBrowse)}>
              <Search />
              Browse
            </DropdownMenuItem>
            <DropdownMenuItem onClick={wrap(handleSettings)}>
              <Settings />
              Settings
            </DropdownMenuItem>
            <FavoriteToggleMenuItem targetType='DATASET' targetIds={{ datasetId: dataset.id }} />
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={wrap(handleArchive)}>
              <Archive />
              Archive
            </DropdownMenuItem>
            <DropdownMenuItem onClick={wrap(handleDelete)} variant='destructive'>
              <Trash />
              Delete
            </DropdownMenuItem>
          </>
        }
      />
    </>
  )
}
