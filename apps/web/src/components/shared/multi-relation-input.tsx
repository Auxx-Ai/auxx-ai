// apps/web/src/components/shared/multi-relation-input.tsx

'use client'

import type { RecordId } from '@auxx/lib/resources/client'
import { Badge } from '@auxx/ui/components/badge'
import { Popover, PopoverContent, PopoverTrigger } from '@auxx/ui/components/popover'
import { cn } from '@auxx/ui/lib/utils'
import { useCallback, useMemo, useState } from 'react'
import { MultiSelectPicker } from '~/components/pickers/multi-select-picker'
import { PickerTrigger, type PickerTriggerOptions } from '~/components/ui/picker-trigger'
import { api } from '~/trpc/react'
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

  /** Trigger customization options */
  triggerProps?: PickerTriggerOptions

  /** Controlled open state */
  open?: boolean

  /** Callback when open state changes */
  onOpenChange?: (open: boolean) => void
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
  triggerProps,
  open: controlledOpen,
  onOpenChange,
}: MultiRelationInputProps) {
  const [internalOpen, setInternalOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')

  // Use controlled or uncontrolled state
  const open = controlledOpen ?? internalOpen
  const setOpen = (newOpen: boolean) => {
    if (controlledOpen === undefined) {
      setInternalOpen(newOpen)
    }
    onOpenChange?.(newOpen)
  }

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
    [onChange]
  )

  /**
   * Handle single-select: close popover after selection
   */
  // biome-ignore lint/correctness/useExhaustiveDependencies: setOpen is a stable useState setter
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
    const displayItems = value.slice(0, maxDisplayItems)
    const remainingCount = value.length - maxDisplayItems

    return (
      <div className='flex flex-wrap gap-1 flex-1 py-0.5'>
        {displayItems.map((recordId) => (
          <RecordBadge key={recordId} recordId={recordId} size={triggerProps?.badgeSize} />
        ))}
        {remainingCount > 0 && (
          <Badge variant='outline' className='text-xs'>
            +{remainingCount}
          </Badge>
        )}
      </div>
    )
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <PickerTrigger
          open={open}
          disabled={disabled}
          variant={triggerProps?.variant ?? 'transparent'}
          size={triggerProps?.size}
          hasValue={hasValue}
          placeholder={placeholder}
          showClear={triggerProps?.showClear ?? multi}
          hideIcon={triggerProps?.hideIcon}
          onClear={handleClearAll}
          asCombobox
          className={cn('h-auto min-h-8', className, triggerProps?.className)}>
          {renderTriggerContent()}
        </PickerTrigger>
      </PopoverTrigger>
      <PopoverContent
        className='p-0 min-w-[max(var(--radix-popover-trigger-width),18rem)]'
        align='start'>
        <MultiSelectPicker
          options={selectOptions}
          value={selectedIds}
          onChange={handleSelectionChange}
          isLoading={isSearching}
          onSearchChange={setSearchQuery}
          canManage={false}
          canAdd={false}
          multi={multi}
          placeholder='Search...'
          onSelectSingle={handleSelectSingle}
          disabled={disabled}
          onCreate={onCreate}
          createLabel={createLabel}
        />
      </PopoverContent>
    </Popover>
  )
}
