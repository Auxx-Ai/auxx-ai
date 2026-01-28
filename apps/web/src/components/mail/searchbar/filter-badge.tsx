// apps/web/src/components/mail/searchbar/filter-badge.tsx
'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { Badge } from '@auxx/ui/components/badge'
import { AutosizeInput, type AutosizeInputRef } from '@auxx/ui/components/autosize-input'
import { X } from 'lucide-react'
import { cn } from '@auxx/ui/lib/utils'

/**
 * Props for the FilterBadge component
 */
interface FilterBadgeProps {
  /** Operator type (e.g., 'tag', 'from', 'assignee') */
  operator: string
  /** Display value (name, not ID) */
  value: string
  /** Whether this badge is currently being edited */
  isEditing: boolean
  /** Whether this badge is highlighted (via backspace) */
  isHighlighted: boolean
  /** Callback when the value is edited */
  onEdit: (newValue: string) => void
  /** Callback when the badge is deleted */
  onDelete: () => void
  /** Callback when entering edit mode */
  onEditStart: () => void
  /** Callback when exiting edit mode */
  onEditEnd: () => void
  /** Callback when navigating left at start of input */
  onNavigateLeft?: () => void
  /** Callback when navigating right at end of input */
  onNavigateRight?: () => void
}

/**
 * FilterBadge displays a search filter as a badge with edit capability.
 * - Display mode: shows operator:value with click to edit
 * - Edit mode: inline input for modifying the value
 */
export function FilterBadge({
  operator,
  value,
  isEditing,
  isHighlighted,
  onEdit,
  onDelete,
  onEditStart,
  onEditEnd,
  onNavigateLeft,
  onNavigateRight,
}: FilterBadgeProps) {
  const inputRef = useRef<AutosizeInputRef>(null)
  const [editValue, setEditValue] = useState(value)

  // Focus and select input when entering edit mode
  useEffect(() => {
    if (isEditing) {
      inputRef.current?.focus()
      inputRef.current?.select()
    }
  }, [isEditing])

  // Sync edit value when value prop changes (when not editing)
  useEffect(() => {
    if (!isEditing) {
      setEditValue(value)
    }
  }, [value, isEditing])

  /** Handle keyboard events in edit mode */
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      const input = inputRef.current?.getInput()

      if (e.key === 'Enter') {
        e.preventDefault()
        onEdit(editValue)
        onEditEnd()
      } else if (e.key === 'Escape') {
        e.preventDefault()
        setEditValue(value) // Reset to original
        onEditEnd()
      } else if (e.key === 'ArrowLeft' && input?.selectionStart === 0) {
        e.preventDefault()
        onNavigateLeft?.()
      } else if (
        e.key === 'ArrowRight' &&
        input?.selectionStart === editValue.length
      ) {
        e.preventDefault()
        onNavigateRight?.()
      } else if (e.key === 'Backspace' && editValue === '') {
        e.preventDefault()
        onDelete()
      }
    },
    [editValue, value, onEdit, onEditEnd, onNavigateLeft, onNavigateRight, onDelete]
  )

  /** Save value on blur */
  const handleBlur = useCallback(() => {
    onEdit(editValue)
    onEditEnd()
  }, [editValue, onEdit, onEditEnd])

  return (
    <Badge
      variant="user"
      aria-selected={isHighlighted}
      className={cn(
        'ps-2 pe-1 shrink-0 group gap-0.5',
        isHighlighted && 'bg-info text-white',
        isEditing && 'ring-2 ring-info'
      )}
    >
      {/* Operator label */}
      <span
        className={cn(
          'text-blue-600 font-medium',
          isHighlighted && 'text-white'
        )}
      >
        {operator}:
      </span>

      {/* Value - either autosize input or clickable button */}
      {isEditing ? (
        <AutosizeInput
          ref={inputRef}
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={handleBlur}
          minWidth={30}
          maxWidth={200}
          inputClassName="bg-transparent outline-none text-sm"
        />
      ) : (
        <button
          type="button"
          onClick={onEditStart}
          className="text-left hover:underline"
        >
          {value || <span className="text-muted-foreground italic">empty</span>}
        </button>
      )}

      {/* Delete button */}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          onDelete()
        }}
        className={cn(
          'rounded-full size-4 flex items-center justify-center',
          'text-blue-600 hover:text-blue-800',
          isHighlighted && 'text-white hover:text-white/80'
        )}
        aria-label={`Remove ${operator} filter`}
      >
        <X className="size-3" />
      </button>
    </Badge>
  )
}
