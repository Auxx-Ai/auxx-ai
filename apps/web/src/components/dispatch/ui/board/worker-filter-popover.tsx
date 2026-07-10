// apps/web/src/components/dispatch/ui/board/worker-filter-popover.tsx

'use client'

import { Avatar, AvatarFallback, AvatarImage } from '@auxx/ui/components/avatar'
import { Button } from '@auxx/ui/components/button'
import { Checkbox } from '@auxx/ui/components/checkbox'
import { Command, CommandGroup, CommandItem, CommandList } from '@auxx/ui/components/command'
import { Popover, PopoverContent, PopoverTrigger } from '@auxx/ui/components/popover'
import { Users } from 'lucide-react'
import { getInitials } from '~/components/groups/utils/group-utils'
import type { BoardWorker } from './types'

interface WorkerFilterPopoverProps {
  workers: BoardWorker[]
  /** `null` = every worker is visible (the default, no filter applied). */
  selectedWorkerIds: Set<string> | null
  onChange: (ids: Set<string> | null) => void
}

/** Day-view worker column filter — a multi-select over the org's active dispatch workers. */
export function WorkerFilterPopover({
  workers,
  selectedWorkerIds,
  onChange,
}: WorkerFilterPopoverProps) {
  const isSelected = (userId: string) => selectedWorkerIds === null || selectedWorkerIds.has(userId)

  const toggle = (userId: string) => {
    const current = selectedWorkerIds ?? new Set(workers.map((w) => w.userId))
    const next = new Set(current)
    if (next.has(userId)) next.delete(userId)
    else next.add(userId)
    onChange(next.size === workers.length ? null : next)
  }

  const label =
    selectedWorkerIds === null
      ? 'All workers'
      : `${selectedWorkerIds.size} worker${selectedWorkerIds.size === 1 ? '' : 's'}`

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant='outline' size='sm'>
          <Users /> {label}
        </Button>
      </PopoverTrigger>
      <PopoverContent align='start' className='w-56 p-0'>
        <Command>
          <CommandList>
            <CommandGroup>
              {workers.map((worker) => (
                <CommandItem key={worker.id} onSelect={() => toggle(worker.userId)}>
                  <Checkbox
                    checked={isSelected(worker.userId)}
                    className='pointer-events-none mr-1'
                  />
                  <Avatar className='size-5'>
                    <AvatarImage src={worker.user?.image ?? undefined} />
                    <AvatarFallback className='text-[9px]'>
                      {getInitials(worker.user?.name ?? worker.user?.email ?? 'Worker')}
                    </AvatarFallback>
                  </Avatar>
                  <span className='truncate'>{worker.user?.name ?? worker.user?.email}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
