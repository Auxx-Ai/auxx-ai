// apps/web/src/components/pickers/toolset-picker/toolset-reference-list.tsx

'use client'

import { type FlatToolsetCatalogEntry, flattenCatalogToToolsets } from '@auxx/lib/agents/client'
import {
  Command,
  CommandGroup,
  CommandItem,
  CommandList,
  CommandPlaceholder,
} from '@auxx/ui/components/command'
import { cn } from '@auxx/ui/lib/utils'
import { useMemo } from 'react'
import { AppIcon } from '~/components/apps/ui/app-icon'
import { api } from '~/trpc/react'

export interface ToolsetReferenceListProps {
  /** Search query forwarded from the picker chip. */
  externalSearch?: string
  /** Selection callback — receives the chip id (`toolset:<slug>`). */
  onSelectSingle: (id: string) => void
  className?: string
}

/**
 * Flat single-list search component for the ReferencePicker Tools tab.
 *
 * Backed by `api.agentToolset.list` which returns the org catalog tree; this
 * component flattens it to one row per toolset for the picker. The "Tools"
 * tab is one of intentionally-coarse granularity: an admin pins a whole
 * toolset to the persona prompt and the agent gets all of its tools.
 * Individual tool pinning (`tool:<name>`) is not exposed in v1 — the catalog
 * has no per-tool selection surface and per-tool gating already lives on the
 * Tools tab via `disabledTools`.
 */
export function ToolsetReferenceList({
  externalSearch = '',
  onSelectSingle,
  className,
}: ToolsetReferenceListProps) {
  const catalogQuery = api.agentToolset.list.useQuery(undefined, {
    staleTime: 60_000,
  })

  const flat = useMemo<FlatToolsetCatalogEntry[]>(
    () => (catalogQuery.data ? flattenCatalogToToolsets(catalogQuery.data) : []),
    [catalogQuery.data]
  )

  const filtered = useMemo<FlatToolsetCatalogEntry[]>(() => {
    const q = externalSearch.trim().toLowerCase()
    if (!q) return flat
    return flat.filter((entry) => {
      if (entry.slug.toLowerCase().includes(q)) return true
      if (entry.label.toLowerCase().includes(q)) return true
      if (entry.fullLabel.toLowerCase().includes(q)) return true
      return entry.tools.some((t) => t.name.toLowerCase().includes(q))
    })
  }, [flat, externalSearch])

  const isLoading = catalogQuery.isLoading
  const showEmpty = !isLoading && filtered.length === 0 && flat.length > 0
  const showEmptyInitial = !isLoading && flat.length === 0

  return (
    <Command shouldFilter={false} className={cn('rounded-lg', className)}>
      <CommandList>
        {isLoading && <CommandPlaceholder>Loading…</CommandPlaceholder>}
        {showEmpty && <CommandPlaceholder>No toolsets match</CommandPlaceholder>}
        {showEmptyInitial && <CommandPlaceholder>No toolsets available</CommandPlaceholder>}
        {filtered.length > 0 && (
          <CommandGroup aria-label='Toolsets'>
            {filtered.map((entry) => {
              const id = `toolset:${entry.slug}`
              return (
                <CommandItem
                  key={entry.slug}
                  value={id}
                  onSelect={() => onSelectSingle(id)}
                  className='flex items-center gap-2'>
                  <AppIcon iconId={entry.iconId} color={entry.color || undefined} size='sm' />
                  <div className='flex min-w-0 flex-col'>
                    <span className='text-sm truncate'>{entry.fullLabel}</span>
                    <span className='text-[10px] text-muted-foreground'>
                      {entry.tools.length} {entry.tools.length === 1 ? 'tool' : 'tools'} ·{' '}
                      {entry.path.join(' · ')}
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
