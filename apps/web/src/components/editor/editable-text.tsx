import { cn } from '@auxx/ui/lib/utils' // Assuming this utility exists for class names
import type React from 'react'
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { sanitizeSimple } from '~/lib/sanitize'

export type EditableTextSaveReason = 'enter' | 'blur'

export interface EditableTextHandle {
  enterEdit: () => void
}

interface EditableTextProps {
  initialText: string
  onSave?: (text: string, meta: { reason: EditableTextSaveReason }) => void
  className?: string
  placeholder?: string
  /** The CSS color class for the placeholder text (e.g., 'text-gray-500') */
  placeholderColor?: string // New prop for placeholder color
  maxWidth?: string
  containerClassName?: string
}

export const EditableText = forwardRef<EditableTextHandle, EditableTextProps>(function EditableText(
  {
    initialText,
    onSave,
    className = '',
    placeholder = 'Click to edit...',
    placeholderColor = 'text-gray-500', // Default placeholder color
    maxWidth = '100%',
    containerClassName = '',
  },
  ref
) {
  const [isEditing, setIsEditing] = useState(false)
  const [text, setText] = useState(initialText)
  const editableRef = useRef<HTMLDivElement>(null)
  const textRef = useRef<HTMLDivElement>(null)
  const [minWidth, setMinWidth] = useState<number | undefined>(undefined)

  // Update text state when initialText prop changes
  useEffect(() => {
    setText(initialText)
  }, [initialText])

  // Save the width of the text element (or placeholder) before switching to edit mode
  // biome-ignore lint/correctness/useExhaustiveDependencies: text and placeholder trigger width recalculation when content changes
  useEffect(() => {
    if (textRef.current && !minWidth) {
      // Calculate width based on what's visible (text or placeholder)
      setMinWidth(textRef.current.offsetWidth)
    }
    // Recalculate if text changes from empty to non-empty or vice-versa while not editing
    // This helps if initialText changes dynamically.
    if (textRef.current && !isEditing) {
      setMinWidth(textRef.current.offsetWidth)
    }
  }, [minWidth, text, placeholder, isEditing]) // Added dependencies

  // Focus editable div when switching to edit mode
  useEffect(() => {
    if (isEditing && editableRef.current) {
      editableRef.current.focus()

      // Place cursor at the end of text
      const range = document.createRange()
      const selection = window.getSelection()
      // Use the actual current text content for positioning, not placeholder
      range.selectNodeContents(editableRef.current)
      range.collapse(false) // false means collapse to end
      selection?.removeAllRanges()
      selection?.addRange(range)
    }
  }, [isEditing]) // Dependency remains the same

  const handleClick = () => {
    // Update width just before switching to editing mode
    if (textRef.current) {
      setMinWidth(textRef.current.offsetWidth)
    }
    setIsEditing(true)
    // No need to explicitly clear placeholder here,
    // the editing view will only render the 'text' state.
  }

  useImperativeHandle(ref, () => ({
    enterEdit: () => {
      if (textRef.current) {
        setMinWidth(textRef.current.offsetWidth)
      }
      setIsEditing(true)
    },
  }))

  const handleBlur = () => {
    finishEditing('blur')
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault() // Prevent adding a new line
      finishEditing('enter')
    } else if (e.key === 'Escape') {
      // Revert to the original text before editing started
      // If editing started from placeholder, original was ''
      // We need to reset based on initialText prop if escape is hit
      setIsEditing(false) // Exit editing first
      setText(initialText) // Then reset text state
    }
  }

  const finishEditing = (reason: EditableTextSaveReason) => {
    if (editableRef.current) {
      // Use innerText which represents rendered text, trim whitespace
      const newText = editableRef.current.innerText.trim()
      setText(newText) // Update state with the potentially empty or new text
      setIsEditing(false)
      if (onSave) {
        onSave(newText, { reason })
      }
      // If text is now empty, the placeholder will show again in the display view
    } else {
      // Fallback if ref is somehow null
      setIsEditing(false)
    }
  }

  // Determine if the placeholder should be shown in the display view
  const showPlaceholder = !text && placeholder

  return (
    <div className={cn('relative inline-block', containerClassName)}>
      {isEditing ? (
        <div
          ref={editableRef}
          contentEditable
          onBlur={handleBlur}
          onKeyDown={handleKeyDown}
          className={cn(
            'whitespace-pre-wrap break-words rounded-2xl border border-blue-400 px-2 py-1 focus:outline-hidden focus:ring-2 focus:ring-blue-500',
            className // Apply user-provided class names here too
          )}
          style={{
            // Ensure minimum width is maintained, even if empty
            minWidth: minWidth ? `${minWidth}px` : 'auto',
            maxWidth: maxWidth,
          }}
          suppressContentEditableWarning={true}
          // Render only the actual text state. If it was empty when clicked,
          // this div will be empty, allowing the user to type directly.
          dangerouslySetInnerHTML={{ __html: sanitizeSimple(text) }}>
          {/* Content is set via dangerouslySetInnerHTML */}
        </div>
      ) : (
        <div
          ref={textRef}
          onClick={handleClick}
          className={cn(
            `cursor-pointer whitespace-pre-wrap break-words rounded-2xl border border-transparent px-2 py-1 hover:border-gray-300 hover:dark:border-primary-300`,
            className, // Apply user-provided class names
            // Apply placeholderColor class only when placeholder is shown
            showPlaceholder && placeholderColor
          )}
          style={{ maxWidth: maxWidth }}
          // Set a title attribute for accessibility/tooltip, especially useful for truncated text
          title={text || placeholder}>
          {/* Display placeholder if text is empty, otherwise display text */}
          {showPlaceholder ? placeholder : text}
        </div>
      )}
    </div>
  )
})
