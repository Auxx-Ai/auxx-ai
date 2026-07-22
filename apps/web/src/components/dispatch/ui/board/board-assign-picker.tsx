// apps/web/src/components/dispatch/ui/board/board-assign-picker.tsx

'use client'

import type { PickerComponentProps } from '@auxx/ui/components/action-bar'
import { Avatar, AvatarFallback, AvatarImage } from '@auxx/ui/components/avatar'
import {
  Command,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@auxx/ui/components/command'
import {
  Popover,
  PopoverAnchor,
  PopoverContentDialogAware,
  PopoverTrigger,
} from '@auxx/ui/components/popover'
import { UserX } from 'lucide-react'
import { type RefObject, useState } from 'react'
import { getInitials } from '~/components/groups/utils/group-utils'
import type { BoardWorker } from './types'
import { workerDisplayName } from './utils'

interface BoardAssignPickerProps extends PickerComponentProps {
  /** Every active dispatch worker (individuals + teams) — `use-board-data.ts`'s `allWorkers`. */
  workers: BoardWorker[]
  /** `null` = the "Unassigned" row. Always a `DispatchWorker.id` — never a `User.id`; teams
   * have no backing user at all. */
  onSelect: (workerId: string | null) => void
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
 * The bulk bar's "Assign to…" action popover (plan 37c §5.1, reworked onto worker rows by plan
 * 45 §1.H) — a flat "Unassigned" + every active dispatch worker (individuals and teams alike)
 * list, built straight from `use-board-data.ts`'s `allWorkers` rather than the user-only actor
 * picker this used previously. No series-scope gate: bulk assignee changes are always "this
 * visit" (documented, §5.2).
 */
export function BoardAssignPicker({
  children,
  anchorRef,
  open,
  onOpenChange,
  disabled,
  workers,
  onSelect,
}: BoardAssignPickerProps) {
  const [internalOpen, setInternalOpen] = useState(false)
  const isOpen = open ?? internalOpen

  const setOpen = (next: boolean) => {
    if (open === undefined) setInternalOpen(next)
    onOpenChange?.(next)
  }

  const pick = (workerId: string | null) => {
    onSelect(workerId)
    setOpen(false)
  }

  return (
    <Popover open={isOpen} onOpenChange={setOpen}>
      {anchorRef ? (
        // Radix's `virtualRef` wants `RefObject<Measurable>` (non-nullable); `anchorRef` comes
        // in via `PickerComponentProps` as `RefObject<HTMLElement | null>` — same mismatch
        // pre-existing in every other `ActionBar` picker (`actor-picker.tsx`, `tag-picker.tsx`).
        <PopoverAnchor virtualRef={anchorRef as RefObject<HTMLElement>} />
      ) : (
        <PopoverTrigger asChild>{children}</PopoverTrigger>
      )}
      <PopoverContentDialogAware className='w-72 p-0' align='end'>
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
      </PopoverContentDialogAware>
    </Popover>
  )
}
