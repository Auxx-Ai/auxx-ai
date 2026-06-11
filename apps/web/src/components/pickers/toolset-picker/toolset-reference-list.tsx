// apps/web/src/components/pickers/toolset-picker/toolset-reference-list.tsx

'use client'

import {
  type FlatToolsetCatalogEntry,
  flattenCatalogToToolsets,
  matchesToolsetSearch,
} from '@auxx/lib/agents/client'
import {
  Command,
  CommandGroup,
  CommandItem,
  CommandList,
  CommandPlaceholder,
} from '@auxx/ui/components/command'
import { cn } from '@auxx/ui/lib/utils'
import { useMemo } from 'react'
import { useToolCatalog } from '~/components/agents/hooks/use-tool-catalog'
import { AppIcon } from '~/components/apps/ui/app-icon'

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
 * Backed by `useExtensionsContext().appInstallations` via `useToolCatalog`,
 * which returns the org catalog tree; this component flattens it to one row
 * per toolset for the picker. The "Tools" tab is one of intentionally-coarse
 * granularity: an admin pins a whole toolset to the persona prompt and the
 * agent gets all of its tools. Individual tool pinning (`tool:<name>`) is
 * not exposed in v1 — the catalog has no per-tool selection surface and
 * per-tool gating already lives on the Tools tab via `disabledTools`.
 */
export function ToolsetReferenceList({
  externalSearch = '',
  onSelectSingle,
  className,
}: ToolsetReferenceListProps) {
  const { catalog, isLoading } = useToolCatalog()

  const flat = useMemo<FlatToolsetCatalogEntry[]>(
    () => flattenCatalogToToolsets(catalog),
    [catalog]
  )

  const filtered = useMemo<FlatToolsetCatalogEntry[]>(
    () => flat.filter((entry) => matchesToolsetSearch(entry, externalSearch)),
    [flat, externalSearch]
  )

  const showEmpty = !isLoading && filtered.length === 0 && flat.length > 0
  const showEmptyInitial = !isLoading && flat.length === 0

  // Partition app toolsets from MCP servers into separate group headings.
  const appToolsets = filtered.filter((e) => e.origin !== 'mcp')
  const mcpToolsets = filtered.filter((e) => e.origin === 'mcp')

  const renderItem = (entry: FlatToolsetCatalogEntry) => {
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
            {entry.tools.length} {entry.tools.length === 1 ? 'tool' : 'tools'}
            {entry.path.length > 0 ? ` · ${entry.path.join(' · ')}` : ''}
          </span>
        </div>
      </CommandItem>
    )
  }

  return (
    <Command shouldFilter={false} className={cn('rounded-lg', className)}>
      <CommandList>
        {isLoading && <CommandPlaceholder>Loading…</CommandPlaceholder>}
        {showEmpty && <CommandPlaceholder>No toolsets match</CommandPlaceholder>}
        {showEmptyInitial && <CommandPlaceholder>No toolsets available</CommandPlaceholder>}
        {appToolsets.length > 0 && (
          <CommandGroup heading='Toolsets' aria-label='Toolsets'>
            {appToolsets.map(renderItem)}
          </CommandGroup>
        )}
        {mcpToolsets.length > 0 && (
          <CommandGroup heading='MCP servers' aria-label='MCP servers'>
            {mcpToolsets.map(renderItem)}
          </CommandGroup>
        )}
      </CommandList>
    </Command>
  )
}
