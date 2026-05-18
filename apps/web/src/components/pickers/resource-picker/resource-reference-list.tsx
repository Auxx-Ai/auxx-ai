// apps/web/src/components/pickers/resource-picker/resource-reference-list.tsx

'use client'

import { Command, CommandGroup, CommandList, CommandPlaceholder } from '@auxx/ui/components/command'
import { cn } from '@auxx/ui/lib/utils'
import { useMemo } from 'react'
import { useResources } from '~/components/resources/hooks/use-resources'
import { ResourceItem } from './resource-item'

export interface ResourceReferenceListProps {
  /** Search query forwarded from the picker chip. */
  externalSearch?: string
  /** Selection callback — receives the chip id (`resource:<entityDefinitionId>`). */
  onSelectSingle: (id: string) => void
  className?: string
}

/**
 * Flat single-list search component for the ReferencePicker Resources tab.
 * Backed by the resource store (`useResources`). Selections produce a
 * `resource:<entityDefinitionId>` chip id which the renderer maps to
 * `ResourceBadge`.
 */
export function ResourceReferenceList({
  externalSearch = '',
  onSelectSingle,
  className,
}: ResourceReferenceListProps) {
  const { resources, isLoading } = useResources()

  const filtered = useMemo(() => {
    const q = externalSearch.trim().toLowerCase()
    const items = q ? resources.filter((r) => r.label.toLowerCase().includes(q)) : resources
    const system = items.filter((r) => !!r.entityType)
    const custom = items.filter((r) => !r.entityType)
    return [...system, ...custom]
  }, [resources, externalSearch])

  const showEmpty = !isLoading && filtered.length === 0

  return (
    <Command shouldFilter={false} className={cn('rounded-lg', className)}>
      <CommandList>
        {isLoading && <CommandPlaceholder>Loading…</CommandPlaceholder>}
        {showEmpty && <CommandPlaceholder>No resources match</CommandPlaceholder>}
        {filtered.length > 0 && (
          <CommandGroup aria-label='Resources'>
            {filtered.map((resource) => (
              <ResourceItem
                key={resource.id}
                resource={resource}
                isSelected={false}
                onToggle={(id) => onSelectSingle(`resource:${id}`)}
                multi={false}
              />
            ))}
          </CommandGroup>
        )}
      </CommandList>
    </Command>
  )
}
