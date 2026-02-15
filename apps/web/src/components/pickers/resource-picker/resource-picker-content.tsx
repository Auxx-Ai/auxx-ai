// apps/web/src/components/pickers/resource-picker/resource-picker-content.tsx

'use client'

import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandList,
  CommandSeparator,
} from '@auxx/ui/components/command'
import { cn } from '@auxx/ui/lib/utils'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useResources } from '~/components/resources/hooks/use-resources'
import { ResourceItem } from './resource-item'
import type { ResourcePickerContentProps } from './types'

/** Stable empty array to prevent re-renders */
const EMPTY_EXCLUDE_IDS: string[] = []

/**
 * ResourcePickerContent - Inner content for the resource picker.
 * Renders a searchable list of resources grouped by System and Custom.
 *
 * Features:
 * - Search filtering by resource label
 * - System/Custom grouping with headers
 * - Multi-select or single-select mode
 * - Shows selected items at top, available items below
 */
export function ResourcePickerContent({
  value,
  onChange,
  multi = false,
  onSelectSingle,
  onCaptureChange,
  disabled = false,
  placeholder = 'Search resources...',
  isLoading: externalLoading = false,
  className,
  excludeIds = EMPTY_EXCLUDE_IDS,
  includeSystem = true,
  includeCustom = true,
}: ResourcePickerContentProps) {
  const [search, setSearch] = useState('')

  // Notify parent about capture state on mount/unmount
  useEffect(() => {
    onCaptureChange?.(true)
    return () => onCaptureChange?.(false)
  }, [onCaptureChange])

  // Track initial selected IDs (snapshot at mount) - prevents layout shifts
  const [initialSelectedIds] = useState<string[]>(() => value)

  // Get resources from the store
  const { resources, isLoading: isLoadingResources } = useResources()

  /** Check if a resource ID is currently selected */
  const isSelected = useCallback((id: string) => value.includes(id), [value])

  /** Check if a resource ID was initially selected (for layout stability) */
  const wasInitiallySelected = useCallback(
    (id: string) => initialSelectedIds.includes(id),
    [initialSelectedIds]
  )

  // Filter resources by type inclusion and exclusions
  const filteredResources = useMemo(() => {
    return resources.filter((r) => {
      if (excludeIds.includes(r.id)) return false
      if (r.entityType && !includeSystem) return false
      if (!r.entityType && !includeCustom) return false
      return true
    })
  }, [resources, excludeIds, includeSystem, includeCustom])

  // Initially selected items, filtered by search
  const filteredSelectedItems = useMemo(() => {
    const searchLower = search.toLowerCase()
    return filteredResources.filter((r) => {
      if (!wasInitiallySelected(r.id)) return false
      if (search && !r.label.toLowerCase().includes(searchLower)) return false
      return true
    })
  }, [filteredResources, search, wasInitiallySelected])

  // Available items grouped by type (excluding initially selected)
  const groupedAvailable = useMemo(() => {
    const searchLower = search.toLowerCase()
    const available = filteredResources.filter((r) => {
      if (wasInitiallySelected(r.id)) return false
      if (search && !r.label.toLowerCase().includes(searchLower)) return false
      return true
    })

    const system = available.filter((r) => !!r.entityType)
    const custom = available.filter((r) => !r.entityType)
    return { system, custom }
  }, [filteredResources, search, wasInitiallySelected])

  /** Toggle selection of a resource */
  const handleToggle = useCallback(
    (id: string) => {
      if (multi) {
        const exists = isSelected(id)
        const newValue = exists ? value.filter((v) => v !== id) : [...value, id]
        onChange(newValue)
      } else {
        const exists = isSelected(id)
        if (exists) {
          onChange([])
        } else {
          onChange([id])
          onSelectSingle?.(id)
        }
      }
    },
    [multi, value, onChange, isSelected, onSelectSingle]
  )

  const isLoading = externalLoading || isLoadingResources
  const hasSelectedSection = filteredSelectedItems.length > 0
  const hasSystemSection = includeSystem && groupedAvailable.system.length > 0
  const hasCustomSection = includeCustom && groupedAvailable.custom.length > 0
  const hasResultsSection = hasSystemSection || hasCustomSection
  // Show group headings only when both types are included and visible
  const showGroupHeadings = includeSystem && includeCustom

  return (
    <Command shouldFilter={false} className={cn('rounded-lg', className)}>
      <CommandInput
        placeholder={placeholder}
        value={search}
        onValueChange={setSearch}
        disabled={disabled}
        loading={isLoading}
        autoFocus
      />
      <CommandList>
        <CommandEmpty>No resources found</CommandEmpty>

        {/* Selected Items Section */}
        {hasSelectedSection && (
          <CommandGroup aria-label='Selected'>
            {filteredSelectedItems.map((resource) => (
              <ResourceItem
                key={resource.id}
                resource={resource}
                isSelected={isSelected(resource.id)}
                onToggle={handleToggle}
                multi={multi}
              />
            ))}
          </CommandGroup>
        )}

        {/* Separator between selected and available */}
        {hasSelectedSection && hasResultsSection && <CommandSeparator />}

        {/* System Resources Section */}
        {hasSystemSection && (
          <CommandGroup
            heading={showGroupHeadings ? 'System' : undefined}
            aria-label='System resources'>
            {groupedAvailable.system.map((resource) => (
              <ResourceItem
                key={resource.id}
                resource={resource}
                isSelected={isSelected(resource.id)}
                onToggle={handleToggle}
                multi={multi}
              />
            ))}
          </CommandGroup>
        )}

        {/* Custom Resources Section */}
        {hasCustomSection && (
          <CommandGroup
            heading={showGroupHeadings ? 'Custom' : undefined}
            aria-label='Custom resources'>
            {groupedAvailable.custom.map((resource) => (
              <ResourceItem
                key={resource.id}
                resource={resource}
                isSelected={isSelected(resource.id)}
                onToggle={handleToggle}
                multi={multi}
              />
            ))}
          </CommandGroup>
        )}
      </CommandList>
    </Command>
  )
}
