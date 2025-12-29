'use client'
import React, { useState, useRef } from 'react'
import { Badge } from '@auxx/ui/components/badge'
import { toastError } from '@auxx/ui/components/toast'
import { X, Loader2 } from 'lucide-react' // Cleaned up icons
// --- Editor Imports ---
import { api, type RouterOutputs } from '~/trpc/react'
import { keepPreviousData } from '@tanstack/react-query'
import { useDebouncedValue } from '~/hooks/use-debounced-value'
import { IdentifierType } from '@auxx/database/enums'
interface RecipientState {
  id: string
  identifier: string
  identifierType: IdentifierType
  name?: string | null
}
// --- Recipient Input Component ---
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
export const RecipientInput: React.FC<RecipientInputProps> = ({
  recipients,
  onAdd,
  onRemove,
  onContactSelect,
  placeholder,
  disabled,
}) => {
  const [inputValue, setInputValue] = useState('')
  const [highlightedIndex, setHighlightedIndex] = useState<number | null>(null)
  const [isFocused, setIsFocused] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  // Debounce the inputValue to avoid searching on every keystroke
  const [debouncedInputValue, cancel] = useDebouncedValue(inputValue, 500)
  const { data: contactsResult, isLoading } = api.contact.getAll.useQuery(
    { limit: 5, search: debouncedInputValue, status: 'ACTIVE' },
    { enabled: isFocused && debouncedInputValue.length > 0, placeholderData: keepPreviousData }
  )
  const contacts = contactsResult?.items || []
  const isValidEmail = (email: string) => /\S+@\S+\.\S+/.test(email.trim())
  const addRecipientFromInput = () => {
    const emailCandidate = inputValue.trim()
    if (!isValidEmail(emailCandidate)) {
      toastError({ title: 'Invalid Email', description: 'Please enter a valid email address.' })
      return
    }
    const dummyId = `temp_${Date.now()}_${emailCandidate}`
    onAdd({
      id: dummyId,
      identifier: emailCandidate.toLowerCase(),
      identifierType: IdentifierType.EMAIL,
      name: null,
    })
    setInputValue('')
    setHighlightedIndex(null)
  }
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    switch (e.key) {
      case 'Enter':
      case ',':
        if (inputValue.trim()) {
          e.preventDefault()
          addRecipientFromInput()
        }
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
        break
      default:
        break
    }
  }
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setInputValue(e.target.value)
    setHighlightedIndex(null)
  }
  const handleSelectContact = (contact: any) => {
    onContactSelect({
      id: contact.id,
      identifier: contact.email || contact.emails[0],
      identifierType: IdentifierType.EMAIL,
      name:
        contact.firstName && contact.lastName
          ? `${contact.firstName} ${contact.lastName}`
          : contact.firstName || null,
    })
    setInputValue('')
    setHighlightedIndex(null)
    inputRef.current?.focus()
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
      // Focus input after removal
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
    <div className="relative flex min-w-0 flex-1 flex-wrap items-center gap-1">
      {recipients.map((person, index) => (
        <Badge
          key={person.id}
          variant="user"
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
          role="option"
          aria-label={`Recipient: ${person.name ?? person.identifier}`}>
          {person.name ?? person.identifier}
          <button
            type="button"
            disabled={disabled}
            onClick={() => {
              onRemove(person.id)
              setHighlightedIndex(null)
              inputRef.current?.focus()
            }}
            className="ml-1 cursor-pointer focus:outline-hidden"
            aria-label={`Remove ${person.name ?? person.identifier}`}>
            <X className="size-3" />
          </button>
        </Badge>
      ))}

      <div className="relative grow">
        <input
          ref={inputRef}
          type="email"
          value={inputValue}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          onFocus={() => setIsFocused(true)}
          onBlur={() => {
            setTimeout(() => setIsFocused(false), 150)
          }}
          placeholder={recipients.length === 0 ? placeholder : ''}
          className="w-full min-w-[120px] bg-transparent p-1 text-sm outline-hidden placeholder:text-muted-foreground/60"
          disabled={disabled}
          aria-label="Add recipient"
          autoComplete="off"
        />

        {isFocused && inputValue && contacts.length > 0 && (
          <div className="absolute left-0 top-full z-50 mt-1 w-full max-w-[300px] rounded-md border border-border bg-background shadow-md">
            <ul className="max-h-[200px] overflow-y-auto py-1" role="listbox">
              {contacts.map((contact) => {
                const displayName =
                  contact.firstName && contact.lastName
                    ? `${contact.firstName} ${contact.lastName}`
                    : contact.firstName || 'No name'
                const email = contact.email || contact.emails[0]
                const avatarLetter = contact.firstName
                  ? contact.firstName.charAt(0).toUpperCase()
                  : email.charAt(0).toUpperCase()
                return (
                  <li
                    key={contact.id}
                    className="flex cursor-pointer items-center gap-2 px-3 py-2 text-xs hover:bg-accent"
                    onClick={() => handleSelectContact(contact)}
                    role="option"
                    tabIndex={-1}>
                    <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-medium">
                      {avatarLetter}
                    </div>
                    <div className="flex flex-col">
                      <span className="font-medium">{displayName}</span>
                      <span className="truncate text-xs text-muted-foreground" title={email}>
                        {email}
                      </span>
                    </div>
                  </li>
                )
              })}
            </ul>
          </div>
        )}

        {isLoading && inputValue && (
          <div className="absolute right-2 top-1/2 -translate-y-1/2">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          </div>
        )}
      </div>
    </div>
  )
}
