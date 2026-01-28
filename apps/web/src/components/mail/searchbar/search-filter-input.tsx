// apps/web/src/components/mail/searchbar/search-filter-input.tsx
'use client'

import { useRef, useCallback, useMemo } from 'react'
import { useShallow } from 'zustand/shallow'
import { useSearchStore, buildFilterChips, type FilterChip } from './store'
import { FilterBadge } from './filter-badge'
import { cn } from '@auxx/ui/lib/utils'
import type { SearchFilters } from '@auxx/lib/mail-query'

/**
 * Props for SearchFilterInput component
 */
interface SearchFilterInputProps {
  /** Callback when input text changes */
  onInputChange: (value: string) => void
  /** Callback for keyboard events on the input */
  onInputKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void
  /** Current input text value */
  inputValue: string
  /** Placeholder text when empty */
  placeholder?: string
  /** Additional CSS classes */
  className?: string
  /** Ref to expose focus method */
  inputRef?: React.RefObject<HTMLInputElement | null>
}

/**
 * SearchFilterInput displays filter badges and a text input.
 * Orchestrates badge editing/navigation with keyboard support.
 */
export function SearchFilterInput({
  onInputChange,
  onInputKeyDown,
  inputValue,
  placeholder = 'Search...',
  className,
  inputRef: externalInputRef,
}: SearchFilterInputProps) {
  const internalInputRef = useRef<HTMLInputElement>(null)
  const inputRef = externalInputRef || internalInputRef
  const containerRef = useRef<HTMLDivElement>(null)

  // Get filter chips from store
  const filters = useSearchStore(useShallow((s) => s.filters))
  const chips = useMemo(() => buildFilterChips(filters), [filters])

  // UI state
  const editingFilter = useSearchStore((s) => s.editingFilter)
  const highlightedIndex = useSearchStore((s) => s.highlightedBadgeIndex)

  // Actions
  const setEditingFilter = useSearchStore((s) => s.setEditingFilter)
  const setHighlightedBadgeIndex = useSearchStore((s) => s.setHighlightedBadgeIndex)
  const removeFilter = useSearchStore((s) => s.removeFilter)
  const updateFilterValue = useSearchStore((s) => s.updateFilterValue)

  /** Focus input when clicking container background */
  const handleContainerClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === containerRef.current) {
        inputRef.current?.focus()
      }
    },
    [inputRef]
  )

  /** Handle input keydown for badge navigation */
  const handleInputKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      // Backspace on empty input
      if (e.key === 'Backspace' && inputValue === '' && chips.length > 0) {
        e.preventDefault()
        if (highlightedIndex === chips.length - 1) {
          // Second backspace: delete highlighted badge
          const chip = chips[highlightedIndex]
          removeFilter(chip.type, chip.id || chip.value)
          setHighlightedBadgeIndex(null)
        } else {
          // First backspace: highlight last badge
          setHighlightedBadgeIndex(chips.length - 1)
        }
        return
      }

      // Arrow left at start of input
      if (
        e.key === 'ArrowLeft' &&
        inputRef.current?.selectionStart === 0 &&
        chips.length > 0
      ) {
        e.preventDefault()
        // Start editing last badge
        const lastChip = chips[chips.length - 1]
        setEditingFilter({ type: lastChip.type, index: chips.length - 1 })
        return
      }

      // Clear highlight when typing
      if (highlightedIndex !== null && e.key.length === 1) {
        setHighlightedBadgeIndex(null)
      }

      // Forward to parent for suggestion navigation
      onInputKeyDown(e)
    },
    [
      inputValue,
      chips,
      highlightedIndex,
      inputRef,
      removeFilter,
      setHighlightedBadgeIndex,
      setEditingFilter,
      onInputKeyDown,
    ]
  )

  /** Start editing a badge */
  const handleBadgeEditStart = useCallback(
    (index: number) => {
      setEditingFilter({ type: chips[index].type, index })
      setHighlightedBadgeIndex(null)
    },
    [chips, setEditingFilter, setHighlightedBadgeIndex]
  )

  /** End editing a badge */
  const handleBadgeEditEnd = useCallback(() => {
    setEditingFilter(null)
    // Focus main input after edit
    setTimeout(() => inputRef.current?.focus(), 0)
  }, [setEditingFilter, inputRef])

  /** Update a badge value */
  const handleBadgeEdit = useCallback(
    (index: number, newValue: string) => {
      const chip = chips[index]
      if (newValue !== chip.value) {
        updateFilterValue(chip.type, chip.id || chip.value, newValue)
      }
    },
    [chips, updateFilterValue]
  )

  /** Delete a badge */
  const handleBadgeDelete = useCallback(
    (index: number) => {
      const chip = chips[index]
      removeFilter(chip.type, chip.id || chip.value)
      setEditingFilter(null)
      inputRef.current?.focus()
    },
    [chips, removeFilter, setEditingFilter, inputRef]
  )

  /** Navigate to next badge or input */
  const handleBadgeNavigateRight = useCallback(
    (index: number) => {
      if (index < chips.length - 1) {
        // Move to next badge
        setEditingFilter({ type: chips[index + 1].type, index: index + 1 })
      } else {
        // Move to input
        setEditingFilter(null)
        inputRef.current?.focus()
      }
    },
    [chips, setEditingFilter, inputRef]
  )

  /** Navigate to previous badge */
  const handleBadgeNavigateLeft = useCallback(
    (index: number) => {
      if (index > 0) {
        setEditingFilter({ type: chips[index - 1].type, index: index - 1 })
      }
    },
    [chips, setEditingFilter]
  )

  return (
    <div
      ref={containerRef}
      onClick={handleContainerClick}
      className={cn(
        'flex items-center gap-1 flex-1 flex-wrap min-h-[32px] cursor-text',
        className
      )}
    >
      {/* Filter badges */}
      {chips.map((chip, index) => (
        <FilterBadge
          key={chip.key}
          operator={chip.type}
          value={chip.value}
          isEditing={editingFilter?.index === index}
          isHighlighted={highlightedIndex === index}
          onEdit={(newValue) => handleBadgeEdit(index, newValue)}
          onDelete={() => handleBadgeDelete(index)}
          onEditStart={() => handleBadgeEditStart(index)}
          onEditEnd={handleBadgeEditEnd}
          onNavigateLeft={() => handleBadgeNavigateLeft(index)}
          onNavigateRight={() => handleBadgeNavigateRight(index)}
        />
      ))}

      {/* Text input */}
      <input
        ref={inputRef}
        type="text"
        value={inputValue}
        onChange={(e) => onInputChange(e.target.value)}
        onKeyDown={handleInputKeyDown}
        placeholder={chips.length === 0 ? placeholder : ''}
        className="flex-1 min-w-[100px] bg-transparent outline-none text-sm"
      />
    </div>
  )
}
