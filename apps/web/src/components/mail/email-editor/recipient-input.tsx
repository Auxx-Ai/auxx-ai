// apps/web/src/components/mail/email-editor/recipient-input.tsx
'use client'
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
import { cn } from '@auxx/ui/lib/utils'
import { Copy, Mail, Phone, X } from 'lucide-react'
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
import {
  DEFAULT_PHONE_REGION,
  getIdentifierModel,
  type IdentifierModelSpec,
  identifierKey,
  type PhoneRegion,
  type RecipientModel,
} from './identifier-model'

export type RecipientField = 'TO' | 'CC' | 'BCC'

/**
 * Separators a pasted identifier list is split on. Safe for BOTH models — no
 * valid email address and no E.164 number contains any of them — so one rule
 * covers a spreadsheet column of phone numbers and a comma-joined address list
 * alike.
 */
const PASTE_SEPARATORS = /[,;\n\t]+/

interface RecipientState {
  id: string
  identifier: string
  identifierType: IdentifierTypeType
  name?: string | null
}

/** Imperative handle exposed via ref for parent components */
export interface RecipientInputHandle {
  /** Commits any valid identifier currently typed in the input. Returns true if committed. */
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
  /**
   * Shape of identifier the selected channel addresses
   * (`PlatformCapabilities.recipientModel`). Drives validation, the committed
   * `IdentifierType`, which contact field the picker reads, and the copy.
   * Absent → email, which is every caller without resolved capabilities.
   */
  recipientModel?: RecipientModel
  /**
   * Region national (no `+`) phone numbers are parsed and displayed against.
   * Derive it from the sending channel's own E.164 number with
   * `regionFromIdentifier` — an org with a German and a US number should parse
   * national input differently depending on which one it is sending from.
   * Ignored by the email model.
   */
  defaultRegion?: PhoneRegion
}

const FIELD_LABELS: Record<RecipientField, string> = { TO: 'To', CC: 'Cc', BCC: 'Bcc' }
const ALL_FIELDS: RecipientField[] = ['TO', 'CC', 'BCC']

/** The picker row's own single known identifier (the primary) — the fallback
 *  when the field read fails or returns nothing. `toEmailAddressList` is a
 *  generic system-value normalizer (scalar or sortKey-ordered array); phone is
 *  multi-value too since #1629. */
function itemFallbackAddresses(item: RecordPickerItem, spec: IdentifierModelSpec): string[] {
  const fromRow = toEmailAddressList(item.data?.[spec.rowDataKey])[0]
  // `secondaryInfo` is the contact's secondary DISPLAY field — an email. It is
  // only a usable fallback when this channel addresses emails.
  const single =
    fromRow ?? (spec.secondaryInfoIsIdentifier ? item.secondaryInfo || undefined : undefined)
  return single ? [single] : []
}

function RecipientBadge({
  person,
  displayIdentifier,
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
  /** `spec.formatDisplay(person.identifier)` — display only; never committed. */
  displayIdentifier: string
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
  const displayName = person.name ?? displayIdentifier
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
  recipientModel,
  defaultRegion = DEFAULT_PHONE_REGION,
}: RecipientInputProps) {
  const spec = useMemo(
    () => getIdentifierModel(recipientModel, defaultRegion),
    [recipientModel, defaultRegion]
  )
  const IdentifierIcon = recipientModel === 'phone' ? Phone : Mail
  const [inputValue, setInputValue] = useState('')
  // Inline validity hint. Replaces the red toast that used to fire on every
  // Enter with a half-typed number — this is a field people type slowly.
  const [invalidHint, setInvalidHint] = useState(false)
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

  /** Silently commits a valid identifier. No hint on invalid. Returns true if committed. */
  const tryCommitInput = (): boolean => {
    const normalized = spec.normalize(inputValue)
    if (!normalized) return false
    const dummyId = `temp_${Date.now()}_${normalized}`
    onAdd({
      id: dummyId,
      identifier: normalized,
      identifierType: spec.identifierType,
      name: null,
    })
    setInputValue('')
    setInvalidHint(false)
    setHighlightedIndex(null)
    return true
  }

  /** Commits input, flagging it inline when invalid (explicit user action: Enter, comma). */
  const addRecipientFromInput = () => {
    if (!spec.normalize(inputValue)) {
      setInvalidHint(true)
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
   * Fetch the FULL identifier list for each contact (both `primary_email` and
   * `phone` are multi-value — they read back as one row per value, primary
   * first) in one batch read. Falls back per item to its own row data when the
   * field ref can't resolve or the read fails.
   */
  const fetchContactAddresses = useCallback(
    async (items: RecordPickerItem[]): Promise<Map<string, string[]>> => {
      const result = new Map<string, string[]>()
      const fallbackAll = () => {
        for (const item of items) result.set(item.id, itemFallbackAddresses(item, spec))
        return result
      }
      try {
        const normalizedToItem = new Map(
          items.map((item) => [getNormalizedRecordId(item.recordId), item] as const)
        )
        const maps = useResourceStore.getState()
        const [firstRecordId] = normalizedToItem.keys()
        // First systemAttribute candidate that resolves on this definition wins
        // (mirrors `systemAttributeForChannel` in the kopilot recipient resolver).
        const ref = firstRecordId
          ? spec.systemAttributes.reduce<ReturnType<typeof resolveSystemAttributeRef>>(
              (found, attr) =>
                found ?? resolveSystemAttributeRef(maps, attr, getDefinitionId(firstRecordId)),
              undefined
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
          result.set(item.id, addresses.length > 0 ? addresses : itemFallbackAddresses(item, spec))
        }
        for (const item of items) {
          if (!result.has(item.id)) result.set(item.id, itemFallbackAddresses(item, spec))
        }
        return result
      } catch {
        return fallbackAll()
      }
    },
    [batchGetAsync, spec]
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

  // Normalized identifiers of recipients already in this field — used to hide
  // their matching contacts from the picker. Covers picker/draft/reply/
  // free-typed alike.
  const excludeIdentifiers = useMemo(
    () => new Set(recipients.map((r) => identifierKey(spec, r.identifier))),
    [recipients, spec]
  )

  /** Commit one identifier as a recipient and reset the picker state. */
  const commitContactAddress = useCallback(
    (contactId: string, address: string, name: string | null) => {
      onContactSelect({
        id: contactId,
        identifier: spec.normalize(address) ?? address,
        identifierType: spec.identifierType,
        name,
      })
      setInputValue('')
      setShowPicker(false)
      setPendingContact(null)
      inputRef.current?.focus()
    },
    [onContactSelect, spec]
  )

  /**
   * Handle contact selection from RecordPickerContent. A picked contact is
   * expanded into its N identifiers: exactly one not yet a recipient commits
   * directly; several swap the popover to a per-value row list.
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
      const candidates = addresses.filter((a) => !excludeIdentifiers.has(identifierKey(spec, a)))
      if (candidates.length === 0) return
      if (candidates.length === 1) {
        commitContactAddress(item.id, candidates[0]!, name)
        return
      }
      setPendingContact({ id: item.id, name, addresses: candidates })
    },
    [contactAddresses, fetchContactAddresses, excludeIdentifiers, commitContactAddress, spec]
  )

  const excludeFilter = useCallback(
    (item: RecordPickerItem) => {
      // Per-value exclude: once the contact's full list is known (results
      // prefetch), the contact hides only when EVERY identifier is a recipient.
      const known = contactAddresses.get(item.id)
      if (known && known.length > 0) {
        return known.every((a) => excludeIdentifiers.has(identifierKey(spec, a)))
      }
      // Unfetched: the only known value is the row's own primary.
      const [primary] = itemFallbackAddresses(item, spec)
      return !!primary && excludeIdentifiers.has(identifierKey(spec, primary))
    },
    [contactAddresses, excludeIdentifiers, spec]
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
        // Otherwise commit the free-typed identifier
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
        setInvalidHint(false)
        break
      default:
        break
    }
  }
  /**
   * Paste of a separator-delimited list — the shape phone numbers and address
   * lists arrive in from a spreadsheet. Without this the whole blob lands as
   * one string and the next Enter fails it as a single identifier; the `','`
   * keydown never fires for a paste, so this is the only place email gets the
   * split too.
   *
   * Valid parts commit; whatever didn't parse is joined back into the input so
   * nothing is silently swallowed.
   */
  const handlePaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    const pasted = e.clipboardData.getData('text/plain')
    // A single value pastes normally — only a delimited list is intercepted.
    if (!pasted || !PASTE_SEPARATORS.test(pasted)) return
    e.preventDefault()

    const el = e.currentTarget
    const start = el.selectionStart ?? inputValue.length
    const end = el.selectionEnd ?? start
    const merged = inputValue.slice(0, start) + pasted + inputValue.slice(end)

    // Seeded from the current recipients so a paste can't duplicate one, and
    // grown as we go since `recipients` doesn't update mid-loop.
    const seen = new Set(excludeIdentifiers)
    const leftover: string[] = []
    const now = Date.now()
    for (const part of merged.split(PASTE_SEPARATORS)) {
      const trimmed = part.trim()
      if (!trimmed) continue
      const normalized = spec.normalize(trimmed)
      if (!normalized) {
        leftover.push(trimmed)
        continue
      }
      const key = identifierKey(spec, normalized)
      if (seen.has(key)) continue
      seen.add(key)
      onAdd({
        id: `temp_${now}_${normalized}`,
        identifier: normalized,
        identifierType: spec.identifierType,
        name: null,
      })
    }

    setInputValue(leftover.join(', '))
    setInvalidHint(false)
    setHighlightedIndex(null)
    setPendingContact(null)
    setShowPicker(false)
  }

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value
    setInputValue(val)
    setInvalidHint(false)
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
          displayIdentifier={spec.formatDisplay(person.identifier)}
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
              onPaste={handlePaste}
              onFocus={() => {
                if (inputValue.trim().length > 0) setShowPicker(true)
              }}
              onBlur={() => {
                // Silently commit a valid identifier on blur (no toast for invalid)
                tryCommitInput()
                // Delay closing to allow clicking picker items
                setTimeout(() => setShowPicker(false), 200)
              }}
              placeholder={recipients.length === 0 ? placeholder : ''}
              minWidth={30}
              inputClassName={cn(
                'bg-transparent p-1 text-sm outline-hidden placeholder:text-muted-foreground/60',
                invalidHint && 'text-destructive'
              )}
              disabled={disabled}
              aria-label='Add recipient'
              aria-invalid={invalidHint || undefined}
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
            <div className='py-1' role='listbox' aria-label={`Choose a ${spec.noun}`}>
              <div className='px-3 py-1.5 text-xs text-muted-foreground'>
                {pendingContact.name
                  ? `${pendingContact.name} has ${pendingContact.addresses.length} ${spec.nounPlural}`
                  : `Choose a ${spec.noun}`}
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
                  <IdentifierIcon className='size-3.5 text-muted-foreground' />
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

      {invalidHint && (
        <span role='alert' title={spec.invalidDescription} className='text-destructive text-xs'>
          {spec.invalidTitle}
        </span>
      )}
    </div>
  )
}
