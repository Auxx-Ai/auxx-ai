// apps/web/src/components/dispatch/ui/board/board-assign-context-submenu.tsx

'use client'

import { getActorRawId } from '@auxx/types/actor'
import { Command, CommandGroup, CommandItem, CommandList } from '@auxx/ui/components/command'
import {
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
} from '@auxx/ui/components/context-menu'
import { UserCog, UserX } from 'lucide-react'
import { ActorPickerContent } from '~/components/pickers/actor-picker/actor-picker-content'
import { useWorkerActorExcludes } from '../shared/use-worker-actor-excludes'

interface BoardAssignContextSubmenuProps {
  /** `null` = the "Unassigned" row. */
  onSelect: (userId: string | null) => void
}

/**
 * The chip context menu's "Assign to…" submenu (plan 44 §6) — the same worker-filtered
 * `ActorPickerContent` + "Unassigned" row the bulk bar's `BoardAssignPicker` uses, hosted inside a
 * `ContextMenuSub` instead of a popover. Radix context menus aren't controllable via an `open`
 * prop, and a `CommandItem` selection isn't a menu-item selection, so the menu wouldn't auto-close
 * on pick — a synthetic Escape dismisses the whole menu after the assign fires.
 */
export function BoardAssignContextSubmenu({ onSelect }: BoardAssignContextSubmenuProps) {
  const excludeIds = useWorkerActorExcludes()

  const pick = (userId: string | null) => {
    onSelect(userId)
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
  }

  return (
    <ContextMenuSub>
      <ContextMenuSubTrigger>
        <UserCog /> Assign to…
      </ContextMenuSubTrigger>
      <ContextMenuSubContent className='w-64 p-0'>
        <Command shouldFilter={false} className='rounded-lg rounded-b-none'>
          <CommandList>
            <CommandGroup>
              <CommandItem onSelect={() => pick(null)} className='flex items-center gap-2'>
                <UserX className='size-4 text-muted-foreground' />
                Unassigned
              </CommandItem>
            </CommandGroup>
          </CommandList>
        </Command>
        {/* Plain divider, not `CommandSeparator` (that primitive needs the SAME `Command` root) —
         * this stacks the static "Unassigned" row over the searchable worker list. */}
        <div className='h-px bg-border/50 dark:bg-[#323842]/80' />
        <ActorPickerContent
          value={[]}
          onChange={() => {}}
          target='user'
          multi={false}
          excludeIds={excludeIds}
          onSelectSingle={(actorId) => pick(getActorRawId(actorId))}
          placeholder='Search workers...'
        />
      </ContextMenuSubContent>
    </ContextMenuSub>
  )
}
