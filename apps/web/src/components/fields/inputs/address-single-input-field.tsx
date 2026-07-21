// apps/web/src/components/fields/inputs/address-single-input-field.tsx
'use client'

import { Badge } from '@auxx/ui/components/badge'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from '@auxx/ui/components/input-group'
import { cn } from '@auxx/ui/lib/utils'
import {
  type AddressParseCandidate,
  type AddressStructValue,
  formatAddress,
  parseAddress,
} from '@auxx/utils/address'
import { Maximize2, Minimize2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useDebouncedValue } from '~/hooks/use-debounced-value'
import { useFieldNavigationOptional } from '../field-navigation-context'
import { usePropertyContext } from '../property-provider'
import { type AddressStruct, AddressStructFields } from './address-struct-input-field'
import { useOrgBusinessCountry } from './use-org-business-country'

/**
 * address-single-input-field.tsx
 *
 * Single free-text address input: local-parse suggestions + an inline "Edit details"
 * escape hatch onto the existing structured sub-fields. See
 * plans/address-field/01-single-input-address-field.md §6 for the full spec this
 * implements, and §5 item 4 for the `_source` origin-marker contract.
 */

/** Parse confidence below which the original typed text is kept alongside the parsed struct
 *  (decision #6) — a low-confidence guess should never silently discard what the user typed. */
const LOW_CONFIDENCE_THRESHOLD = 0.6

const DEBOUNCE_MS = 150

/**
 * Transient origin marker (decision #11, §5 item 4): tells the server-side geocoder
 * normalize hook how confidently it may overwrite components. Stripped by the hook's
 * write-back — never a persisted field of the address itself.
 */
export type AddressStructWithSource = AddressStructValue & { _source?: 'single' | 'structured' }

/** Normalizes an arbitrary stored value into the canonical `AddressStructValue` shape. */
function normalizeStructValue(value: unknown): AddressStructValue {
  const v = (value && typeof value === 'object' ? value : {}) as Partial<AddressStructValue>
  return {
    street1: v.street1 ?? '',
    street2: v.street2 || undefined,
    city: v.city ?? '',
    state: v.state ?? '',
    zipCode: v.zipCode ?? '',
    country: v.country ?? '',
    raw: v.raw,
    lat: v.lat,
    lng: v.lng,
    geocodedAt: v.geocodedAt,
  }
}

/** Shallow-compares the visible address components (ignores `raw`/`lat`/`lng`/`_source`). */
function hasVisibleChange(a: AddressStructValue, b: AddressStructValue): boolean {
  return (
    a.street1 !== b.street1 ||
    (a.street2 || '') !== (b.street2 || '') ||
    a.city !== b.city ||
    a.state !== b.state ||
    a.zipCode !== b.zipCode ||
    a.country !== b.country
  )
}

function toAddressStruct(v: Partial<AddressStructValue>): AddressStruct {
  return {
    street1: v.street1 ?? '',
    street2: v.street2 ?? '',
    city: v.city ?? '',
    state: v.state ?? '',
    zipCode: v.zipCode ?? '',
    country: v.country ?? '',
  }
}

/** Small muted chips labeling the components the local parser actually detected. */
function CandidateChips({ struct }: { struct: AddressStructValue }) {
  const chips = [struct.city, struct.state, struct.zipCode, struct.country].filter(
    Boolean
  ) as string[]
  if (chips.length === 0) return null
  return (
    <span className='flex flex-wrap gap-1'>
      {chips.map((chip) => (
        <Badge key={chip} variant='outline' size='xs' className='font-normal text-muted-foreground'>
          {chip}
        </Badge>
      ))}
    </span>
  )
}

interface AddressSingleFieldsProps {
  /** Current committed struct — idle display source and "Edit details" seed. */
  value: AddressStructValue | Partial<AddressStructValue> | null | undefined
  /** Org business-address country — parser default + canonical-format domestic country. */
  defaultCountry: string
  /** Fires when the user explicitly accepts a candidate (click/Enter) or confirms typed text
   *  on blur — a commit-worthy event for callers that fire-and-forget save immediately. */
  onAccept: (next: AddressStructWithSource) => void
  /** Fires on every inline "Edit details" keystroke. Buffering-only for callers using Pattern
   *  E save-on-close; behaviorally identical to `onAccept` for callers with no close concept
   *  (the workflow node / FieldPanel adapter just forward both straight to their own onChange). */
  onDraftChange: (next: AddressStructWithSource) => void
  disabled?: boolean
  autoFocus?: boolean
  className?: string
  inputVariant?: 'default' | 'transparent'
}

/**
 * Pure UI, no context dependencies (mirrors `AddressStructFields`): a single free-text
 * address input with local-parse suggestions and an inline "Edit details" escape hatch.
 *
 * - Idle: shows the canonical one-liner (`formatAddress`).
 * - Editing (on focus): raw text, debounced local `parseAddress`, up to 2 candidates below.
 * - Enter / candidate click accepts; Escape reverts; blur with parseable text accepts the
 *   top candidate — closing without an explicit Enter never silently drops typed text.
 * - An expand/collapse addon button (Maximize2/Minimize2) on the input toggles between the
 *   two views: compact single line ⇄ the existing `AddressStructFields` detail view
 *   (pre-filled from the top candidate, for corrections without retyping). In the detail
 *   view the same button sits inside the street-address input and collapses back.
 */
export function AddressSingleFields({
  value,
  defaultCountry,
  onAccept,
  onDraftChange,
  disabled,
  autoFocus,
  className,
  inputVariant,
}: AddressSingleFieldsProps) {
  const structValue = useMemo(() => normalizeStructValue(value), [value])

  const [mode, setMode] = useState<'idle' | 'editing'>('idle')
  const [text, setText] = useState('')
  const [highlightIndex, setHighlightIndex] = useState(0)
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [detailsDraft, setDetailsDraft] = useState<AddressStruct>(() =>
    toAddressStruct(structValue)
  )

  const nav = useFieldNavigationOptional()

  const [debouncedText] = useDebouncedValue(text, DEBOUNCE_MS)

  const candidates = useMemo<AddressParseCandidate[]>(() => {
    if (mode !== 'editing' || detailsOpen) return []
    const trimmed = debouncedText.trim()
    if (!trimmed) return []
    return parseAddress(trimmed, { defaultCountry }).slice(0, 2)
  }, [debouncedText, defaultCountry, mode, detailsOpen])

  // Reset the keyboard highlight whenever the candidate set changes underneath it.
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentionally keyed on the candidate list only
  useEffect(() => {
    setHighlightIndex(0)
  }, [candidates])

  // Capture arrow keys while the suggestion list is open (Pattern C, mirrors DateInputField) —
  // otherwise ArrowUp/Down would bubble to row navigation instead of moving the highlight.
  useEffect(() => {
    if (candidates.length === 0) return
    nav?.setPopoverCapturing(true)
    return () => nav?.setPopoverCapturing(false)
  }, [candidates.length, nav])

  const buildAccepted = useCallback(
    (candidate: AddressParseCandidate, rawText: string): AddressStructWithSource => ({
      ...candidate.struct,
      raw: candidate.confidence < LOW_CONFIDENCE_THRESHOLD ? rawText : undefined,
      _source: 'single',
    }),
    []
  )

  const revertToIdle = useCallback(() => {
    setMode('idle')
    setText('')
  }, [])

  const acceptCandidate = useCallback(
    (candidate: AddressParseCandidate, rawText: string) => {
      setMode('idle')
      setText('')
      onAccept(buildAccepted(candidate, rawText))
    },
    [buildAccepted, onAccept]
  )

  const handleFocus = useCallback(() => {
    if (detailsOpen) return
    setMode('editing')
    setText(formatAddress(structValue, { domesticCountry: defaultCountry }))
  }, [detailsOpen, structValue, defaultCountry])

  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setText(e.target.value)
  }, [])

  // Paste-safe: a single-line <input> otherwise mangles multiline clipboard text (browsers
  // strip/garble newlines pasted into type="text"). Join lines explicitly before they reach
  // local state so `parseAddress`'s comma-segment anchors see them (the highest-value path —
  // addresses pasted from emails).
  const handlePaste = useCallback((e: React.ClipboardEvent<HTMLInputElement>) => {
    const pasted = e.clipboardData.getData('text')
    if (!/\r?\n/.test(pasted)) return
    e.preventDefault()
    const joined = pasted
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .join(', ')
    const el = e.currentTarget
    const start = el.selectionStart ?? el.value.length
    const end = el.selectionEnd ?? el.value.length
    setMode('editing')
    setText((prev) => prev.slice(0, start) + joined + prev.slice(end))
  }, [])

  const handleBlur = useCallback(() => {
    if (detailsOpen || mode !== 'editing') return
    const trimmed = text.trim()
    if (!trimmed) {
      revertToIdle()
      return
    }
    const parsed = candidates.length > 0 ? candidates : parseAddress(trimmed, { defaultCountry })
    if (parsed[0]) {
      acceptCandidate(parsed[highlightIndex] ?? parsed[0], text)
    } else {
      revertToIdle()
    }
  }, [
    detailsOpen,
    mode,
    text,
    candidates,
    defaultCountry,
    highlightIndex,
    acceptCandidate,
    revertToIdle,
  ])

  const openDetails = useCallback(() => {
    const candidate = candidates[0]
    const seed = candidate?.struct ?? structValue
    const draft = toAddressStruct({ ...seed, country: seed.country || defaultCountry })
    setDetailsDraft(draft)
    // Typed-but-unaccepted text seeded this draft — propagate it immediately so toggling
    // open → closed without touching a detail field never drops what was typed.
    if (candidate) {
      onDraftChange({ ...draft, street2: draft.street2 || undefined, _source: 'structured' })
    }
    setMode('idle')
    setText('')
    setDetailsOpen(true)
  }, [candidates, structValue, defaultCountry, onDraftChange])

  const toggleDetails = useCallback(() => {
    if (detailsOpen) {
      setDetailsOpen(false)
    } else {
      openDetails()
    }
  }, [detailsOpen, openDetails])

  const handleDetailsChange = useCallback(
    (next: AddressStruct) => {
      setDetailsDraft(next)
      onDraftChange({
        street1: next.street1,
        street2: next.street2 || undefined,
        city: next.city,
        state: next.state,
        zipCode: next.zipCode,
        country: next.country,
        _source: 'structured',
      })
    },
    [onDraftChange]
  )

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (detailsOpen) return
      if (e.key === 'Enter') {
        e.preventDefault()
        e.stopPropagation()
        const trimmed = text.trim()
        if (!trimmed) {
          revertToIdle()
          return
        }
        const parsed =
          candidates.length > 0 ? candidates : parseAddress(trimmed, { defaultCountry })
        if (parsed[0]) acceptCandidate(parsed[highlightIndex] ?? parsed[0], text)
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        revertToIdle()
        return
      }
      if (e.key === 'ArrowDown' && candidates.length > 0) {
        e.preventDefault()
        setHighlightIndex((i) => Math.min(i + 1, candidates.length - 1))
        return
      }
      if (e.key === 'ArrowUp' && candidates.length > 0) {
        e.preventDefault()
        setHighlightIndex((i) => Math.max(i - 1, 0))
      }
    },
    [detailsOpen, text, candidates, defaultCountry, highlightIndex, acceptCandidate, revertToIdle]
  )

  const idleDisplayValue = formatAddress(structValue, { domesticCountry: defaultCountry })

  const detailsToggleButton = (
    <InputGroupButton
      size='icon-xs'
      className='rounded-full'
      aria-label={detailsOpen ? 'Collapse address details' : 'Edit address details'}
      aria-pressed={detailsOpen}
      onMouseDown={(e) => e.preventDefault()}
      onClick={toggleDetails}
      disabled={disabled}>
      {detailsOpen ? <Minimize2 /> : <Maximize2 />}
    </InputGroupButton>
  )

  return (
    <div className={cn('flex flex-col gap-1', className)}>
      {!detailsOpen && (
        <InputGroup
          size='sm'
          className={cn(
            inputVariant === 'transparent' && 'border-transparent bg-transparent shadow-none'
          )}>
          <InputGroupInput
            placeholder='Street, city, state, zip'
            value={mode === 'editing' ? text : idleDisplayValue}
            onFocus={handleFocus}
            onChange={handleChange}
            onPaste={handlePaste}
            onKeyDown={handleKeyDown}
            onBlur={handleBlur}
            disabled={disabled}
            autoFocus={autoFocus}
          />
          <InputGroupAddon align='inline-end'>{detailsToggleButton}</InputGroupAddon>
        </InputGroup>
      )}

      {mode === 'editing' && !detailsOpen && candidates.length > 0 && (
        <div
          role='listbox'
          className='flex flex-col gap-0.5 rounded-lg border bg-popover p-1 shadow-xs'>
          {candidates.map((candidate, i) => (
            <button
              key={`${candidate.struct.street1}-${candidate.struct.zipCode}-${candidate.struct.country}-${i}`}
              type='button'
              role='option'
              aria-selected={i === highlightIndex}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => acceptCandidate(candidate, text)}
              onMouseEnter={() => setHighlightIndex(i)}
              className={cn(
                'flex flex-col gap-0.5 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted',
                i === highlightIndex && 'bg-muted'
              )}>
              <span>{formatAddress(candidate.struct, { domesticCountry: defaultCountry })}</span>
              <CandidateChips struct={candidate.struct} />
            </button>
          ))}
        </div>
      )}

      {detailsOpen && (
        <AddressStructFields
          value={detailsDraft}
          onChange={handleDetailsChange}
          disabled={disabled}
          inputVariant={inputVariant}
          className='flex flex-col gap-2'
          autoFocus
          street1Addon={detailsToggleButton}
        />
      )}
    </div>
  )
}

/**
 * AddressSingleInputField — record-drawer wiring for `AddressSingleFields`.
 *
 * Pattern E: save-on-close via `usePropertyContext`, mirroring `AddressStructInputField`:
 * - Accepting a candidate (Enter/click) commits and closes immediately (`commitValueAndClose`,
 *   Pattern C style — same as `DateInputField`).
 * - Any other buffered edit (an "Edit details" keystroke without an explicit accept) commits
 *   fire-and-forget on popover close via `onBeforeClose`, same as the structured editor.
 */
export function AddressSingleInputField() {
  const { value, commitValue, commitValueAndClose, onBeforeClose } = usePropertyContext()
  const initial = useMemo(() => normalizeStructValue(value), [value])
  const [pending, setPending] = useState<AddressStructValue>(initial)
  const defaultCountry = useOrgBusinessCountry()

  const handleAccept = useCallback(
    (next: AddressStructWithSource) => {
      setPending(next)
      commitValueAndClose(next)
    },
    [commitValueAndClose]
  )

  const handleDraftChange = useCallback((next: AddressStructWithSource) => {
    setPending(next)
  }, [])

  useEffect(() => {
    onBeforeClose.current = () => {
      if (hasVisibleChange(pending, initial)) commitValue(pending)
    }
    return () => {
      onBeforeClose.current = undefined
    }
  }, [onBeforeClose, pending, initial, commitValue])

  return (
    <AddressSingleFields
      value={pending}
      defaultCountry={defaultCountry}
      onAccept={handleAccept}
      onDraftChange={handleDraftChange}
      autoFocus
      className='w-[350px] p-2'
    />
  )
}
