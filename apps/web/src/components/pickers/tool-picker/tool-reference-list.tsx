// apps/web/src/components/pickers/tool-picker/tool-reference-list.tsx

'use client'

import type { FlatToolCatalogEntry } from '@auxx/lib/agents'
import {
  Command,
  CommandGroup,
  CommandItem,
  CommandList,
  CommandPlaceholder,
} from '@auxx/ui/components/command'
import { EntityIcon } from '@auxx/ui/components/icons'
import { cn } from '@auxx/ui/lib/utils'
import { useMemo } from 'react'
import { api } from '~/trpc/react'

export interface ToolReferenceListProps {
  /** Search query forwarded from the picker chip. */
  externalSearch?: string
  /** Selection callback — receives the chip id (`tool:<name>`). */
  onSelectSingle: (id: string) => void
  className?: string
}

/**
 * Flat single-list search component for the ReferencePicker Tools tab.
 *
 * Backed by `api.agentToolset.listTools` (org-wide flat tool catalog). Each
 * pick produces a `tool:<name>` chip whose LLM-time resolution inlines the
 * concrete tool name so the model can call it.
 */
export function ToolReferenceList({
  externalSearch = '',
  onSelectSingle,
  className,
}: ToolReferenceListProps) {
  const catalogQuery = api.agentToolset.listTools.useQuery(undefined, {
    staleTime: 60_000,
  })

  const filtered = useMemo<FlatToolCatalogEntry[]>(() => {
    const items = catalogQuery.data ?? []
    const q = externalSearch.trim().toLowerCase()
    if (!q) return items
    return items.filter((entry) => {
      if (entry.displayName.toLowerCase().includes(q)) return true
      if (entry.name.toLowerCase().includes(q)) return true
      if (entry.toolsetLabel.toLowerCase().includes(q)) return true
      if (entry.description.toLowerCase().includes(q)) return true
      return false
    })
  }, [catalogQuery.data, externalSearch])

  const isLoading = catalogQuery.isLoading
  const showEmpty = !isLoading && filtered.length === 0 && (catalogQuery.data?.length ?? 0) > 0
  const showEmptyInitial = !isLoading && (catalogQuery.data?.length ?? 0) === 0

  return (
    <Command shouldFilter={false} className={cn('rounded-lg', className)}>
      <CommandList>
        {isLoading && <CommandPlaceholder>Loading…</CommandPlaceholder>}
        {showEmpty && <CommandPlaceholder>No tools match</CommandPlaceholder>}
        {showEmptyInitial && <CommandPlaceholder>No tools available</CommandPlaceholder>}
        {filtered.length > 0 && (
          <CommandGroup aria-label='Tools'>
            {filtered.map((entry) => {
              const id = `tool:${entry.name}`
              return (
                <CommandItem
                  key={entry.name}
                  value={id}
                  onSelect={() => onSelectSingle(id)}
                  className='flex items-center gap-2'>
                  <EntityIcon
                    iconId={entry.toolsetIconId ?? 'wrench'}
                    color={entry.toolsetColor}
                    size='sm'
                  />
                  <div className='flex min-w-0 flex-col'>
                    <span className='text-sm truncate'>{entry.displayName}</span>
                    <span className='text-[10px] text-muted-foreground'>
                      {entry.toolsetLabel} · {entry.name}
                    </span>
                  </div>
                </CommandItem>
              )
            })}
          </CommandGroup>
        )}
      </CommandList>
    </Command>
  )
}
