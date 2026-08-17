// apps/web/src/components/mail/email-editor/recipient-input.tsx
'use client'
import type { IdentifierType as IdentifierTypeType } from '@auxx/database/types'
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
import { generateId } from '@auxx/utils'
import { Copy, Mail, X } from 'lucide-react'
import type React from 'react'
import { useCallback, useImperativeHandle, useMemo, useRef, useState } from 'react'
import { Tooltip } from '~/components/global/tooltip'
import { useDebounce } from '~/hooks/use-debounced-value'
import { api } from '~/trpc/react'
import { useEditorActiveStateContext } from './editor-active-state-context'
import {
  DEFAULT_PHONE_REGION,
  getIdentifierModel,
  identifierKey,
  type PhoneRegion,
  type RecipientModel,
} from './identifier-model'
import { type RecipientCandidate, RecipientSuggestions } from './recipient-suggestions'
import type { RecipientState } from './types'

export type RecipientField = 'TO' | 'CC' | 'BCC'

/**
 * Separators a pasted identifier list is split on. Safe for BOTH models — no
 * valid email address and no E.164 number contains any of them — so one rule
 * covers a spreadsheet column of phone numbers and a comma-joined address list
 * alike.
 */
const PASTE_SEPARATORS = /[,;\n\t]+/

// `RecipientState` is imported from `./types`, not redeclared here. It carried a
// structurally identical local copy until the `id`/`recordId` split, which is
// exactly the drift a second declaration invites.

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
  /**
   * A picked suggestion's identifier, committed. Carries `recordId` — the
   * contact's `EntityInstance.id` — and **not** a chip id: the parent mints
   * that. Passing the record id as the chip id is the collision documented on
   * {@link RecipientState.id}.
   *
   * `recordId` is `null` for a `Participant` never linked to a contact — a real
   * answer, not a gap, and the reason the field is nullable here.
   */
  onContactSelect: (contact: {
    recordId: string | null
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
   * `IdentifierType`, the copy, and — passed straight through to
   * `search.recipients` — which identifiers the suggestions are drawn from.
   * Absent → email, which is every caller without resolved capabilities.
   */
  recipientModel?: RecipientModel
  /**
   * Region national (no `+`) phone numbers are parsed and displayed against,
   * and that `search.recipients` normalizes a typed number search against.
   * Derive it from the sending channel's own E.164 number with
   * `regionFromIdentifier` — an org with a German and a US number should parse
   * national input differently depending on which one it is sending from
   * (`030 901820` is a substring of no E.164 number until it is trunk-stripped).
   * Ignored by the email model.
   */
  defaultRegion?: PhoneRegion
}

const FIELD_LABELS: Record<RecipientField, string> = { TO: 'To', CC: 'Cc', BCC: 'Bcc' }
const ALL_FIELDS: RecipientField[] = ['TO', 'CC', 'BCC']

/** Keystroke settle before the search fires. */
const SEARCH_DEBOUNCE_MS = 200

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
  const [inputValue, setInputValue] = useState('')
  // Inline validity hint. Replaces the red toast that used to fire on every
  // Enter with a half-typed number — this is a field people type slowly.
  const [invalidHint, setInvalidHint] = useState(false)
  const [highlightedIndex, setHighlightedIndex] = useState<number | null>(null)
  const [showPicker, setShowPicker] = useState(false)
  // Highlighted suggestion. `null` = nothing highlighted, so Enter commits what
  // was typed rather than a fuzzy match nobody asked for.
  const [activeIndex, setActiveIndex] = useState<number | null>(null)
  const inputRef = useRef<AutosizeInputRef>(null)

  /** Silently commits a valid identifier. No hint on invalid. Returns true if committed. */
  const tryCommitInput = (): boolean => {
    const normalized = spec.normalize(inputValue)
    if (!normalized) return false
    onAdd({
      id: generateId(),
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

  // Normalized identifiers already in this field. `Participant` is unique on
  // `(organizationId, identifier, identifierType)` — one row IS one identifier —
  // so excluding a suggestion is set membership on a string, not a per-record
  // "hide only when EVERY address is a recipient" walk. Covers picker/draft/
  // reply/free-typed alike.
  const excludeIdentifiers = useMemo(
    () => new Set(recipients.map((r) => identifierKey(spec, r.identifier))),
    [recipients, spec]
  )

  const query = inputValue.trim()
  const debouncedQuery = useDebounce(query, SEARCH_DEBOUNCE_MS)
  // One ranked read: participants ∪ contacts, already filtered to what this
  // channel can address and already carrying the exact string to commit. An
  // empty query is meaningful — it lists most-recently-mailed, the right answer
  // for a focused-but-empty field.
  const { data, isFetching } = api.search.recipients.useQuery(
    { query: debouncedQuery, model: recipientModel ?? 'email', region: defaultRegion },
    {
      enabled: showPicker,
      // Keep the previous page rendered while the next one loads so the list
      // does not blink empty between keystrokes.
      placeholderData: (previous) => previous,
      staleTime: 30_000,
    }
  )

  const candidates = useMemo(
    () =>
      (data?.candidates ?? []).filter(
        (candidate) => !excludeIdentifiers.has(identifierKey(spec, candidate.identifier))
      ),
    [data, excludeIdentifiers, spec]
  )
  const activeCandidate = activeIndex === null ? undefined : candidates[activeIndex]

  /** Commit one suggestion as a recipient and close the picker. */
  const commitCandidate = useCallback(
    (candidate: RecipientCandidate) => {
      onContactSelect({
        recordId: candidate.contactId,
        identifier: candidate.identifier,
        identifierType: candidate.identifierType,
        // `displayName` falls back to the identifier when no name is known;
        // storing that as the chip's `name` would defeat the badge's own
        // formatting (`+14155551234` instead of `(415) 555-1234`).
        name: candidate.displayName === candidate.identifier ? null : candidate.displayName,
      })
      setInputValue('')
      setShowPicker(false)
      setActiveIndex(null)
      setInvalidHint(false)
      inputRef.current?.focus()
    },
    [onContactSelect]
  )

  /** Move the highlight, wrapping. `null` enters the list at either end. */
  const moveActive = (delta: 1 | -1) => {
    if (candidates.length === 0) return
    setActiveIndex((current) => {
      if (current === null) return delta === 1 ? 0 : candidates.length - 1
      return (current + delta + candidates.length) % candidates.length
    })
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    switch (e.key) {
      case 'ArrowDown':
      case 'ArrowUp':
        // The list is ours, so the highlight moves directly — no synthetic
        // `KeyboardEvent` dispatched at a cmdk root that owns its own state.
        if (showPicker) {
          e.preventDefault()
          moveActive(e.key === 'ArrowDown' ? 1 : -1)
        }
        break
      case 'Enter':
        // A highlighted suggestion wins; otherwise commit what was typed.
        if (showPicker && activeCandidate) {
          e.preventDefault()
          commitCandidate(activeCandidate)
          break
        }
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
        setActiveIndex(null)
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
        id: generateId(),
        identifier: normalized,
        identifierType: spec.identifierType,
        name: null,
      })
    }

    setInputValue(leftover.join(', '))
    setInvalidHint(false)
    setHighlightedIndex(null)
    setActiveIndex(null)
    setShowPicker(false)
  }

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value
    setInputValue(val)
    setInvalidHint(false)
    setHighlightedIndex(null)
    // A new query is a new result set — nothing is highlighted until the user
    // arrows into it, so Enter keeps committing what they typed.
    setActiveIndex(null)
    setShowPicker(true)
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
        // Nothing to show and nothing typed = no empty box on focus. Typing
        // always opens it, so "no matches" is still an answer the user sees.
        open={showPicker && (candidates.length > 0 || query.length > 0)}
        onOpenChange={(open) => {
          setShowPicker(open)
          if (!open) setActiveIndex(null)
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
              // An empty focused field is a real query: it lists the people you
              // most recently mailed.
              onFocus={() => setShowPicker(true)}
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
          className={cn('w-80 p-0', popoverClassName)}
          align='start'
          side='bottom'
          sideOffset={5}
          onOpenAutoFocus={(e) => e.preventDefault()}
          onCloseAutoFocus={(e) => e.preventDefault()}>
          <RecipientSuggestions
            candidates={candidates}
            spec={spec}
            activeIndex={activeIndex}
            truncated={data?.truncated ?? false}
            isLoading={isFetching}
            onSelect={commitCandidate}
            onHover={setActiveIndex}
          />
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
