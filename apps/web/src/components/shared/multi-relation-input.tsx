// apps/web/src/components/shared/multi-relation-input.tsx

'use client'

import { isRecordId, type RecordId } from '@auxx/lib/resources/client'
import type { SelectOptionColor } from '@auxx/types/custom-field'
import { Badge } from '@auxx/ui/components/badge'
import { Popover, PopoverContent, PopoverTrigger } from '@auxx/ui/components/popover'
import { cn } from '@auxx/ui/lib/utils'
import { keepPreviousData } from '@tanstack/react-query'
import { useCallback, useMemo, useState } from 'react'
import { MultiSelectPicker } from '~/components/pickers/multi-select-picker'
import { useResource } from '~/components/resources/hooks/use-resource'
import { PickerTrigger, type PickerTriggerOptions } from '~/components/ui/picker-trigger'
import { useDebouncedValue } from '~/hooks/use-debounced-value'
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

  /** RecordIds to exclude from search results */
  excludeIds?: RecordId[]

  /**
   * Picker rows with no avatar fall back to the related EntityDefinition's icon/color,
   * matching the selected chips (`RecordBadge`) and the record picker (`RecordItem`),
   * both of which fall back unconditionally. Default: true — pass `false` only where a
   * bare label list is deliberate.
   */
  showDefinitionIcon?: boolean

  /**
   * When true, rows show the record's secondary display value (SKU, email, …) muted
   * beside the label. Default: false — worth the row width only where that value is
   * what people search by.
   */
  showSecondary?: boolean

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

  /** Callback to check if a dismiss event should be prevented. Return true to prevent closing. */
  shouldPreventDismiss?: (target: HTMLElement) => boolean
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
  showDefinitionIcon = true,
  showSecondary = false,
  onCreate,
  createLabel,
  triggerProps,
  open: controlledOpen,
  onOpenChange,
  shouldPreventDismiss,
}: MultiRelationInputProps) {
  // Normalize value — callers may pass a single string when switching operators
  const normalizedValue = Array.isArray(value) ? value : value ? [value] : []

  const [internalOpen, setInternalOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  // Search is server-side, so it is the query that gets debounced — feeding every
  // keystroke straight to `record.search` fired one request per character.
  const [debouncedSearch] = useDebouncedValue(searchQuery, 300)

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

  // EntityDefinition icon/color fallback for records without an avatar (on by default)
  const { resource } = useResource(showDefinitionIcon ? tableId : null)

  // Search for items when popover is open
  const { data: searchResults, isLoading: isSearching } = api.record.search.useQuery(
    {
      entityDefinitionId: tableId!,
      query: debouncedSearch,
      limit: 20,
    },
    {
      enabled: open && !!tableId,
      placeholderData: keepPreviousData,
    }
  )

  // Filter out excluded IDs and convert to SelectOption format
  const selectOptions = useMemo(() => {
    const items = searchResults?.items || []
    return items
      .filter((item) => !excludeIds.includes(item.recordId as RecordId))
      .map((item) => ({
        label: item.displayName,
        value: item.recordId,
        avatarUrl: item.avatarUrl,
        // Opt-in: the field the search often matched on (SKU, email). Withholding it is
        // what hides the line — the picker renders `secondary` on its presence alone.
        ...(showSecondary ? { secondary: item.secondaryInfo ?? undefined } : {}),
        // Fall back to the EntityDefinition's icon/color when the record has no avatar
        ...(showDefinitionIcon
          ? { icon: resource?.icon, color: resource?.color as SelectOptionColor | undefined }
          : {}),
      }))
  }, [
    searchResults,
    excludeIds,
    showDefinitionIcon,
    showSecondary,
    resource?.icon,
    resource?.color,
  ])

  /**
   * Handle selection change from MultiSelectPicker
   * Convert string IDs back to RecordId[]
   */
  const handleSelectionChange = useCallback(
    (recordIds: string[]) => {
      // The picker's option values are the search hits' `recordId`s, but it hands them back as
      // plain strings — keep only the ones that really are record ids.
      onChange(recordIds.filter(isRecordId))
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

  const selectedIds = normalizedValue
  const hasValue = normalizedValue.length > 0

  /**
   * Render the trigger content showing selected items
   */
  const renderTriggerContent = () => {
    const displayItems = normalizedValue.slice(0, maxDisplayItems)
    const remainingCount = normalizedValue.length - maxDisplayItems

    return (
      <div className='flex flex-wrap gap-1 flex-1 py-0.5'>
        {displayItems.map((recordId) => (
          <RecordBadge
            key={recordId}
            recordId={recordId}
            size={triggerProps?.badgeSize}
            hoverCard={triggerProps?.badgeHoverCard ?? true}
          />
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
        align='start'
        onPointerDownOutside={(e) => {
          if (shouldPreventDismiss?.(e.target as HTMLElement)) e.preventDefault()
        }}
        onFocusOutside={(e) => {
          if (shouldPreventDismiss?.(e.target as HTMLElement)) e.preventDefault()
        }}>
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
