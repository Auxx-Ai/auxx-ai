// apps/web/src/components/kb/ui/sidebar/rename-input.tsx
'use client'

import { AutosizeInput, type AutosizeInputRef } from '@auxx/ui/components/autosize-input'
import { type KeyboardEvent, useCallback, useEffect, useRef, useState } from 'react'

interface RenameInputProps {
  initialValue: string
  placeholder?: string
  /** Called with the trimmed value when it differs from initialValue and is non-empty. */
  onCommit: (trimmed: string) => void
  /** Called on Escape, or on blur/Enter when the value is empty or unchanged. */
  onCancel: () => void
  inputClassName?: string
  minWidth?: number
  extraWidth?: number
}

/**
 * Inline rename input shared across KB sidebar items, headers, and tab pills.
 * Built on `AutosizeInput` so the field grows to content. Mount focuses + selects;
 * Enter commits, Escape cancels, blur commits-or-cancels.
 */
export function RenameInput({
  initialValue,
  placeholder,
  onCommit,
  onCancel,
  inputClassName,
  minWidth = 30,
  extraWidth,
}: RenameInputProps) {
  const [value, setValue] = useState(initialValue)
  const inputRef = useRef<AutosizeInputRef>(null)

  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])

  const finish = useCallback(() => {
    const trimmed = value.trim()
    if (!trimmed || trimmed === initialValue) {
      onCancel()
      return
    }
    onCommit(trimmed)
  }, [value, initialValue, onCommit, onCancel])

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      finish()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      onCancel()
    }
  }

  return (
    <AutosizeInput
      ref={inputRef}
      value={value}
      placeholder={placeholder}
      minWidth={minWidth}
      extraWidth={extraWidth}
      onChange={(e) => setValue(e.target.value)}
      onBlur={finish}
      onKeyDown={handleKeyDown}
      inputClassName={inputClassName}
    />
  )
}
