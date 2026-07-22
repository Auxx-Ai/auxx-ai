// apps/web/src/components/dispatch/ui/board/slot-create-assignee-picker.tsx

'use client'

import { getActorRawId, toActorId } from '@auxx/types/actor'
import { Command, CommandGroup, CommandItem, CommandList } from '@auxx/ui/components/command'
import { Popover, PopoverContent, PopoverTrigger } from '@auxx/ui/components/popover'
import { UserX } from 'lucide-react'
import { useState } from 'react'
import { ActorPickerContent } from '~/components/pickers/actor-picker/actor-picker-content'
import { useActors } from '~/components/resources/hooks/use-actor'
import { PickerTrigger } from '~/components/ui/picker-trigger'
import { useWorkerActorExcludes } from '../shared/use-worker-actor-excludes'

export interface SlotCreateAssigneePickerProps {
  /** `null` = unassigned. */
  value: string | null
  onChange: (userId: string | null) => void
  disabled?: boolean
}

/**
 * Single-select, worker-filtered assignee field for the slot-create popover (plan 37c §7) — the
 * same `ActorPickerContent` + `useWorkerActorExcludes` recipe `AssigneeRow`
 * (`../shared/assignee-row.tsx`) and the bulk bar's `BoardAssignPicker` already use, minus both
 * components' own coupling (`AssigneeRow` requires a `SeriesScopeProvider` ancestor for its
 * commit gate; `BoardAssignPicker` is shaped for `ActionBar`'s `anchorRef` picker contract) that
 * this plain create-form field — a local `useState`, no commit gate — doesn't need.
 */
export function SlotCreateAssigneePicker({
  value,
  onChange,
  disabled,
}: SlotCreateAssigneePickerProps) {
  const [open, setOpen] = useState(false)
  const excludeIds = useWorkerActorExcludes()
  const assigneeActorId = value ? toActorId('user', value) : null
  const hydrated = useActors(assigneeActorId ? [assigneeActorId] : [])
  const assigneeActor = assigneeActorId ? hydrated.get(assigneeActorId) : undefined
  const label = assigneeActor?.name ?? 'Worker'

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
        <Command shouldFilter={false} className='rounded-lg rounded-b-none'>
          <CommandList>
            <CommandGroup>
              <CommandItem
                onSelect={() => {
                  onChange(null)
                  setOpen(false)
                }}
                className='flex items-center gap-2'>
                <UserX className='size-4 text-muted-foreground' />
                Unassigned
              </CommandItem>
            </CommandGroup>
          </CommandList>
        </Command>
        {/* Plain divider, not `CommandSeparator` — same reason as `board-assign-picker.tsx`: two
         * independent `Command` roots stacked (the static "Unassigned" row, then the searchable
         * `ActorPickerContent` worker list). */}
        <div className='h-px bg-border/50 dark:bg-[#323842]/80' />
        <ActorPickerContent
          value={[]}
          onChange={() => {}}
          target='user'
          multi={false}
          disabled={disabled}
          excludeIds={excludeIds}
          onSelectSingle={(actorId) => {
            onChange(getActorRawId(actorId))
            setOpen(false)
          }}
          placeholder='Search workers...'
        />
      </PopoverContent>
    </Popover>
  )
}
