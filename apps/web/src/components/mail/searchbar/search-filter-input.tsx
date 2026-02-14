// apps/web/src/components/mail/searchbar/search-filter-input.tsx
'use client'

import { AutosizeInput, type AutosizeInputRef } from '@auxx/ui/components/autosize-input'
import { ScrollArea } from '@auxx/ui/components/scroll-area'
import { cn } from '@auxx/ui/lib/utils'
import { useCallback, useRef } from 'react'
import { ConditionBadge } from '~/components/conditions/components/condition-badge'
import { type SearchCondition, useSearchStore } from './store'

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
  inputRef?: React.RefObject<AutosizeInputRef | null>
  /** Callback when input receives focus */
  onFocus?: () => void
}

/**
 * SearchFilterInput displays ConditionBadge components and a text input.
 * Each badge has: [Field ▾] │ [Operator ▾] │ [Value Input] │ [X]
 * Requires ConditionProvider to be wrapped around the parent component.
 */
export function SearchFilterInput({
  onInputChange,
  onInputKeyDown,
  inputValue,
  placeholder = 'Search...',
  className,
  inputRef: externalInputRef,
  onFocus,
}: SearchFilterInputProps) {
  const internalInputRef = useRef<AutosizeInputRef>(null)
  const inputRef = externalInputRef || internalInputRef
  const containerRef = useRef<HTMLDivElement>(null)

  // Get conditions from store
  const conditions = useSearchStore((s) => s.conditions)
  const highlightedIndex = useSearchStore((s) => s.highlightedIndex)

  // Actions
  const setHighlightedIndex = useSearchStore((s) => s.setHighlightedIndex)
  const removeCondition = useSearchStore((s) => s.removeCondition)
  const updateCondition = useSearchStore((s) => s.updateCondition)

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
      if (e.key === 'Backspace' && inputValue === '' && conditions.length > 0) {
        e.preventDefault()
        if (highlightedIndex === conditions.length - 1) {
          // Second backspace: delete highlighted condition
          const condition = conditions[highlightedIndex]
          removeCondition(condition.id)
          setHighlightedIndex(null)
        } else {
          // First backspace: highlight last condition
          setHighlightedIndex(conditions.length - 1)
        }
        return
      }

      // Clear highlight when typing
      if (highlightedIndex !== null && e.key.length === 1) {
        setHighlightedIndex(null)
      }

      // Forward to parent for suggestion navigation
      onInputKeyDown(e)
    },
    [inputValue, conditions, highlightedIndex, removeCondition, setHighlightedIndex, onInputKeyDown]
  )

  return (
    <ScrollArea
      orientation='horizontal'
      scrollbarClassName='h-1.5!'
      className={cn('flex-1', className)}>
      <div
        ref={containerRef}
        onClick={handleContainerClick}
        className='flex items-center gap-1 h-8 cursor-text pt-0.5 pb-1'>
        {/* Condition badges - full editable badges with field/operator/value/remove */}
        {conditions.map((condition, index) => (
          <ConditionBadge
            key={condition.id}
            condition={condition}
            isHighlighted={highlightedIndex === index}
            showRemoveButton={true}
            onUpdate={(updates) => updateCondition(condition.id, updates)}
            onRemove={() => {
              removeCondition(condition.id)
              inputRef.current?.focus()
            }}
          />
        ))}

        {/* Text input */}
        <AutosizeInput
          ref={inputRef}
          value={inputValue}
          onChange={(e) => onInputChange(e.target.value)}
          onKeyDown={handleInputKeyDown}
          onFocus={onFocus}
          placeholder={conditions.length === 0 ? placeholder : ''}
          minWidth={100}
          inputClassName='bg-transparent outline-none text-sm'
        />
      </div>
    </ScrollArea>
  )
}
