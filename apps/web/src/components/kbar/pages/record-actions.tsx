// apps/web/src/components/kbar/pages/record-actions.tsx
'use client'

import type { RecordId } from '@auxx/lib/resources/client'
import { Command, CommandGroup, CommandItem, CommandList } from '@auxx/ui/components/command'
import { Copy, ExternalLink, Link2, ListChecks, SquareArrowOutUpRight } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useResourceStore } from '~/components/resources/store/resource-store'
import { recordHref } from '../record-href'
import { selectOnEnter } from '../select-on-enter'
import { useCommandPaletteStore } from '../store'

/**
 * Contextual actions for the record carried from the search page (`selectedRecord`).
 * Rendered as a nested page under the `… › Search › Actions` breadcrumb. The
 * current set is entity-agnostic (open / open-in-new-tab / copy / create task);
 * entity-specific actions (copy email, send email, create note) follow once the
 * preview surfaces the record's fields.
 */
export function RecordActionsPage() {
  const router = useRouter()
  const selected = useCommandPaletteStore((s) => s.selectedRecord)
  const close = useCommandPaletteStore((s) => s.close)
  const getResourceById = useResourceStore((s) => s.getResourceById)

  if (!selected) return null

  const href = recordHref(selected.recordId as RecordId, getResourceById)
  const absoluteHref =
    href && typeof window !== 'undefined' ? `${window.location.origin}${href}` : href

  const open = () => {
    if (href) {
      router.push(href)
      close()
    }
  }

  const openNewTab = () => {
    if (absoluteHref) window.open(absoluteHref, '_blank', 'noopener,noreferrer')
    close()
  }

  const copy = (text: string) => {
    void navigator.clipboard?.writeText(text)
    close()
  }

  const createTask = () => {
    // Drill into the embedded task page with the record pre-linked (stays in-palette).
    useCommandPaletteStore.getState().openCreateTask(selected.recordId as RecordId)
  }

  return (
    <Command onKeyDown={selectOnEnter} className='flex flex-col'>
      <CommandList className='max-h-[min(360px,55vh)] p-1'>
        <CommandGroup heading={selected.displayName}>
          <CommandItem value='open' onSelect={open} className='gap-2'>
            <ExternalLink />
            Open record
          </CommandItem>
          {absoluteHref && (
            <CommandItem value='open-new-tab' onSelect={openNewTab} className='gap-2'>
              <SquareArrowOutUpRight />
              Open in new tab
            </CommandItem>
          )}
          <CommandItem value='create-task' onSelect={createTask} className='gap-2'>
            <ListChecks />
            Create task
          </CommandItem>
          <CommandItem
            value='copy-name'
            onSelect={() => copy(selected.displayName)}
            className='gap-2'>
            <Copy />
            Copy name
          </CommandItem>
          {absoluteHref && (
            <CommandItem value='copy-link' onSelect={() => copy(absoluteHref)} className='gap-2'>
              <Link2 />
              Copy link
            </CommandItem>
          )}
        </CommandGroup>
      </CommandList>
    </Command>
  )
}
