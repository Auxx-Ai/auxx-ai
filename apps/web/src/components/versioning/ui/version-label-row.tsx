// apps/web/src/components/versioning/ui/version-label-row.tsx
'use client'

import { AutosizeInput, type AutosizeInputRef } from '@auxx/ui/components/autosize-input'
import { cn } from '@auxx/ui/lib/utils'
import { Pencil, Trash2, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

interface VersionLabelRowProps {
  label: string | null
  isEditing: boolean
  isPending: boolean
  onStartEdit: () => void
  onSave: (value: string) => void
  onCancel: () => void
  onClear: () => void
}

/**
 * Inline-editable label pill for a version row — lifted verbatim from the KB
 * article versions dialog so all three versioning consumers (agents,
 * procedures, articles) share one editor. Hover reveals edit/clear; Enter saves,
 * Escape cancels. See plans/agents/agent-versions/ui-plan.md §1.
 */
export function VersionLabelRow({
  label,
  isEditing,
  isPending,
  onStartEdit,
  onSave,
  onCancel,
  onClear,
}: VersionLabelRowProps) {
  const inputRef = useRef<AutosizeInputRef>(null)
  const [editValue, setEditValue] = useState('')
  const hasLabel = label != null && label !== ''

  useEffect(() => {
    if (isEditing) {
      setEditValue(label ?? '')
      requestAnimationFrame(() => inputRef.current?.focus())
    }
  }, [isEditing, label])

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault()
      onSave(editValue)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      onCancel()
    }
  }

  return (
    <div
      onClick={!isEditing ? onStartEdit : undefined}
      className={cn(
        'group relative flex h-7 items-center gap-1 rounded-md bg-primary-100 px-2 transition-opacity',
        !isEditing && 'cursor-pointer',
        isPending && 'opacity-50'
      )}>
      {isEditing ? (
        <AutosizeInput
          ref={inputRef}
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onBlur={() => onSave(editValue)}
          onKeyDown={handleKeyDown}
          placeholder='e.g. pricing update'
          inputClassName='bg-transparent text-sm text-foreground outline-none'
          minWidth={40}
          maxWidth={240}
        />
      ) : hasLabel ? (
        <span className='truncate text-sm text-foreground'>{label}</span>
      ) : (
        <span className='text-sm text-muted-foreground'>Add label</span>
      )}

      {/* Actions — fade in on hover, always shown while editing */}
      <div
        className={cn(
          'absolute right-1 flex items-center gap-0.5 transition-opacity duration-150',
          isEditing ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
        )}>
        {isEditing ? (
          <button
            type='button'
            onMouseDown={(e) => {
              e.preventDefault()
              e.stopPropagation()
              onCancel()
            }}
            className='flex size-5.5 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-primary-200 hover:text-foreground'>
            <X className='size-3' />
          </button>
        ) : (
          <>
            <button
              type='button'
              onClick={(e) => {
                e.stopPropagation()
                onStartEdit()
              }}
              className='flex size-5.5 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-primary-200 hover:text-foreground'>
              <Pencil className='size-3' />
            </button>
            {hasLabel && (
              <button
                type='button'
                onClick={(e) => {
                  e.stopPropagation()
                  onClear()
                }}
                className='flex size-5.5 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-primary-200 hover:text-foreground'>
                <Trash2 className='size-3' />
              </button>
            )}
          </>
        )}
      </div>
    </div>
  )
}
