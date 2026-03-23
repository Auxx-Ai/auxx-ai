// apps/web/src/components/pickers/participant-picker.tsx
'use client'

import { Badge } from '@auxx/ui/components/badge'
import { Popover, PopoverContent, PopoverTrigger } from '@auxx/ui/components/popover'
import { cn } from '@auxx/ui/lib/utils'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { MultiSelectPicker } from '~/components/pickers/multi-select-picker'
import { ItemsListView } from '~/components/ui/items-list-view'
import { PickerTrigger, type PickerTriggerOptions } from '~/components/ui/picker-trigger'
import { useDebouncedValue } from '~/hooks/use-debounced-value'
import { api } from '~/trpc/react'

export interface ParticipantPickerProps {
  /** Currently selected email identifiers */
  value: string[]
  /** Callback when selection changes */
  onChange: (identifiers: string[]) => void
  /** Filter participants by type */
  type?: 'from' | 'to' | 'cc' | 'any'
  /** Allow multiple selections (default: true) */
  multi?: boolean
  /** Whether the input is disabled */
  disabled?: boolean
  /** Placeholder text */
  placeholder?: string
  /** Additional CSS classes */
  className?: string
  /** Trigger customization options */
  triggerProps?: PickerTriggerOptions
  /** Controlled open state */
  open?: boolean
  /** Callback when open state changes */
  onOpenChange?: (open: boolean) => void
}

export function ParticipantPicker({
  value = [],
  onChange,
  type = 'any',
  multi = true,
  disabled = false,
  placeholder = 'Select participant...',
  className,
  triggerProps,
  open: controlledOpen,
  onOpenChange,
}: ParticipantPickerProps) {
  const normalizedValue = Array.isArray(value) ? value : value ? [value] : []

  const [internalOpen, setInternalOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [debouncedSearch] = useDebouncedValue(searchQuery, 300)

  // Track the last query that returned 0 results to avoid redundant fetches
  const emptyQueryRef = useRef<string | null>(null)

  const open = controlledOpen ?? internalOpen
  const setOpen = (newOpen: boolean) => {
    if (!newOpen) {
      emptyQueryRef.current = null
    }
    if (controlledOpen === undefined) {
      setInternalOpen(newOpen)
    }
    onOpenChange?.(newOpen)
  }

  // Skip fetching if current query extends a query that already returned 0 results
  const shouldFetch =
    open &&
    debouncedSearch.length > 0 &&
    !(emptyQueryRef.current && debouncedSearch.startsWith(emptyQueryRef.current))

  // Fetch participants based on debounced search
  const {
    data: participants = [],
    isLoading,
    isFetched,
  } = api.search.participants.useQuery({ query: debouncedSearch, type }, { enabled: shouldFetch })

  // Track queries that return 0 results to avoid redundant fetches
  useEffect(() => {
    if (isFetched && shouldFetch) {
      emptyQueryRef.current = participants.length === 0 ? debouncedSearch : null
    }
  }, [isFetched, shouldFetch, participants.length, debouncedSearch])

  // Convert to SelectOption format for MultiSelectPicker
  // Include already-selected values so they show as checked when reopening
  const selectOptions = useMemo(() => {
    const fromSearch = participants.map((p) => ({
      label: p.displayName ? `${p.displayName} (${p.identifier})` : p.identifier,
      value: p.identifier,
    }))
    const searchValues = new Set(fromSearch.map((o) => o.value))
    const fromSelected = normalizedValue
      .filter((id) => !searchValues.has(id))
      .map((id) => ({ label: id, value: id }))
    return [...fromSelected, ...fromSearch]
  }, [participants, normalizedValue])

  const handleSelectionChange = useCallback(
    (identifiers: string[]) => {
      onChange(identifiers)
    },
    [onChange]
  )

  // biome-ignore lint/correctness/useExhaustiveDependencies: setOpen is a stable useState setter
  const handleSelectSingle = useCallback(() => {
    setOpen(false)
    setSearchQuery('')
  }, [])

  const handleClearAll = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      onChange([])
    },
    [onChange]
  )

  const hasValue = normalizedValue.length > 0

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
          <ItemsListView
            items={normalizedValue}
            maxDisplay={3}
            renderItem={(identifier) => (
              <Badge variant='outline' className='text-xs truncate max-w-[180px]'>
                {String(identifier)}
              </Badge>
            )}
          />
        </PickerTrigger>
      </PopoverTrigger>
      <PopoverContent
        className='p-0 min-w-[max(var(--radix-popover-trigger-width),18rem)]'
        align='start'>
        <MultiSelectPicker
          options={selectOptions}
          value={normalizedValue}
          onChange={handleSelectionChange}
          isLoading={isLoading}
          onSearchChange={setSearchQuery}
          canManage={false}
          canAdd={true}
          useValueAsLabel
          multi={multi}
          placeholder='Search by name or email...'
          onSelectSingle={handleSelectSingle}
          disabled={disabled}
        />
      </PopoverContent>
    </Popover>
  )
}
