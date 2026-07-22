// apps/web/src/components/dispatch/ui/board/board-assign-picker.tsx

'use client'

import { getActorRawId } from '@auxx/types/actor'
import type { PickerComponentProps } from '@auxx/ui/components/action-bar'
import { Command, CommandGroup, CommandItem, CommandList } from '@auxx/ui/components/command'
import {
  Popover,
  PopoverAnchor,
  PopoverContentDialogAware,
  PopoverTrigger,
} from '@auxx/ui/components/popover'
import { UserX } from 'lucide-react'
import { type RefObject, useState } from 'react'
import { ActorPickerContent } from '~/components/pickers/actor-picker/actor-picker-content'
import { useWorkerActorExcludes } from '../shared/use-worker-actor-excludes'

interface BoardAssignPickerProps extends PickerComponentProps {
  /** `null` = the "Unassigned" row. */
  onSelect: (userId: string | null) => void
}

/**
 * The bulk bar's "Assign to…" action popover (plan 37c §5.1). Reuses the same worker-filtered
 * `ActorPickerContent` the single-visit assignee row uses (`AssigneeRow` in
 * `../shared/assignee-row.tsx`, via `useWorkerActorExcludes`) — just single-select, with an
 * "Unassigned" row prepended (not part of `ActorPickerContent`'s vocabulary) and no
 * series-scope gate: bulk assignee changes are always "this visit" (documented, §5.2).
 */
export function BoardAssignPicker({
  children,
  anchorRef,
  open,
  onOpenChange,
  disabled,
  onSelect,
}: BoardAssignPickerProps) {
  const [internalOpen, setInternalOpen] = useState(false)
  const isOpen = open ?? internalOpen
  const excludeIds = useWorkerActorExcludes()

  const setOpen = (next: boolean) => {
    if (open === undefined) setInternalOpen(next)
    onOpenChange?.(next)
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
        <Command shouldFilter={false} className='rounded-lg rounded-b-none'>
          <CommandList>
            <CommandGroup>
              <CommandItem
                onSelect={() => {
                  onSelect(null)
                  setOpen(false)
                }}
                className='flex items-center gap-2'>
                <UserX className='size-4 text-muted-foreground' />
                Unassigned
              </CommandItem>
            </CommandGroup>
          </CommandList>
        </Command>
        {/* Plain divider, not `CommandSeparator` — that primitive requires living inside the
         * SAME `Command` root (cmdk context), and this popover deliberately stacks two
         * independent `Command` trees (the static "Unassigned" row, then the searchable
         * `ActorPickerContent` worker list below it). */}
        <div className='h-px bg-border/50 dark:bg-[#323842]/80' />
        <ActorPickerContent
          value={[]}
          onChange={() => {}}
          target='user'
          multi={false}
          disabled={disabled}
          excludeIds={excludeIds}
          onSelectSingle={(actorId) => {
            onSelect(getActorRawId(actorId))
            setOpen(false)
          }}
          placeholder='Search workers...'
        />
      </PopoverContentDialogAware>
    </Popover>
  )
}
