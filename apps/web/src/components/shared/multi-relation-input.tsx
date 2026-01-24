// apps/web/src/components/shared/multi-relation-input.tsx

'use client'

import { useState, useMemo, useCallback } from 'react'
import { api } from '~/trpc/react'
import { Popover, PopoverContent, PopoverTrigger } from '@auxx/ui/components/popover'
import { Button } from '@auxx/ui/components/button'
import { ChevronDown, X } from 'lucide-react'
import { cn } from '@auxx/ui/lib/utils'
import { Badge } from '@auxx/ui/components/badge'
import { MultiSelectPicker } from '~/components/pickers/multi-select-picker'
import { type RecordId } from '@auxx/lib/resources/client'
import { RecordBadge } from '../resources/ui'

/**
 * Props for MultiRelationInput
 */
export interface MultiRelationInputProps {
  /** Entity definition ID filter:
   * - undefined: Global search (all entity types) - NOT YET SUPPORTED
   * - string: Single entity type
   * - string[]: Multiple specific entity types - NOT YET SUPPORTED
   */
  entityDefinitionId?: string | string[]

  /** Currently selected RecordIds */
  value: RecordId[]

  /** Callback when selection changes */
  onChange: (recordIds: RecordId[]) => void

  /** Whether the input is disabled */
  disabled?: boolean

  /** Placeholder text when nothing selected */
  placeholder?: string

  /** Additional CSS classes */
  className?: string

  /** Maximum items to show in the trigger before collapsing */
  maxDisplayItems?: number

  /** Allow multiple selections (default: true) */
  multi?: boolean

  /** IDs to exclude from search results (entityInstanceIds) */
  excludeIds?: string[]

  /** Callback when "Create new" is clicked (for complex creation flows via dialog) */
  onCreate?: () => void

  /** Label for create button (default: "Create new") */
  createLabel?: string
}

/**
 * MultiRelationInput - Multi-select picker for relationship fields
 *
 * Uses the relationship store for caching hydrated items.
 * Supports selecting multiple related records with checkbox-style toggling.
 */
export function MultiRelationInput({
  entityDefinitionId,
  value = [],
  onChange,
  disabled = false,
  placeholder = 'Select items...',
  className,
  maxDisplayItems = 3,
  multi = true,
  excludeIds = [],
  onCreate,
  createLabel,
}: MultiRelationInputProps) {
  const [open, setOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')

  // Derive tableId for search - use first entity definition if array
  const tableId = useMemo(() => {
    if (!entityDefinitionId) return null
    return Array.isArray(entityDefinitionId) ? entityDefinitionId[0] : entityDefinitionId
  }, [entityDefinitionId])

  // Search for items when popover is open
  const { data: searchResults, isLoading: isSearching } = api.record.search.useQuery(
    {
      entityDefinitionId: tableId!,
      query: searchQuery,
      limit: 20,
    },
    {
      enabled: open && !!tableId,
    }
  )

  // Filter out excluded IDs and convert to SelectOption format
  const selectOptions = useMemo(() => {
    const items = searchResults?.items || []
    return items
      .filter((item) => !excludeIds.includes(item.id))
      .map((item) => ({
        label: item.displayName,
        value: item.recordId,
      }))
  }, [searchResults, excludeIds])

  /**
   * Handle selection change from MultiSelectPicker
   * Convert string IDs back to RecordId[]
   */
  const handleSelectionChange = useCallback(
    (recordIds: string[]) => {
      onChange(recordIds)
    },
    [tableId, onChange]
  )

  /**
   * Handle single-select: close popover after selection
   */
  const handleSelectSingle = useCallback(() => {
    setOpen(false)
    setSearchQuery('')
  }, [])

  /**
   * Clear all selections
   */
  const handleClearAll = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      onChange([])
    },
    [onChange]
  )

  // Convert value to string[] for MultiSelectPicker (extract instance IDs)
  // const selectedIds = useMemo(() => value.map(getInstanceId), [value])
  const selectedIds = value
  const hasValue = value.length > 0

  /**
   * Render the trigger content showing selected items
   */
  const renderTriggerContent = () => {
    if (value.length === 0) {
      return (
        <span className="text-primary-400 text-sm font-normal pointer-events-none">
          {placeholder}
        </span>
      )
    }

    const displayItems = value.slice(0, maxDisplayItems)
    const remainingCount = value.length - maxDisplayItems

    return (
      <div className="flex flex-wrap gap-1 flex-1 py-0.5">
        {displayItems.map((recordId) => (
          <RecordBadge key={recordId} recordId={recordId} />
        ))}
        {remainingCount > 0 && (
          <Badge variant="outline" className="text-xs">
            +{remainingCount}
          </Badge>
        )}
      </div>
    )
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="transparent"
          size="sm"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className={cn('w-full ps-0 pe-1 h-auto min-h-8 justify-between flex-1', className)}>
          <div className="flex items-center gap-2 flex-1 min-w-0">{renderTriggerContent()}</div>
          <div className="flex items-center gap-1 shrink-0">
            {hasValue && multi && (
              <div
                className="size-4 flex items-center justify-center rounded-full bg-primary-500/30 text-primary-100 transition-colors hover:bg-bad-100 hover:text-bad-500"
                onClick={handleClearAll}>
                <X className="size-3!" />
              </div>
            )}
            <ChevronDown className="opacity-50" />
          </div>
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="p-0 min-w-[max(var(--radix-popover-trigger-width),18rem)]"
        align="start">
        <MultiSelectPicker
          options={selectOptions}
          value={selectedIds}
          onChange={handleSelectionChange}
          isLoading={isSearching}
          onSearchChange={setSearchQuery}
          canManage={false}
          canAdd={false}
          multi={multi}
          placeholder="Search..."
          onSelectSingle={handleSelectSingle}
          disabled={disabled}
          onCreate={onCreate}
          createLabel={createLabel}
        />
      </PopoverContent>
    </Popover>
  )
}
