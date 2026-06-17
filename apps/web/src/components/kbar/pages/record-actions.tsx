// apps/web/src/components/kbar/pages/record-actions.tsx
'use client'

import { Command, CommandGroup, CommandItem, CommandList } from '@auxx/ui/components/command'
import { Copy, ExternalLink, Link2, ListChecks, SquareArrowOutUpRight } from 'lucide-react'
import { useRecordActions } from '../contextual/use-record-actions'
import { selectOnEnter } from '../select-on-enter'
import { useCommandPaletteStore } from '../store'

/**
 * Contextual actions for the record carried from the search page (`selectedRecord`).
 * Rendered as a nested page under the `… › Search › Actions` breadcrumb. The
 * handler bodies come from the shared {@link useRecordActions} hook — the same
 * source the mounted-surface flow (`<RecordCommandActions>`) uses, so the two
 * can't drift.
 */
export function RecordActionsPage() {
  const selected = useCommandPaletteStore((s) => s.selectedRecord)

  // Hooks must run unconditionally — fall back to empty strings when no record
  // is carried (the component early-returns null just below).
  const handlers = useRecordActions(selected?.recordId ?? '', selected?.displayName ?? '')

  if (!selected) return null

  return (
    <Command onKeyDown={selectOnEnter} className='flex flex-col'>
      <CommandList className='max-h-[min(360px,55vh)] p-1'>
        <CommandGroup heading={selected.displayName}>
          <CommandItem value='open' onSelect={handlers.open} className='gap-2'>
            <ExternalLink />
            Open record
          </CommandItem>
          {handlers.absoluteHref && (
            <CommandItem value='open-new-tab' onSelect={handlers.openNewTab} className='gap-2'>
              <SquareArrowOutUpRight />
              Open in new tab
            </CommandItem>
          )}
          <CommandItem value='create-task' onSelect={handlers.createTask} className='gap-2'>
            <ListChecks />
            Create task
          </CommandItem>
          <CommandItem value='copy-name' onSelect={handlers.copyName} className='gap-2'>
            <Copy />
            Copy name
          </CommandItem>
          {handlers.absoluteHref && (
            <CommandItem value='copy-link' onSelect={handlers.copyLink} className='gap-2'>
              <Link2 />
              Copy link
            </CommandItem>
          )}
        </CommandGroup>
      </CommandList>
    </Command>
  )
}
