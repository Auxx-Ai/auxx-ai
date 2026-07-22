// apps/web/src/components/dispatch/ui/board/slot-create-assignee-picker.tsx

'use client'

import { Avatar, AvatarFallback, AvatarImage } from '@auxx/ui/components/avatar'
import {
  Command,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@auxx/ui/components/command'
import { Popover, PopoverContent, PopoverTrigger } from '@auxx/ui/components/popover'
import { UserX } from 'lucide-react'
import { useState } from 'react'
import { getInitials } from '~/components/groups/utils/group-utils'
import { PickerTrigger } from '~/components/ui/picker-trigger'
import type { BoardWorker } from './types'
import { workerDisplayName } from './utils'

export interface SlotCreateAssigneePickerProps {
  /** Every active dispatch worker (individuals + teams) — `use-board-data.ts`'s `allWorkers`. */
  workers: BoardWorker[]
  /** `null` = unassigned. A `DispatchWorker.id` — never a `User.id` (teams have none). */
  value: string | null
  onChange: (workerId: string | null) => void
  disabled?: boolean
}

/** Small overlapping avatar stack for a team row — up to 3 member faces, the flat picker's
 * "team hint" (plans/dispatch/45-teams.md §1.H). */
function TeamMemberAvatars({ members }: { members: BoardWorker['members'] }) {
  const shown = (members ?? []).slice(0, 3)
  if (shown.length === 0) return null
  return (
    <div className='flex -space-x-1.5'>
      {shown.map((m) => (
        <Avatar key={m.workerId} className='size-5 border border-background'>
          <AvatarImage src={m.image ?? undefined} />
          <AvatarFallback className='text-[9px]'>{getInitials(m.name ?? 'Worker')}</AvatarFallback>
        </Avatar>
      ))}
    </div>
  )
}

/** One flat assignee row's content — an individual renders its user's avatar/name; a team
 * renders its own name plus a member-avatar hint. */
function WorkerOption({ worker }: { worker: BoardWorker }) {
  const label = workerDisplayName(worker)
  if (worker.type === 'team') {
    return (
      <>
        <Avatar className='size-5'>
          <AvatarFallback className='text-[9px]'>{getInitials(label)}</AvatarFallback>
        </Avatar>
        <span className='min-w-0 flex-1 truncate'>{label}</span>
        <TeamMemberAvatars members={worker.members} />
      </>
    )
  }
  return (
    <>
      <Avatar className='size-5'>
        <AvatarImage src={worker.user?.image ?? undefined} />
        <AvatarFallback className='text-[9px]'>{getInitials(label)}</AvatarFallback>
      </Avatar>
      <span className='min-w-0 flex-1 truncate'>{label}</span>
    </>
  )
}

/**
 * Single-select assignee field for the slot-create popover (plan 37c §7, reworked onto worker
 * rows by plan 45 §1.H) — a flat "Unassigned" + every active dispatch worker (individuals and
 * teams alike) list, built straight from `use-board-data.ts`'s `allWorkers` (threaded down via
 * `slot-create-popover.tsx`) rather than the user-only actor picker this used previously. A
 * plain local `useState`, no commit gate.
 */
export function SlotCreateAssigneePicker({
  workers,
  value,
  onChange,
  disabled,
}: SlotCreateAssigneePickerProps) {
  const [open, setOpen] = useState(false)
  const selectedWorker = value ? workers.find((w) => w.id === value) : undefined
  const label = selectedWorker ? workerDisplayName(selectedWorker) : 'Worker'

  const pick = (workerId: string | null) => {
    onChange(workerId)
    setOpen(false)
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <PickerTrigger
          open={open}
          disabled={disabled}
          hasValue={!!value}
          placeholder='Unassigned'
          showClear={!!value}
          onClear={(e) => {
            e.stopPropagation()
            onChange(null)
          }}>
          {label}
        </PickerTrigger>
      </PopoverTrigger>
      <PopoverContent className='w-72 p-0' align='start'>
        <Command className='rounded-lg'>
          <CommandInput placeholder='Search workers...' disabled={disabled} />
          <CommandList>
            <CommandGroup>
              <CommandItem onSelect={() => pick(null)} className='flex items-center gap-2'>
                <UserX className='size-4 text-muted-foreground' />
                Unassigned
              </CommandItem>
              {workers.map((worker) => (
                <CommandItem
                  key={worker.id}
                  value={workerDisplayName(worker)}
                  disabled={disabled}
                  onSelect={() => pick(worker.id)}
                  className='flex items-center gap-2'>
                  <WorkerOption worker={worker} />
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
