// apps/web/src/components/mail/email-editor/recipient-input.tsx
'use client'
import { IdentifierType } from '@auxx/database/enums'
import type { RecordPickerItem } from '@auxx/lib/resources/client'
import { Badge } from '@auxx/ui/components/badge'
import { Popover, PopoverAnchor, PopoverContent } from '@auxx/ui/components/popover'
import { toastError } from '@auxx/ui/components/toast'
import { X } from 'lucide-react'
import type React from 'react'
import { forwardRef, useCallback, useImperativeHandle, useRef, useState } from 'react'
import { RecordPickerContent } from '~/components/pickers/record-picker/record-picker-content'

interface RecipientState {
  id: string
  identifier: string
  identifierType: IdentifierType
  name?: string | null
}

/** Imperative handle exposed via ref for parent components */
export interface RecipientInputHandle {
  /** Commits any valid email currently typed in the input. Returns true if committed. */
  commitPendingInput: () => boolean
}

interface RecipientInputProps {
  recipients: RecipientState[]
  onAdd: (recipient: RecipientState) => void
  onRemove: (id: string) => void
  onContactSelect: (contact: {
    id: string
    identifier: string
    identifierType: IdentifierType
    name?: string | null
  }) => void
  placeholder: string
  disabled?: boolean
}

export const RecipientInput = forwardRef<RecipientInputHandle, RecipientInputProps>(
  ({ recipients, onAdd, onRemove, onContactSelect, placeholder, disabled }, ref) => {
    const [inputValue, setInputValue] = useState('')
    const [highlightedIndex, setHighlightedIndex] = useState<number | null>(null)
    const [showPicker, setShowPicker] = useState(false)
    const inputRef = useRef<HTMLInputElement>(null)
    const pickerRef = useRef<HTMLDivElement>(null)

    const isValidEmail = (email: string) => /\S+@\S+\.\S+/.test(email.trim())

    /** Silently commits valid email input. No toast on invalid. Returns true if committed. */
    const tryCommitInput = (): boolean => {
      const emailCandidate = inputValue.trim()
      if (!emailCandidate || !isValidEmail(emailCandidate)) return false
      const dummyId = `temp_${Date.now()}_${emailCandidate}`
      onAdd({
        id: dummyId,
        identifier: emailCandidate.toLowerCase(),
        identifierType: IdentifierType.EMAIL,
        name: null,
      })
      setInputValue('')
      setHighlightedIndex(null)
      return true
    }

    /** Commits input with toast error for invalid emails (explicit user action: Enter, comma). */
    const addRecipientFromInput = () => {
      const emailCandidate = inputValue.trim()
      if (!isValidEmail(emailCandidate)) {
        toastError({ title: 'Invalid Email', description: 'Please enter a valid email address.' })
        return
      }
      tryCommitInput()
    }

    // Expose commitPendingInput for parent components (e.g. pre-send validation)
    useImperativeHandle(ref, () => ({
      commitPendingInput: () => tryCommitInput(),
    }))

    /** Handle contact selection from RecordPickerContent */
    const handleContactPick = useCallback(
      (item: RecordPickerItem) => {
        const email = (item.data?.email as string) || item.secondaryInfo
        if (!email) return

        onContactSelect({
          id: item.id,
          identifier: email,
          identifierType: IdentifierType.EMAIL,
          name: item.displayName || null,
        })
        setInputValue('')
        setShowPicker(false)
        inputRef.current?.focus()
      },
      [onContactSelect]
    )

    /** Forward a keyboard event to the cmdk Command inside the picker popover */
    const forwardToPicker = (e: React.KeyboardEvent<HTMLInputElement>) => {
      const cmdkRoot = pickerRef.current?.querySelector('[cmdk-root]')
      if (!cmdkRoot) return false
      // Dispatch a synthetic keyboard event on the cmdk root
      cmdkRoot.dispatchEvent(new KeyboardEvent('keydown', { key: e.key, bubbles: true }))
      e.preventDefault()
      return true
    }

    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
      switch (e.key) {
        case 'ArrowDown':
        case 'ArrowUp':
          // Forward arrow keys to the picker when open
          if (showPicker) {
            forwardToPicker(e)
          }
          break
        case 'Enter':
          // When picker is open, forward Enter to select the highlighted item
          if (showPicker && pickerRef.current?.querySelector('[cmdk-item][data-selected="true"]')) {
            forwardToPicker(e)
            break
          }
          // Otherwise commit free-text email
          if (inputValue.trim()) {
            e.preventDefault()
            addRecipientFromInput()
          }
          break
        case ',':
          if (inputValue.trim()) {
            e.preventDefault()
            addRecipientFromInput()
          }
          break
        case 'Tab':
          // Commit on Tab without preventing default (allow natural focus movement)
          if (inputValue.trim()) {
            tryCommitInput()
          }
          setShowPicker(false)
          break
        case 'Backspace':
          if (!inputValue && recipients.length > 0) {
            e.preventDefault()
            if (highlightedIndex === null) {
              setHighlightedIndex(recipients.length - 1)
            } else {
              onRemove(recipients[highlightedIndex].id)
              setHighlightedIndex(highlightedIndex > 0 ? highlightedIndex - 1 : null)
            }
          }
          break
        case 'Escape':
          setHighlightedIndex(null)
          setShowPicker(false)
          break
        default:
          break
      }
    }
    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      const val = e.target.value
      setInputValue(val)
      setHighlightedIndex(null)
      // Show picker when there's text to search
      setShowPicker(val.trim().length > 0)
    }
    // Handle keyboard events on badges for deletion
    const handleBadgeKeyDown = (
      e: React.KeyboardEvent<HTMLDivElement>,
      index: number,
      id: string
    ) => {
      if (e.key === 'Backspace' || e.key === 'Delete') {
        e.preventDefault()
        onRemove(id)
        setHighlightedIndex(null)
        inputRef.current?.focus()
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault()
        setHighlightedIndex(index > 0 ? index - 1 : null)
      } else if (e.key === 'ArrowRight') {
        e.preventDefault()
        setHighlightedIndex(index < recipients.length - 1 ? index + 1 : null)
      }
    }
    return (
      <div className='relative flex min-w-0 flex-1 flex-wrap items-center gap-1'>
        {recipients.map((person, index) => (
          <Badge
            key={person.id}
            variant='user'
            tabIndex={0}
            onFocus={() => setHighlightedIndex(index)}
            onBlur={() => setHighlightedIndex(null)}
            onKeyDown={(e) => handleBadgeKeyDown(e, index, person.id)}
            className={`${
              highlightedIndex === index
                ? 'border-transparent bg-info text-background dark:text-foreground ring-0  ring-info/90 focus:outline-hidden focus:ring-0'
                : ''
            }`}
            aria-selected={highlightedIndex === index}
            role='option'
            aria-label={`Recipient: ${person.name ?? person.identifier}`}>
            {person.name ?? person.identifier}
            <button
              type='button'
              disabled={disabled}
              onClick={() => {
                onRemove(person.id)
                setHighlightedIndex(null)
                inputRef.current?.focus()
              }}
              className='ml-1 cursor-pointer focus:outline-hidden'
              aria-label={`Remove ${person.name ?? person.identifier}`}>
              <X className='size-3' />
            </button>
          </Badge>
        ))}

        <Popover open={showPicker} onOpenChange={setShowPicker}>
          <PopoverAnchor asChild>
            <div className='relative grow'>
              <input
                ref={inputRef}
                type='text'
                value={inputValue}
                onChange={handleInputChange}
                onKeyDown={handleKeyDown}
                onFocus={() => {
                  if (inputValue.trim().length > 0) setShowPicker(true)
                }}
                onBlur={() => {
                  // Silently commit valid email on blur (no toast for invalid)
                  tryCommitInput()
                  // Delay closing to allow clicking picker items
                  setTimeout(() => setShowPicker(false), 200)
                }}
                placeholder={recipients.length === 0 ? placeholder : ''}
                className='w-full min-w-[120px] bg-transparent p-1 text-sm outline-hidden placeholder:text-muted-foreground/60'
                disabled={disabled}
                aria-label='Add recipient'
                autoComplete='off'
                autoCorrect='off'
                autoCapitalize='off'
                spellCheck={false}
                data-1p-ignore
                data-lpignore='true'
                data-form-type='other'
              />
            </div>
          </PopoverAnchor>
          <PopoverContent
            ref={pickerRef}
            className='w-72 p-0'
            align='start'
            side='bottom'
            sideOffset={5}
            onOpenAutoFocus={(e) => e.preventDefault()}
            onCloseAutoFocus={(e) => e.preventDefault()}>
            <RecordPickerContent
              value={[]}
              onChange={() => {}}
              entityDefinitionId='contact'
              multi={false}
              onSelectItem={handleContactPick}
              externalSearch={inputValue}
              placeholder='Search contacts...'
            />
          </PopoverContent>
        </Popover>
      </div>
    )
  }
)
