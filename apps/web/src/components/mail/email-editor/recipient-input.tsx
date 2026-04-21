// apps/web/src/components/mail/email-editor/recipient-input.tsx
'use client'
import { IdentifierType } from '@auxx/database/enums'
import type { RecordId, RecordPickerItem } from '@auxx/lib/resources/client'
import { AutosizeInput, type AutosizeInputRef } from '@auxx/ui/components/autosize-input'
import { Badge } from '@auxx/ui/components/badge'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@auxx/ui/components/dropdown-menu'
import { Popover, PopoverAnchor, PopoverContent } from '@auxx/ui/components/popover'
import { toastError } from '@auxx/ui/components/toast'
import { cn } from '@auxx/ui/lib/utils'
import { Copy, Mail, X } from 'lucide-react'
import type React from 'react'
import { useCallback, useImperativeHandle, useMemo, useRef, useState } from 'react'
import { Tooltip } from '~/components/global/tooltip'
import { RecordPickerContent } from '~/components/pickers/record-picker/record-picker-content'
import { useEditorActiveStateContext } from './editor-active-state-context'

export type RecipientField = 'TO' | 'CC' | 'BCC'

interface RecipientState {
  id: string
  /** Set when this recipient came from the contact picker — used to exclude the
   *  contact from future picker results. */
  recordId?: RecordId
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
  ref?: React.Ref<RecipientInputHandle>
  recipients: RecipientState[]
  field: RecipientField
  onAdd: (recipient: RecipientState) => void
  onRemove: (id: string) => void
  onMoveTo: (id: string, target: RecipientField) => void
  onContactSelect: (contact: {
    id: string
    recordId?: RecordId
    identifier: string
    identifierType: IdentifierType
    name?: string | null
  }) => void
  placeholder: string
  disabled?: boolean
  /** className forwarded to popover/dropdown content (e.g. for z-index override) */
  popoverClassName?: string
}

const FIELD_LABELS: Record<RecipientField, string> = { TO: 'To', CC: 'Cc', BCC: 'Bcc' }
const ALL_FIELDS: RecipientField[] = ['TO', 'CC', 'BCC']

function RecipientBadge({
  person,
  index,
  highlightedIndex,
  disabled,
  field,
  onRemove,
  onMoveTo,
  onFocus,
  onBlur,
  onKeyDown,
  inputRef,
  popoverClassName,
}: {
  person: RecipientState
  index: number
  highlightedIndex: number | null
  disabled?: boolean
  field: RecipientField
  onRemove: (id: string) => void
  onMoveTo: (id: string, target: RecipientField) => void
  onFocus: () => void
  onBlur: () => void
  onKeyDown: (e: React.KeyboardEvent<HTMLDivElement>) => void
  inputRef: React.RefObject<AutosizeInputRef | null>
  popoverClassName?: string
}) {
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const activeState = useEditorActiveStateContext()
  const dropdownId = `recipient-badge-${person.id}`
  const displayName = person.name ?? person.identifier
  const isHighlighted = highlightedIndex === index

  return (
    <DropdownMenu
      open={dropdownOpen}
      onOpenChange={(open) => {
        setDropdownOpen(open)
        if (open) {
          onFocus()
          activeState.trackPopoverOpen(dropdownId)
        } else {
          activeState.trackPopoverClose(dropdownId)
        }
      }}>
      <Tooltip content={person.identifier} allowInteraction>
        <DropdownMenuTrigger asChild>
          <Badge
            variant='user'
            tabIndex={0}
            onFocus={onFocus}
            onBlur={() => {
              if (!dropdownOpen) onBlur()
            }}
            onKeyDown={(e) => {
              e.stopPropagation()
              onKeyDown(e)
            }}
            className={`cursor-pointer ${
              isHighlighted
                ? 'border-transparent bg-info text-background dark:text-foreground ring-0  ring-info/90 focus:outline-hidden focus:ring-0'
                : ''
            }`}
            aria-selected={isHighlighted}
            role='option'
            aria-label={`Recipient: ${displayName}`}>
            {displayName}
            <button
              type='button'
              disabled={disabled}
              onPointerDown={(e) => {
                e.stopPropagation()
              }}
              onClick={(e) => {
                e.stopPropagation()
                onRemove(person.id)
                inputRef.current?.focus()
              }}
              className='ml-1 cursor-pointer focus:outline-hidden'
              aria-label={`Remove ${displayName}`}>
              <X className='size-3' />
            </button>
          </Badge>
        </DropdownMenuTrigger>
      </Tooltip>
      <DropdownMenuContent align='start' sideOffset={5} className={popoverClassName}>
        <DropdownMenuItem onSelect={() => navigator.clipboard.writeText(person.identifier)}>
          <Copy />
          Copy '{person.identifier}'
        </DropdownMenuItem>
        {person.name && (
          <DropdownMenuItem onSelect={() => navigator.clipboard.writeText(person.name!)}>
            <Copy />
            Copy '{person.name}'
          </DropdownMenuItem>
        )}
        {ALL_FIELDS.filter((f) => f !== field).map((target) => (
          <DropdownMenuItem key={target} onSelect={() => onMoveTo(person.id, target)}>
            <Mail />
            Move to {FIELD_LABELS[target]}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function RecipientInput({
  ref,
  recipients,
  field,
  onAdd,
  onRemove,
  onMoveTo,
  onContactSelect,
  placeholder,
  disabled,
  popoverClassName,
}: RecipientInputProps) {
  const [inputValue, setInputValue] = useState('')
  const [highlightedIndex, setHighlightedIndex] = useState<number | null>(null)
  const [showPicker, setShowPicker] = useState(false)
  const inputRef = useRef<AutosizeInputRef>(null)
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
        recordId: item.recordId,
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

  // RecordIds of contacts already in this field — passed to the picker to
  // hide them from the suggestions list.
  const excludeRecordIds = useMemo(
    () => recipients.map((r) => r.recordId).filter((id): id is RecordId => !!id),
    [recipients]
  )
  console.log('[RecipientInput] excludeRecordIds', {
    field,
    recipients: recipients.map((r) => ({
      id: r.id,
      recordId: r.recordId,
      identifier: r.identifier,
    })),
    excludeRecordIds,
  })

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
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
    }
  }
  // Route clicks on empty "dead zone" space (flex gap, right-of-input area)
  // to the input. Guarded by target === currentTarget so clicks on badges,
  // remove buttons, or the input itself are left untouched.
  const routeFocusToInput: React.MouseEventHandler<HTMLDivElement> = (e) => {
    if (e.target !== e.currentTarget) return
    e.preventDefault()
    inputRef.current?.focus()
  }
  return (
    <div
      data-recipient-row
      className='relative flex min-w-0 flex-1 flex-wrap items-center gap-1 cursor-text'
      onMouseDown={routeFocusToInput}>
      {recipients.map((person, index) => (
        <RecipientBadge
          key={person.id}
          person={person}
          index={index}
          highlightedIndex={highlightedIndex}
          disabled={disabled}
          field={field}
          onRemove={(id) => {
            onRemove(id)
            setHighlightedIndex(null)
          }}
          onMoveTo={onMoveTo}
          onFocus={() => setHighlightedIndex(index)}
          onBlur={() => setHighlightedIndex(null)}
          onKeyDown={(e) => handleBadgeKeyDown(e, index, person.id)}
          inputRef={inputRef}
          popoverClassName={popoverClassName}
        />
      ))}

      <Popover open={showPicker} onOpenChange={setShowPicker}>
        <PopoverAnchor asChild>
          <div className='relative grow cursor-text' onMouseDown={routeFocusToInput}>
            <AutosizeInput
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
              minWidth={30}
              inputClassName='bg-transparent p-1 text-sm outline-hidden placeholder:text-muted-foreground/60'
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
          className={cn('w-72 p-0', popoverClassName)}
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
            excludeIds={excludeRecordIds}
            placeholder='Search contacts...'
          />
        </PopoverContent>
      </Popover>
    </div>
  )
}
