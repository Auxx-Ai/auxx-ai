// apps/web/src/components/searchbar/search-filter-input.tsx
'use client'

import { AutosizeInput, type AutosizeInputRef } from '@auxx/ui/components/autosize-input'
import { ScrollArea } from '@auxx/ui/components/scroll-area'
import { cn } from '@auxx/ui/lib/utils'
import { useCallback, useRef } from 'react'
import { ConditionBadge } from '~/components/conditions/components/condition-badge'
import type { SearchCondition } from './types'

/**
 * Props for SearchFilterInput component
 */
interface SearchFilterInputProps {
  /** Conditions to render as badges */
  conditions: SearchCondition[]
  /** Field IDs to hide from badge display (e.g., scope field in mail) */
  hiddenFieldIds?: Set<string>
  /** Index of keyboard-highlighted badge, null = none */
  highlightedIndex: number | null

  // Callbacks
  onUpdateCondition: (id: string, updates: Partial<SearchCondition>) => void
  onRemoveCondition: (id: string) => void
  onHighlightChange: (index: number | null) => void

  // Input props
  /** Ref to expose focus method */
  inputRef?: React.RefObject<AutosizeInputRef | null>
  /** Current input text value */
  inputValue: string
  /** Callback when input text changes */
  onInputChange: (value: string) => void
  /** Callback for keyboard events on the input */
  onInputKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void
  /** Callback when input receives focus */
  onFocus?: () => void
  /** Placeholder text when empty */
  placeholder?: string
  /** Additional CSS classes */
  className?: string
  /** Ref to the searchbar container — used to prevent badge popovers from closing when clicking inside the searchbar */
  searchBarRef?: React.RefObject<HTMLElement | null>

  /** Field IDs that are pinned (non-removable, locked field selector). Shown with special styling. */
  pinnedFieldIds?: Set<string>
  /** Custom class for pinned/locked badges (e.g., scope badge styling) */
  pinnedBadgeClassName?: string
}

/**
 * SearchFilterInput displays ConditionBadge components and a text input.
 * Each badge has: [Field ▾] │ [Operator ▾] │ [Value Input] │ [X]
 * Requires ConditionProvider to be wrapped around the parent component.
 */
export function SearchFilterInput({
  conditions,
  hiddenFieldIds,
  highlightedIndex,
  onUpdateCondition,
  onRemoveCondition,
  onHighlightChange,
  inputRef: externalInputRef,
  inputValue,
  onInputChange,
  onInputKeyDown,
  onFocus,
  placeholder = 'Search...',
  className,
  searchBarRef,
  pinnedFieldIds,
  pinnedBadgeClassName,
}: SearchFilterInputProps) {
  const internalInputRef = useRef<AutosizeInputRef>(null)
  const inputRef = externalInputRef || internalInputRef
  const containerRef = useRef<HTMLDivElement>(null)

  /** Check if a dismiss target is inside the searchbar boundary */
  const shouldPreventDismiss = useCallback(
    (target: HTMLElement) => {
      // Inside the searchbar container
      if (searchBarRef?.current?.contains(target)) return true
      // Inside a portaled popover whose trigger is inside the searchbar
      const popoverWrapper = target.closest('[data-radix-popper-content-wrapper]')
      if (popoverWrapper && searchBarRef?.current) {
        const contentEl = popoverWrapper.querySelector('[id]')
        if (contentEl) {
          const trigger = document.querySelector(`[aria-controls="${contentEl.id}"]`)
          if (trigger && searchBarRef.current.contains(trigger)) return true
        }
      }
      return false
    },
    [searchBarRef]
  )

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
      // Backspace on empty input — skip hidden conditions
      if (e.key === 'Backspace' && inputValue === '' && conditions.length > 0) {
        const lastVisibleIndex = conditions.findLastIndex((c) => !hiddenFieldIds?.has(c.fieldId))
        if (lastVisibleIndex === -1) return // No visible conditions

        e.preventDefault()
        if (highlightedIndex === lastVisibleIndex) {
          // Second backspace: delete highlighted condition
          onRemoveCondition(conditions[highlightedIndex].id)
          onHighlightChange(null)
        } else {
          // First backspace: highlight last visible condition
          onHighlightChange(lastVisibleIndex)
        }
        return
      }

      // Clear highlight when typing
      if (highlightedIndex !== null && e.key.length === 1) {
        onHighlightChange(null)
      }

      // Forward to parent for suggestion navigation
      onInputKeyDown(e)
    },
    [
      inputValue,
      conditions,
      hiddenFieldIds,
      highlightedIndex,
      onRemoveCondition,
      onHighlightChange,
      onInputKeyDown,
    ]
  )

  // Check if there are any visible non-hidden conditions
  const hasVisibleConditions = conditions.some((c) => !hiddenFieldIds?.has(c.fieldId))

  return (
    <ScrollArea
      orientation='horizontal'
      scrollbarClassName='h-0.5! mb-0!'
      className={cn('flex-1', className)}>
      <div
        ref={containerRef}
        onClick={handleContainerClick}
        className='flex items-center gap-1 h-8 cursor-text pt-0.5'>
        {/* Condition badges - full editable badges with field/operator/value/remove */}
        {conditions.map((condition, index) => {
          if (hiddenFieldIds?.has(condition.fieldId)) return null

          const isPinned = pinnedFieldIds?.has(condition.fieldId)
          return (
            <ConditionBadge
              key={condition.id}
              condition={condition}
              isHighlighted={highlightedIndex === index}
              showRemoveButton={!isPinned}
              lockField={isPinned}
              shouldPreventDismiss={shouldPreventDismiss}
              className={isPinned ? pinnedBadgeClassName : undefined}
              onUpdate={(updates) => onUpdateCondition(condition.id, updates)}
              onRemove={() => {
                onRemoveCondition(condition.id)
                inputRef.current?.focus()
              }}
            />
          )
        })}

        {/* Text input */}
        <AutosizeInput
          ref={inputRef}
          value={inputValue}
          onChange={(e) => onInputChange(e.target.value)}
          onKeyDown={handleInputKeyDown}
          onFocus={onFocus}
          placeholder={!hasVisibleConditions ? placeholder : ''}
          minWidth={100}
          inputClassName='bg-transparent outline-none text-sm'
        />
      </div>
    </ScrollArea>
  )
}
