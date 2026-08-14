// apps/web/src/components/mail/email-editor/recipient-input.tsx
'use client'
import { IdentifierType } from '@auxx/database/enums'
import type { FieldType, IdentifierType as IdentifierTypeType } from '@auxx/database/types'
import { extractValues } from '@auxx/lib/field-values/client'
import { getDefinitionId, type RecordPickerItem } from '@auxx/lib/resources/client'
import type { TypedFieldValue } from '@auxx/types/field-value'
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
import { useResourceStore } from '~/components/resources/store/resource-store'
import { getNormalizedRecordId } from '~/components/resources/utils/normalize-record-id'
import { resolveSystemAttributeRef } from '~/components/resources/utils/resolve-system-attribute'
import { api } from '~/trpc/react'
import { toEmailAddressList } from '../email-address-list'
import { useEditorActiveStateContext } from './editor-active-state-context'

export type RecipientField = 'TO' | 'CC' | 'BCC'

interface RecipientState {
  id: string
  identifier: string
  identifierType: IdentifierTypeType
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
    identifier: string
    identifierType: IdentifierTypeType
    name?: string | null
  }) => void
  placeholder: string
  disabled?: boolean
  /** className forwarded to popover/dropdown content (e.g. for z-index override) */
  popoverClassName?: string
}

const FIELD_LABELS: Record<RecipientField, string> = { TO: 'To', CC: 'Cc', BCC: 'Bcc' }
const ALL_FIELDS: RecipientField[] = ['TO', 'CC', 'BCC']

/** The picker row's own single known address (the primary) — the fallback
 *  when the field read fails or returns nothing. */
function itemFallbackAddresses(item: RecordPickerItem): string[] {
  const single = toEmailAddressList(item.data?.email)[0] ?? (item.secondaryInfo || undefined)
  return single ? [single] : []
}

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
  // A picked contact with more than one not-yet-added address: the popover
  // swaps to one row per address so the user picks WHICH one to add.
  const [pendingContact, setPendingContact] = useState<{
    id: string
    name: string | null
    addresses: string[]
  } | null>(null)
  // Full address lists prefetched for visible search results (and fetched on
  // pick as a fallback), keyed by contact instance id. Feeds the per-address
  // exclude: a contact stays pickable until ALL its known addresses are
  // recipients.
  const [contactAddresses, setContactAddresses] = useState<Map<string, string[]>>(new Map())
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

  const batchGetAsync = api.fieldValue.batchGet.useMutation().mutateAsync
  // Instance ids a fetch was already issued for — dedupes the prefetch across
  // result batches (state alone lags in-flight requests).
  const requestedAddressIdsRef = useRef<Set<string>>(new Set())

  /**
   * Fetch the FULL email list for each contact (multi-value `primary_email`
   * reads back as one row per address, primary first) in one batch read.
   * Falls back per item to its own row data when the field ref can't resolve
   * or the read fails.
   */
  const fetchContactAddresses = useCallback(
    async (items: RecordPickerItem[]): Promise<Map<string, string[]>> => {
      const result = new Map<string, string[]>()
      const fallbackAll = () => {
        for (const item of items) result.set(item.id, itemFallbackAddresses(item))
        return result
      }
      try {
        const normalizedToItem = new Map(
          items.map((item) => [getNormalizedRecordId(item.recordId), item] as const)
        )
        const { systemAttributeMap, systemAttributeByDef, ambiguousSystemAttributes } =
          useResourceStore.getState()
        const [firstRecordId] = normalizedToItem.keys()
        const ref = firstRecordId
          ? resolveSystemAttributeRef(
              { systemAttributeMap, systemAttributeByDef, ambiguousSystemAttributes },
              'primary_email',
              getDefinitionId(firstRecordId)
            )
          : undefined
        if (!ref) return fallbackAll()
        const batch = await batchGetAsync({
          recordIds: [...normalizedToItem.keys()],
          fieldReferences: [ref],
        })
        for (const row of batch.values) {
          const item = normalizedToItem.get(row.recordId)
          if (!item) continue
          const addresses = extractValues(
            row.value as TypedFieldValue | TypedFieldValue[] | null,
            row.fieldType as FieldType
          ).filter((v): v is string => typeof v === 'string' && v.length > 0)
          result.set(item.id, addresses.length > 0 ? addresses : itemFallbackAddresses(item))
        }
        for (const item of items) {
          if (!result.has(item.id)) result.set(item.id, itemFallbackAddresses(item))
        }
        return result
      } catch {
        return fallbackAll()
      }
    },
    [batchGetAsync]
  )

  /**
   * Prefetch address lists for the visible search results so the exclude
   * filter can key on ADDRESSES (a contact hides only when every address is a
   * recipient) and a pick can expand without waiting.
   */
  const handlePickerResults = useCallback(
    (items: RecordPickerItem[]) => {
      const missing = items.filter((item) => !requestedAddressIdsRef.current.has(item.id))
      if (missing.length === 0) return
      for (const item of missing) requestedAddressIdsRef.current.add(item.id)
      void fetchContactAddresses(missing).then((fetched) => {
        setContactAddresses((prev) => {
          const next = new Map(prev)
          for (const [id, addresses] of fetched) next.set(id, addresses)
          return next
        })
      })
    },
    [fetchContactAddresses]
  )

  // Lowercased emails of recipients already in this field — used to hide their
  // matching contacts from the picker. Covers picker/draft/reply/free-typed alike.
  const excludeEmails = useMemo(
    () => new Set(recipients.map((r) => r.identifier.toLowerCase())),
    [recipients]
  )

  /** Commit one address as a recipient and reset the picker state. */
  const commitContactAddress = useCallback(
    (contactId: string, email: string, name: string | null) => {
      onContactSelect({
        id: contactId,
        identifier: email,
        identifierType: IdentifierType.EMAIL,
        name,
      })
      setInputValue('')
      setShowPicker(false)
      setPendingContact(null)
      inputRef.current?.focus()
    },
    [onContactSelect]
  )

  /**
   * Handle contact selection from RecordPickerContent. A picked contact is
   * expanded into its N addresses: exactly one address not yet a recipient
   * commits directly; several swap the popover to a per-address row list.
   */
  const handleContactPick = useCallback(
    async (item: RecordPickerItem) => {
      const name = item.displayName || null
      let addresses = contactAddresses.get(item.id)
      if (!addresses) {
        // Prefetch hasn't landed for this row yet — fetch it alone.
        requestedAddressIdsRef.current.add(item.id)
        const fetched = await fetchContactAddresses([item])
        addresses = fetched.get(item.id) ?? []
        const known = addresses
        setContactAddresses((prev) => new Map(prev).set(item.id, known))
      }
      const candidates = addresses.filter((a) => !excludeEmails.has(a.toLowerCase()))
      if (candidates.length === 0) return
      if (candidates.length === 1) {
        commitContactAddress(item.id, candidates[0]!, name)
        return
      }
      setPendingContact({ id: item.id, name, addresses: candidates })
    },
    [contactAddresses, fetchContactAddresses, excludeEmails, commitContactAddress]
  )

  const excludeFilter = useCallback(
    (item: RecordPickerItem) => {
      // Per-address exclude: once the contact's full list is known (results
      // prefetch), the contact hides only when EVERY address is a recipient.
      const known = contactAddresses.get(item.id)
      if (known && known.length > 0) {
        return known.every((a) => excludeEmails.has(a.toLowerCase()))
      }
      // Unfetched: the only known address is the primary (`secondaryInfo`).
      const email = item.secondaryInfo?.toLowerCase()
      return !!email && excludeEmails.has(email)
    },
    [contactAddresses, excludeEmails]
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
            const highlighted = recipients[highlightedIndex]
            if (highlighted) onRemove(highlighted.id)
            setHighlightedIndex(highlightedIndex > 0 ? highlightedIndex - 1 : null)
          }
        }
        break
      case 'Escape':
        setHighlightedIndex(null)
        setShowPicker(false)
        setPendingContact(null)
        break
      default:
        break
    }
  }
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value
    setInputValue(val)
    setHighlightedIndex(null)
    // Typing resumes the contact search — drop any pending address choice
    setPendingContact(null)
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

      <Popover
        open={showPicker || pendingContact !== null}
        onOpenChange={(open) => {
          setShowPicker(open)
          if (!open) setPendingContact(null)
        }}>
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
          {pendingContact ? (
            <div className='py-1' role='listbox' aria-label='Choose an email address'>
              <div className='px-3 py-1.5 text-xs text-muted-foreground'>
                {pendingContact.name
                  ? `${pendingContact.name} has ${pendingContact.addresses.length} addresses`
                  : 'Choose an address'}
              </div>
              {pendingContact.addresses.map((address) => (
                <button
                  key={address}
                  type='button'
                  role='option'
                  aria-selected={false}
                  className='flex w-full cursor-pointer items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-accent focus:bg-accent focus:outline-hidden'
                  onClick={() =>
                    commitContactAddress(pendingContact.id, address, pendingContact.name)
                  }>
                  <Mail className='size-3.5 text-muted-foreground' />
                  <span className='truncate'>{address}</span>
                </button>
              ))}
            </div>
          ) : (
            <RecordPickerContent
              value={[]}
              onChange={() => {}}
              entityDefinitionId='contact'
              multi={false}
              onSelectItem={handleContactPick}
              onResultsChange={handlePickerResults}
              externalSearch={inputValue}
              excludeFilter={excludeFilter}
              placeholder='Search contacts...'
            />
          )}
        </PopoverContent>
      </Popover>
    </div>
  )
}
