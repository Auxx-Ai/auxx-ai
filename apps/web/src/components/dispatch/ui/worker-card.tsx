// apps/web/src/components/dispatch/ui/worker-card.tsx
'use client'

import {
  getColorSwatch,
  getOptionColor,
  type SelectOptionColor,
} from '@auxx/lib/custom-fields/client'
import { Avatar, AvatarFallback, AvatarImage } from '@auxx/ui/components/avatar'
import { Badge } from '@auxx/ui/components/badge'
import { ListCard, type ListCardStatus } from '@auxx/ui/components/list-card'
import { cn } from '@auxx/ui/lib/utils'
import type { RouterOutputs } from '~/trpc/react'

export type DispatchWorkerRow = RouterOutputs['dispatch']['listWorkers'][number]

/** Corner status dot from the worker's active flag. */
function workerStatus(worker: DispatchWorkerRow): ListCardStatus {
  return worker.isActive
    ? { tone: 'good', label: 'Active — shown on the board' }
    : { tone: 'muted', label: 'Inactive — hidden from the board' }
}

interface WorkerCardProps {
  worker: DispatchWorkerRow
  /** Omit to render a read-only tile (e.g. the dispatch setup wizard's already-added list). */
  onClick?: (worker: DispatchWorkerRow) => void
}

/**
 * One dispatch worker tile: avatar, name/email, active status dot, board-color
 * chip. Click opens the Workers dialog (07-m2-build.md §E.1).
 */
export function WorkerCard({ worker, onClick }: WorkerCardProps) {
  const name = worker.user?.name || worker.user?.email || 'Unknown member'
  const initial = name.charAt(0).toUpperCase()

  return (
    <ListCard
      media={
        <Avatar className='size-8 rounded-xl'>
          <AvatarImage src={worker.user?.image ?? undefined} />
          <AvatarFallback className='rounded-xl text-xs'>{initial}</AvatarFallback>
        </Avatar>
      }
      title={name}
      subtitle={worker.user?.email ?? undefined}
      status={workerStatus(worker)}
      badges={
        worker.color ? (
          <Badge variant='gray' size='sm' className='gap-1.5'>
            <span className={cn('size-2 rounded-full', getColorSwatch(worker.color))} />
            {getOptionColor(worker.color as SelectOptionColor).label}
          </Badge>
        ) : undefined
      }
      onClick={onClick ? () => onClick(worker) : undefined}
    />
  )
}
