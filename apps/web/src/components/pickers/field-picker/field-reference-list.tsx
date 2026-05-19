// apps/web/src/components/pickers/field-picker/field-reference-list.tsx

'use client'

import { Command, CommandGroup, CommandList, CommandPlaceholder } from '@auxx/ui/components/command'
import { cn } from '@auxx/ui/lib/utils'
import { useEffect, useMemo, useState } from 'react'
import { useResourceFields, useResources } from '~/components/resources'
import { FieldItem } from './field-item'

export interface FieldReferenceListProps {
  /** Search query forwarded from the picker chip. */
  externalSearch?: string
  /**
   * Selection callback — receives the chip id (`field:<resourceFieldId>`).
   * v1 doesn't surface relationship drill-down here — picks always resolve
   * to a `ResourceFieldId` on the active entity (no `FieldPath` keys).
   */
  onSelectSingle: (id: string) => void
  /**
   * Default entity to show fields for. If omitted, the first available
   * resource (system first) is used.
   */
  defaultEntityDefinitionId?: string
  className?: string
}

/**
 * Flat fields list for the ReferencePicker Fields tab.
 *
 * Renders an entity-definition switcher at the top + a flat list of fields
 * for the active entity, filtered by the chip's external search. Encodes
 * selections as `field:<ResourceFieldId>` chip ids — relationship traversal
 * (path keys) is deferred to a follow-up; v1 stops at root-level fields.
 */
export function FieldReferenceList({
  externalSearch = '',
  onSelectSingle,
  defaultEntityDefinitionId,
  className,
}: FieldReferenceListProps) {
  const { resources, isLoading: resourcesLoading } = useResources()

  const orderedResources = useMemo(() => {
    const system = resources.filter((r) => !!r.entityType)
    const custom = resources.filter((r) => !r.entityType)
    return [...system, ...custom]
  }, [resources])

  const [activeEntityId, setActiveEntityId] = useState<string | undefined>(
    defaultEntityDefinitionId
  )

  // Pick a default once resources arrive asynchronously.
  useEffect(() => {
    if (!activeEntityId && orderedResources[0]) {
      setActiveEntityId(orderedResources[0].id)
    }
  }, [orderedResources, activeEntityId])

  const { fields, isLoading: fieldsLoading } = useResourceFields(activeEntityId)

  const filtered = useMemo(() => {
    const q = externalSearch.trim().toLowerCase()
    return fields.filter((f) => {
      if (f.active === false) return false
      if (!q) return true
      return f.label.toLowerCase().includes(q)
    })
  }, [fields, externalSearch])

  const isLoading = resourcesLoading || fieldsLoading
  const showEmpty = !isLoading && filtered.length === 0

  return (
    <div className={cn('flex flex-col', className)}>
      <div className='flex gap-1 overflow-x-auto no-scrollbar border-b px-2 py-1.5 shrink-0'>
        {orderedResources.map((r) => (
          <button
            key={r.id}
            type='button'
            onMouseDown={(e) => {
              e.preventDefault()
              setActiveEntityId(r.id)
            }}
            className={cn(
              'shrink-0 rounded-sm px-2 py-0.5 text-xs font-medium transition-colors',
              activeEntityId === r.id
                ? 'bg-muted text-foreground'
                : 'text-muted-foreground hover:text-foreground'
            )}>
            {r.label}
          </button>
        ))}
      </div>
      <Command shouldFilter={false} className='rounded-none'>
        <CommandList>
          {isLoading && <CommandPlaceholder>Loading…</CommandPlaceholder>}
          {showEmpty && <CommandPlaceholder>No fields match</CommandPlaceholder>}
          {filtered.length > 0 && (
            <CommandGroup aria-label='Fields'>
              {filtered.map((field) => (
                <FieldItem
                  key={field.id}
                  field={field}
                  isSelected={false}
                  canDrillDown={false}
                  onSelect={() => {
                    if (!field.resourceFieldId) return
                    onSelectSingle(`field:${field.resourceFieldId}`)
                  }}
                />
              ))}
            </CommandGroup>
          )}
        </CommandList>
      </Command>
    </div>
  )
}
