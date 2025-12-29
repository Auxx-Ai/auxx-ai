// src/components/mail/searchbar/search-input-with-highlighting.tsx
'use client'

import React, { useRef, useEffect, useState, useCallback } from 'react'
import { cn } from '@auxx/ui/lib/utils'
import { parseSearchQuery } from '@auxx/lib/mail-query'
import { Badge } from '@auxx/ui/components/badge'

interface SearchInputProps {
  value: string
  onChange: (value: string) => void
  onFocus?: () => void
  onBlur?: () => void
  onKeyDown?: (e: React.KeyboardEvent) => void
  placeholder?: string
  className?: string
  inputId?: string // ADD THIS
  onTagEditing?: (isEditing: boolean, operator?: string, value?: string) => void
  onSelectHighlightedSuggestion?: () => boolean // Returns true if a suggestion was selected
}

interface SearchTagProps {
  tagText: string
  onDelete: () => void
  onEdit: (newText: string) => void
  isHighlighted?: boolean
  isEditing?: boolean
  inputId?: string // ADD THIS
  onEditingChange?: (editing: boolean) => void
  onStartEditing?: (operator: string, currentValue: string) => void
  onStopEditing?: () => void
  onSelectHighlightedSuggestion?: () => boolean
}

function SearchTag({
  tagText,
  onDelete,
  onEdit,
  isHighlighted = false,
  isEditing = false,
  inputId,
  onEditingChange,
  onStartEditing,
  onStopEditing,
  onSelectHighlightedSuggestion,
}: SearchTagProps) {
  const editRef = useRef<HTMLSpanElement>(null)

  const colonIndex = tagText.indexOf(':')
  const operator = colonIndex > -1 ? tagText.substring(0, colonIndex + 1) : tagText
  const value = colonIndex > -1 ? tagText.substring(colonIndex + 1).trim() : ''

  useEffect(() => {
    if (isEditing && editRef.current) {
      editRef.current.focus()
      // Set cursor to end
      const range = document.createRange()
      const selection = window.getSelection()
      range.selectNodeContents(editRef.current)
      range.collapse(false)
      selection?.removeAllRanges()
      selection?.addRange(range)

      // Notify parent component about tag editing state
      const operatorName = operator.replace(':', '')
      onStartEditing?.(operatorName, value)
    } else if (!isEditing) {
      // Notify parent that we stopped editing
      onStopEditing?.()
    }
  }, [isEditing, operator, value, onStartEditing, onStopEditing])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      // Try to select highlighted suggestion first
      if (onSelectHighlightedSuggestion?.()) {
        e.preventDefault()
        onEditingChange?.(false)
        return
      }

      e.preventDefault()
      const newValue = editRef.current?.textContent || ''
      onEdit(operator + newValue)
      onEditingChange?.(false)

      // Focus the main input field at the end
      setTimeout(() => {
        const input = inputId
          ? document.getElementById(inputId)
          : document.querySelector('[role="textbox"]')
        if (input) {
          input.focus()
          // Set cursor to end
          const range = document.createRange()
          const selection = window.getSelection()
          range.selectNodeContents(input)
          range.collapse(false)
          selection?.removeAllRanges()
          selection?.addRange(range)
        }
      }, 0)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      onEditingChange?.(false)
    } else if (e.key === 'ArrowRight') {
      // Check if cursor is at the end
      const selection = window.getSelection()
      const range = selection?.getRangeAt(0)
      const textLength = editRef.current?.textContent?.length || 0

      if (range && range.startOffset === textLength) {
        e.preventDefault()
        // Save current value and move to input
        const newValue = editRef.current?.textContent || ''
        onEdit(operator + newValue)
        onEditingChange?.(false)

        // Focus the main input field
        setTimeout(() => {
          const input = document.querySelector('[role="textbox"]') as HTMLElement
          if (input) {
            input.focus()
            // Set cursor to beginning
            const range = document.createRange()
            const selection = window.getSelection()
            range.setStart(input, 0)
            range.setEnd(input, 0)
            selection?.removeAllRanges()
            selection?.addRange(range)
          }
        }, 0)
      }
    } else if (e.key === 'ArrowLeft') {
      // Check if cursor is at the beginning
      const selection = window.getSelection()
      const range = selection?.getRangeAt(0)

      if (range && range.startOffset === 0) {
        e.preventDefault()
        // Save current value and move to previous tag or input
        const newValue = editRef.current?.textContent || ''
        onEdit(operator + newValue)
        onEditingChange?.(false)

        // Focus the main input field
        setTimeout(() => {
          const input = document.querySelector('[role="textbox"]') as HTMLElement
          if (input) {
            input.focus()
            // Set cursor to end
            const range = document.createRange()
            const selection = window.getSelection()
            range.selectNodeContents(input)
            range.collapse(false)
            selection?.removeAllRanges()
            selection?.addRange(range)
          }
        }, 0)
      }
    }
  }

  const handleBlur = () => {
    const newValue = editRef.current?.textContent || ''
    onEditingChange?.(false)
    // Always save the current value, even if it's the same
    onEdit(operator + newValue)
  }

  if (isEditing) {
    return (
      <Badge
        variant="user"
        aria-selected={isHighlighted}
        className={cn(
          'px-2 pe-1 group shrink-0',
          // 'inline-flex items-center rounded-md px-1 text-sm mr-1 shrink-0',
          isHighlighted && 'bg-info text-white'
        )}>
        <span className="text-blue-600 font-medium group-aria-selected:text-white">
          {operator}&nbsp;
        </span>
        <span
          ref={editRef}
          contentEditable
          onKeyDown={handleKeyDown}
          onBlur={handleBlur}
          className="outline-none bg-transparent"
          suppressContentEditableWarning>
          {value}
        </span>
        <button
          onClick={onDelete}
          className="rounded-full size-4 flex items-center justify-center  text-blue-600 hover:text-blue-800 group-aria-selected:text-white hover:group-aria-selected:text-white"
          type="button">
          ×
        </button>
      </Badge>
    )
  }

  return (
    <Badge
      variant="user"
      aria-selected={isHighlighted}
      className={cn(
        'ps-2 pe-1 shrink-0 group',
        // 'inline-flex items-center rounded-md px-1 shrink-0 text-sm mr-1',
        isHighlighted && 'bg-info text-white'
      )}>
      <button
        onClick={() => {
          onEditingChange?.(true)
        }}
        className="text-left rounded tag-edit-button"
        type="button">
        <span className="text-blue-600 font-medium group-aria-selected:text-white">
          {operator}&nbsp;
        </span>
        {value && <span className=""> {value}</span>}
      </button>
      <button
        onClick={onDelete}
        className="rounded-full size-4 flex items-center justify-center text-blue-600 hover:text-blue-800 group-aria-selected:text-white hover:group-aria-selected:text-white"
        type="button">
        ×
      </button>
    </Badge>
  )
}

// Valid search operators
const VALID_OPERATORS = [
  'assignee',
  'author',
  'with',
  'subject',
  'body',
  'inbox',
  'type',
  'is',
  'tag',
  'has',
  'before',
  'after',
  'during',
  'from',
  'to',
  'cc',
  'bcc',
  'recipient',
  // 'content',
  // 'label',
  // 'status',
  // 'priority',
  // 'in',
  // 'date',
  // 'size',
  // 'attachment',
  // 'filename',
  // 'thread',
  // 'conversation',
  // 'participants',
  // 'without',
]

export function SearchInputWithHighlighting({
  value,
  onChange,
  onFocus,
  onBlur,
  onKeyDown,
  placeholder = 'Search...',
  className,
  inputId,
  onTagEditing,
  onSelectHighlightedSuggestion,
}: SearchInputProps) {
  const inputRef = useRef<HTMLSpanElement>(null)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const [isFocused, setIsFocused] = useState(false)
  const [currentTags, setCurrentTags] = useState<string[]>([])
  const [inputText, setInputText] = useState('')
  const [highlightedTagIndex, setHighlightedTagIndex] = useState<number | null>(null)
  const [editingTagIndex, setEditingTagIndex] = useState<number | null>(null)
  const [shouldFocusNewTag, setShouldFocusNewTag] = useState(false)

  // Effect to focus newly created tags
  useEffect(() => {
    if (shouldFocusNewTag && editingTagIndex !== null) {
      setShouldFocusNewTag(false)
    }
  }, [shouldFocusNewTag, editingTagIndex])

  // Handle tag editing callbacks
  const handleTagStartEditing = useCallback(
    (operator: string, currentValue: string) => {
      onTagEditing?.(true, operator, currentValue)
    },
    [onTagEditing]
  )

  const handleTagStopEditing = useCallback(() => {
    onTagEditing?.(false)
    setEditingTagIndex(null)
  }, [onTagEditing])

  const handleTagEditingChange = useCallback((index: number, editing: boolean) => {
    if (editing) {
      setEditingTagIndex(index)
    } else {
      setEditingTagIndex(null)
    }
  }, [])

  // Parse the search query to extract tags
  useEffect(() => {
    const parsed = parseSearchQuery(value)
    const tags: string[] = []
    let remaining = value

    parsed.tokens.forEach((token) => {
      if (token.operator) {
        // Only add if it's a valid operator
        const operatorName = token.operator.toLowerCase()
        if (VALID_OPERATORS.includes(operatorName)) {
          tags.push(token.raw)
          remaining = remaining.replace(token.raw, '').trim()
        }
      }
    })

    setCurrentTags(tags)
    setInputText(remaining)

    // Sync the input field content with the inputText state
    if (inputRef.current && inputRef.current.textContent !== remaining) {
      inputRef.current.textContent = remaining
    }
  }, [value])

  const focusInput = useCallback((moveCursorToEnd: boolean = true) => {
    if (inputRef.current) {
      inputRef.current.focus()
      if (moveCursorToEnd) {
        const range = document.createRange()
        const selection = window.getSelection()
        range.selectNodeContents(inputRef.current)
        range.collapse(false)
        selection?.removeAllRanges()
        selection?.addRange(range)
      }
    }
  }, [])

  const updateValue = useCallback(
    (tags: string[], text: string) => {
      const newValue = [...tags, text].filter(Boolean).join(' ').trim()
      onChange(newValue)
    },
    [onChange]
  )

  const handleInput = useCallback(
    (e: React.FormEvent<HTMLSpanElement>) => {
      const text = e.currentTarget.textContent || ''

      // Only clear highlighted tag when user actually types content (not when empty)
      if (text.length > 0) {
        setHighlightedTagIndex(null)
      }

      // Check for different operator patterns
      const operatorWithSpacePattern = /(\w+):\s/g
      const operatorWithValuePattern = /(\w+):(".*?"|\S+)\s/g // Handle quotes
      const justOperatorPattern = /^(\w+):$/

      // Helper to clean quoted values
      const clean = (s: string) => (s.startsWith('"') && s.endsWith('"') ? s.slice(1, -1) : s)

      let newText = text
      const newTags = [...currentTags]
      let foundMatch = false
      let match

      // Check for operator with value followed by space (highest priority)
      operatorWithValuePattern.lastIndex = 0
      while ((match = operatorWithValuePattern.exec(text)) !== null) {
        const fullMatch = match[0] // e.g., "assignee:john "
        const operator = match[1] // e.g., "assignee"
        const value = match[2] // e.g., "john"

        // Only process if it's a valid operator
        if (VALID_OPERATORS.includes(operator.toLowerCase())) {
          newTags.push(`${operator}:${clean(value)}`)
          newText = newText.replace(fullMatch, '').trim()
          foundMatch = true
        }
      }

      // Check for operator with space (if no value pattern found)
      if (!foundMatch) {
        operatorWithSpacePattern.lastIndex = 0
        while ((match = operatorWithSpacePattern.exec(text)) !== null) {
          const fullMatch = match[0] // e.g., "assignee: "
          const operator = match[1] // e.g., "assignee"

          // Only process if it's a valid operator
          if (VALID_OPERATORS.includes(operator.toLowerCase())) {
            newTags.push(`${operator}:`)
            newText = newText.replace(fullMatch, '').trim()
            foundMatch = true
          }
        }
      }

      // Check for just operator at end (like "assignee:")
      if (!foundMatch && justOperatorPattern.test(text)) {
        const match = text.match(justOperatorPattern)
        if (match) {
          const operator = match[1]

          // Only process if it's a valid operator
          if (VALID_OPERATORS.includes(operator.toLowerCase())) {
            newTags.push(`${operator}:`)
            newText = ''
            foundMatch = true
          }
        }
      }

      if (foundMatch) {
        const newTagIndex = newTags.length - 1

        // Update all state at once
        setCurrentTags(newTags)
        setInputText('')
        updateValue(newTags, newText)

        // Clear input completely
        if (inputRef.current) {
          inputRef.current.textContent = ''
          inputRef.current.innerHTML = ''
        }

        // Delay setting the editing index to ensure DOM has updated
        requestAnimationFrame(() => {
          setEditingTagIndex(newTagIndex)
          setShouldFocusNewTag(true)
        })
      } else {
        setInputText(text)
        updateValue(currentTags, text)
      }
    },
    [currentTags, updateValue, focusInput]
  )

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLSpanElement>) => {
      if (e.key === 'Enter') {
        const text = e.currentTarget.textContent || ''

        // Check if text is a valid operator (with or without colon)
        const operatorWithValueMatch = text.match(/(\w+):(".*?"|\S+)$/)
        const justOperatorMatch = text.match(/^(\w+):?$/) // operator or operator:

        if (operatorWithValueMatch) {
          // Has operator with value - create complete tag
          const [, operator, value] = operatorWithValueMatch
          if (VALID_OPERATORS.includes(operator.toLowerCase())) {
            e.preventDefault()
            const clean = (s: string) => (s.startsWith('"') && s.endsWith('"') ? s.slice(1, -1) : s)
            const newTags = [...currentTags, `${operator}:${clean(value)}`]
            setCurrentTags(newTags)
            setInputText('')
            updateValue(newTags, '')

            setTimeout(() => {
              if (inputRef.current) {
                inputRef.current.textContent = ''
                focusInput()
              }
            }, 0)
            return // Don't call parent's onKeyDown
          }
        } else if (justOperatorMatch) {
          // Just operator name - create tag and focus inside it
          const operator = justOperatorMatch[1]
          if (VALID_OPERATORS.includes(operator.toLowerCase())) {
            e.preventDefault()
            const newTags = [...currentTags, `${operator}:`]
            const newTagIndex = newTags.length - 1

            // Update all state at once
            setCurrentTags(newTags)
            setInputText('')
            updateValue(newTags, '')

            // Clear input first
            if (inputRef.current) {
              inputRef.current.textContent = ''
            }

            // Delay setting the editing index to ensure DOM has updated
            requestAnimationFrame(() => {
              setEditingTagIndex(newTagIndex)
              setShouldFocusNewTag(true)
            })
            return // Don't call parent's onKeyDown
          }
        }

        // If we get here, it's not an operator pattern, so let parent handle Enter key
        // Don't preventDefault() here - let parent handle it
      } else if (e.key === 'Backspace' && inputText === '' && currentTags.length > 0) {
        e.preventDefault()

        const lastTagIndex = currentTags.length - 1

        if (highlightedTagIndex === lastTagIndex) {
          // Second backspace: delete the highlighted tag
          const newTags = currentTags.slice(0, -1)
          setCurrentTags(newTags)
          setHighlightedTagIndex(null)
          updateValue(newTags, '')
        } else {
          // First backspace: highlight the last tag
          setHighlightedTagIndex(lastTagIndex)
        }
      } else if (e.key === 'ArrowLeft' && currentTags.length > 0) {
        // Check if cursor is at the beginning
        const selection = window.getSelection()
        const range = selection?.getRangeAt(0)

        if (range && range.startOffset === 0) {
          e.preventDefault()
          // Move to the last tag for editing
          const tagEditButtons = wrapperRef.current?.querySelectorAll('.tag-edit-button')
          if (tagEditButtons && tagEditButtons.length > 0) {
            const lastTag = tagEditButtons[tagEditButtons.length - 1] as HTMLElement
            lastTag.click() // This will trigger editing mode
          }
        }
      }

      onKeyDown?.(e)
    },
    [inputText, currentTags, updateValue, focusInput, onKeyDown]
  )

  const handleFocus = useCallback(() => {
    setIsFocused(true)
    onFocus?.()
  }, [onFocus])

  const handleBlur = useCallback(() => {
    setIsFocused(false)
    onBlur?.()
  }, [onBlur])

  const deleteTag = useCallback(
    (index: number) => {
      const newTags = currentTags.filter((_, i) => i !== index)
      setCurrentTags(newTags)
      setHighlightedTagIndex(null) // Clear highlight when deleting
      updateValue(newTags, inputText)
      focusInput()
    },
    [currentTags, inputText, updateValue, focusInput]
  )

  const editTag = useCallback(
    (index: number, newText: string) => {
      const newTags = [...currentTags]
      newTags[index] = newText
      setCurrentTags(newTags)
      setHighlightedTagIndex(null) // Clear highlight when editing
      setEditingTagIndex(null) // Clear editing state
      updateValue(newTags, inputText)
      // Don't automatically focus input - let user decide where to go next
    },
    [currentTags, inputText, updateValue]
  )

  const handleWrapperClick = useCallback(
    (e: React.MouseEvent) => {
      // Only focus input if clicking on the wrapper itself, not on tags or buttons
      if (e.target === e.currentTarget) {
        setHighlightedTagIndex(null) // Clear highlight when clicking
        setEditingTagIndex(null) // Stop editing any tags
        focusInput(false) // Don't move cursor to end when clicking wrapper
      }
    },
    [focusInput]
  )

  return (
    <div className="relative flex-1 w-full">
      <div
        ref={wrapperRef}
        onClick={handleWrapperClick}
        className={cn(
          'flex items-center gap-1 flex-1 py-1',
          'border-0 bg-transparent cursor-text whitespace-nowrap overflow-x-auto no-scrollbar',
          className
        )}>
        {/* Render tags */}
        {currentTags.map((tag, index) => {
          // Generate a stable key based on content and position
          const tagKey = `${index}-${tag}`
          return (
            <SearchTag
              key={tagKey}
              tagText={tag}
              onDelete={() => deleteTag(index)}
              onEdit={(newText) => editTag(index, newText)}
              isHighlighted={highlightedTagIndex === index}
              isEditing={editingTagIndex === index}
              inputId={inputId}
              onEditingChange={(editing) => handleTagEditingChange(index, editing)}
              onStartEditing={handleTagStartEditing}
              onStopEditing={handleTagStopEditing}
              onSelectHighlightedSuggestion={onSelectHighlightedSuggestion}
            />
          )
        })}

        {/* Input field */}
        <span
          id={inputId}
          ref={inputRef}
          contentEditable
          onInput={handleInput}
          onKeyDown={handleKeyDown}
          onFocus={handleFocus}
          onBlur={handleBlur}
          className="outline-none bg-transparent flex-1 min-w-[100px] text-sm"
          role="textbox"
          aria-label="Search input"
          spellCheck="false"
          suppressContentEditableWarning
        />

        {/* Placeholder */}
        {currentTags.length === 0 && !inputText && (
          <span className="absolute left-0 text-muted-foreground text-sm pointer-events-none">
            {placeholder}
          </span>
        )}
      </div>
    </div>
  )
}
