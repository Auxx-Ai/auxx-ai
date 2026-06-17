// apps/web/src/components/editor/slash-commands/slash-list.tsx
'use client'

import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandList,
} from '@auxx/ui/components/command'
import { EntityIcon } from '@auxx/ui/components/icons'
import { ChevronRight } from 'lucide-react'
import { useMemo } from 'react'
import type { CmdkRemoteHandle } from '~/components/pickers/use-cmdk-remote'
import type { SlashCommandItem, SlashCommandSection } from './slash-command-picker'

/**
 * Imperative handle every chip-driven slash content component exposes. The
 * `/` chip's keyboard plugin forwards Enter / Arrow↑↓ / Backspace-empty here
 * (focus stays in the editor — see `useCmdkRemote`).
 */
export interface SlashContentHandle extends CmdkRemoteHandle {
  /**
   * Backspace on an empty chip query — pop a drill level (snippets folder,
   * placeholder mode, step drill). Return true if handled; false closes the
   * chip.
   */
  popLevel: () => boolean
}

export interface SlashListProps {
  /** Live filter — the `/` chip's text content. */
  query: string
  sections: SlashCommandSection<SlashCommandItem>[]
  /** Slot above the list — breadcrumb etc. */
  header?: React.ReactNode
  emptyMessage?: string
  /** Suppress the "No results" render — composer is still loading. */
  loading?: boolean
}

function matches(item: SlashCommandItem, q: string): boolean {
  if (!q) return true
  if (item.title.toLowerCase().includes(q)) return true
  if (item.description?.toLowerCase().includes(q)) return true
  if (item.keywords?.some((kw) => kw.toLowerCase().includes(q))) return true
  return false
}

/**
 * Chip-driven slash-menu shell. The `/` picker chip owns the query (typed
 * inline in the editor) and the keyboard; this list is purely presentational
 * — no `CommandInput`, no focus, no key handling. Highlight + confirm are
 * driven externally via `useCmdkRemote` from the content component that
 * mounts this list.
 *
 * Same section contract as `SlashCommandPicker` (the legacy focused shell
 * still used by the mail composer) so section-building code ports 1:1.
 */
export function SlashList({
  query,
  sections,
  header,
  emptyMessage = 'No results found.',
  loading = false,
}: SlashListProps) {
  const q = query.toLowerCase()

  const filteredSections = useMemo(
    () =>
      sections.map((section) => ({
        section,
        items: section.items.filter((item) => matches(item, q)),
      })),
    [sections, q]
  )

  const allEmpty = filteredSections.every(({ items }) => items.length === 0)

  return (
    <Command className='w-full overflow-hidden' shouldFilter={false}>
      {header}
      <CommandList>
        {loading && <CommandEmpty>Loading...</CommandEmpty>}
        {!loading && allEmpty && <CommandEmpty>{emptyMessage}</CommandEmpty>}
        {!loading &&
          filteredSections.map(({ section, items }) => {
            if (items.length === 0) return null
            return (
              <CommandGroup key={section.id} heading={section.heading}>
                {items.map((item) => {
                  const value = section.itemValue?.(item) ?? item.title
                  return (
                    <CommandItem
                      key={item.id}
                      value={value}
                      onSelect={() => section.onSelect(item)}
                      data-drilldown={item.drillDown ? '' : undefined}
                      className='flex items-center justify-between'>
                      {section.renderItem ? (
                        section.renderItem(item)
                      ) : (
                        <div className='flex items-center gap-2'>
                          {item.iconId && (
                            <EntityIcon
                              iconId={item.iconId}
                              size='sm'
                              variant='full'
                              className='text-muted-foreground'
                            />
                          )}
                          <span>{item.title}</span>
                        </div>
                      )}
                      {item.drillDown && <ChevronRight className='size-4 opacity-50' />}
                    </CommandItem>
                  )
                })}
              </CommandGroup>
            )
          })}
      </CommandList>
    </Command>
  )
}
