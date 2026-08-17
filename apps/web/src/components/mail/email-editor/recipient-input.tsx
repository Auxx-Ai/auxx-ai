// apps/web/src/components/mail/email-editor/recipient-input.tsx
'use client'
import type { IdentifierType as IdentifierTypeType } from '@auxx/database/types'
import { AutosizeInput, type AutosizeInputRef } from '@auxx/ui/components/autosize-input'
import { Badge } from '@auxx/ui/components/badge'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@auxx/ui/components/dropdown-menu'
import { Popover, PopoverAnchor, PopoverContent } from '@auxx/ui/components/popover'
import { cn } from '@auxx/ui/lib/utils'
import { generateId } from '@auxx/utils'
import { ArrowUpRight, Copy, Mail, UserPlus, X } from 'lucide-react'
import type React from 'react'
import { useCallback, useImperativeHandle, useMemo, useRef, useState } from 'react'
import { Tooltip } from '~/components/global/tooltip'
import { useDebounce } from '~/hooks/use-debounced-value'
import { api } from '~/trpc/react'
import { useEditorActiveStateContext } from './editor-active-state-context'
import {
  DEFAULT_PHONE_REGION,
  getIdentifierModel,
  type IdentifierModelSpec,
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
   * Replace ONE chip's identifier in place, keeping its `id`, its field and its
   * position in the list.
   *
   * 🔴 **Not remove-then-add.** That would move the chip to the end of the
   * field, drop focus, and — because `upsertRecipient` dedupes on `identifier` —
   * silently no-op whenever the target address was already committed elsewhere
   * in the same field, leaving the user with one fewer recipient than they had.
   */
  onSwitchIdentifier: (
    id: string,
    next: { identifier: string; identifierType: IdentifierTypeType }
  ) => void
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
  /**
   * Whether the selected channel carries carbon copies at all
   * (`PlatformCapabilities.ccBcc`). False on SMS, FB, IG — every channel whose
   * envelope has one recipient list — and it must gate the chip menu's "Move to
   * Cc/Bcc" rows, not just the header's Cc/Bcc toggles: the move writes a
   * recipient into a field the composer never renders and the send never reads,
   * so the recipient silently disappears.
   *
   * Absent → true, which is email, the model for every caller without resolved
   * capabilities.
   */
  supportsCcBcc?: boolean
}

const FIELD_LABELS: Record<RecipientField, string> = { TO: 'To', CC: 'Cc', BCC: 'Bcc' }
const ALL_FIELDS: RecipientField[] = ['TO', 'CC', 'BCC']

/** Keystroke settle before the search fires. */
const SEARCH_DEBOUNCE_MS = 200

/**
 * The `↗` mark on an address that exists only as a `Participant` row.
 *
 * ⚠️ These rows are the capability this menu recovers — an address someone
 * mailed you from that was never saved to their record — and also the ones that
 * can surprise: `Participant.entityInstanceId` is set by ingest matching and is
 * `ON DELETE set null`, so it can point at a contact the user does not think of
 * as "them". Marked rather than presented as the contact's own data, and picking
 * one writes nothing back to the record.
 */
function NotOnRecordMark() {
  return (
    <span
      className='shrink-0 text-muted-foreground'
      title='Not saved on this contact’s record — you have corresponded with this address'>
      <ArrowUpRight className='size-3' />
    </span>
  )
}

/** One row of the chip menu's "Other addresses" section. */
interface AddressOption {
  /** Normalized comparison key, and the radio group's value. */
  key: string
  /** The exact string to commit. */
  identifier: string
  identifierType: IdentifierTypeType
  onRecord: boolean
  display: string
  /** This is the address the chip already carries. */
  isCommitted: boolean
  /** Committed anywhere in this field, this chip included. */
  inField: boolean
}

function RecipientBadge({
  person,
  spec,
  recipientModel,
  committedInField,
  index,
  highlightedIndex,
  disabled,
  field,
  supportsCcBcc = true,
  onRemove,
  onMoveTo,
  onSwitchIdentifier,
  onAdd,
  onFocus,
  onBlur,
  onKeyDown,
  inputRef,
  popoverClassName,
}: {
  person: RecipientState
  spec: IdentifierModelSpec
  /** Query key half — a list fetched under email must not be read under phone. */
  recipientModel?: RecipientModel
  /**
   * Normalized identifiers already committed in THIS field, this chip's own
   * included. Drives the disabled state of the switch rows.
   */
  committedInField: Set<string>
  index: number
  highlightedIndex: number | null
  disabled?: boolean
  field: RecipientField
  /** See {@link RecipientInputProps.supportsCcBcc} — gates the move rows. */
  supportsCcBcc?: boolean
  onRemove: (id: string) => void
  onMoveTo: (id: string, target: RecipientField) => void
  onSwitchIdentifier: (
    id: string,
    next: { identifier: string; identifierType: IdentifierTypeType }
  ) => void
  onAdd: (recipient: RecipientState) => void
  onFocus: () => void
  onBlur: () => void
  onKeyDown: (e: React.KeyboardEvent<HTMLDivElement>) => void
  inputRef: React.RefObject<AutosizeInputRef | null>
  popoverClassName?: string
}) {
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const activeState = useEditorActiveStateContext()
  const dropdownId = `recipient-badge-${person.id}`
  const displayIdentifier = spec.formatDisplay(person.identifier)
  const displayName = person.name ?? displayIdentifier
  const isHighlighted = highlightedIndex === index
  /**
   * On a channel without carbon copies this is empty, and the menu ends after
   * the addresses — a Cc that cannot be sent must not be offerable.
   */
  const moveTargets = ALL_FIELDS.filter((f) => f !== field && (supportsCcBcc || f === 'TO'))

  /**
   * The contact's other addresses, fetched ON OPEN.
   *
   * `useQuery`, never a mutation: the deleted `fieldValue.batchGet` was a
   * mutation and therefore uncacheable, which is the only reason the composer
   * ever hand-rolled a request cache. Reopening the same chip, and switching
   * back and forth, must be free.
   *
   * `enabled` is the whole performance argument: rendering N chips issues ZERO
   * requests, one open costs two index probes, and most chips are never opened.
   * A chip with no `recordId` — free-typed, pasted, reply-derived, or restored
   * from a draft (`toPayload` carries no record id) — never fetches and gets no
   * section.
   */
  const { data: contactIdentifiers } = api.participant.listContactIdentifiers.useQuery(
    // `?? ''` only satisfies the input type on the disabled path; `enabled`
    // guarantees no request is made without a real record id.
    { recordId: person.recordId ?? '', model: recipientModel ?? 'email' },
    { enabled: dropdownOpen && !!person.recordId, staleTime: 5 * 60_000 }
  )

  const committedKey = identifierKey(spec, person.identifier)
  const addressOptions = useMemo(() => {
    const seen = new Set<string>()
    const options: AddressOption[] = []
    for (const row of contactIdentifiers ?? []) {
      // `identifierKey` normalizes, so `+1 415 555 1234` and `+14155551234` are
      // ONE address — the same comparison `excludeIdentifiers` uses for the
      // suggestion list. The server deduped on a case fold only (it has no
      // region to parse a number against), so a legacy un-normalized record
      // value and its E.164 twin both arrive and collapse HERE — without this
      // they would render as two rows sharing one React key.
      const key = identifierKey(spec, row.identifier)
      if (seen.has(key)) continue
      seen.add(key)
      options.push({
        key,
        identifier: row.identifier,
        identifierType: row.identifierType,
        onRecord: row.onRecord,
        display: spec.formatDisplay(row.identifier),
        isCommitted: key === committedKey,
        /** Already a recipient of this field — disabled, not hidden. */
        inField: committedInField.has(key),
      })
    }
    return options
  }, [contactIdentifiers, spec, committedKey, committedInField])
  // No section at all when the record has nothing but the address already on
  // this chip. An empty "Other addresses" heading would be noise on every
  // single-address recipient, which is most of them.
  const hasOtherAddresses = addressOptions.some((option) => !option.isCommitted)

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
        {hasOtherAddresses && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>Other addresses</DropdownMenuLabel>
            {/* The committed address is the checked one, so the group's value is
                this chip's own key — switching is a radio choice, not a list of
                commands. */}
            <DropdownMenuRadioGroup value={committedKey}>
              {addressOptions.map((option) => (
                <DropdownMenuRadioItem
                  key={option.key}
                  value={option.key}
                  // Hiding an address that is already a recipient makes the list
                  // change shape between opens for no visible reason; disabling
                  // it explains itself. This chip's own address is disabled by
                  // the same rule — it IS committed in this field. `disabled` is
                  // the send lock, the same one that freezes the chip's `×`.
                  disabled={option.inField || disabled}
                  onSelect={() =>
                    onSwitchIdentifier(person.id, {
                      identifier: option.identifier,
                      identifierType: option.identifierType,
                    })
                  }>
                  <span className='inline-flex min-w-0 items-center gap-1'>
                    <span className='truncate'>{option.display}</span>
                    {!option.onRecord && <NotOnRecordMark />}
                  </span>
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <UserPlus />
                Add as separate recipient
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className={popoverClassName}>
                {addressOptions.map((option) => (
                  <DropdownMenuItem
                    key={option.key}
                    disabled={option.inField || disabled}
                    onSelect={() =>
                      // A fresh chip id and the SAME `recordId`: two chips for
                      // one contact is the motion the `id`/`recordId` split
                      // (#1664) exists for.
                      onAdd({
                        id: generateId(),
                        identifier: option.identifier,
                        identifierType: option.identifierType,
                        name: person.name,
                        recordId: person.recordId,
                      })
                    }>
                    <span className='inline-flex min-w-0 items-center gap-1'>
                      <span className='truncate'>{option.display}</span>
                      {!option.onRecord && <NotOnRecordMark />}
                    </span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            {moveTargets.length > 0 && <DropdownMenuSeparator />}
          </>
        )}
        {moveTargets.map((target) => (
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
  onSwitchIdentifier,
  onContactSelect,
  placeholder,
  disabled,
  popoverClassName,
  recipientModel,
  defaultRegion = DEFAULT_PHONE_REGION,
  supportsCcBcc = true,
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
          spec={spec}
          recipientModel={recipientModel}
          committedInField={excludeIdentifiers}
          index={index}
          highlightedIndex={highlightedIndex}
          disabled={disabled}
          field={field}
          supportsCcBcc={supportsCcBcc}
          onRemove={(id) => {
            onRemove(id)
            setHighlightedIndex(null)
          }}
          onMoveTo={onMoveTo}
          onSwitchIdentifier={onSwitchIdentifier}
          onAdd={onAdd}
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
