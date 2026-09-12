// apps/web/src/components/line-grid/ui/cell-input.tsx
'use client'

// The chromeless inline cell editor skeleton, generalized out of money's
// `CurrencyCellInput` and `QuantityCellView` (line-builder/line-rows.tsx),
// which wrote the same shape twice: a local `draft` string, seeded from the
// cell's display value on focus, committed through a parser on blur, Escape
// reverts, and a `readOnly` branch that renders a plain span instead of an
// input.
//
// The two originals differ in ways that are load-bearing, not accidental -
// each option below exists to reproduce ONE such difference exactly, so
// lifting either onto this skeleton is a zero-behaviour-change move rather
// than a new one:
//
// - `seed` vs `format`: a currency cell's at-rest display carries a currency
//   SYMBOL and rounds to the field's exponent (`formatCurrency`); its
//   editable draft must be seeded with the raw, full-precision number
//   instead (`minorToMajorString`), or a typed five-place rate would look
//   truncated the moment you focus it. A quantity cell has no such split -
//   its `format`ted display IS what the input shows on focus.
// - `skipUnlessDirty`: a currency cell must skip parsing ENTIRELY on a blur
//   that never actually typed anything, tracked as a `dirty` flag separate
//   from the draft string - re-formatting a five-place rate and parsing it
//   back can drift a double's floating point on a value nobody touched. A
//   quantity cell has no such hazard and always re-parses on blur, no-oping
//   only when the parsed result equals the current value.
// - `flashInvalid`: only the quantity cell flashes the destructive classes on
//   an unparseable draft; a currency cell silently reverts (never introduced
//   that affordance, and this extraction is not the place to add it).
// - `live`: commit on every keystroke that parses cleanly, not only on blur -
//   off by default (every existing caller's `onCommit` is a network write),
//   kept for API parity with `CurrencyCellInput`'s existing prop even though
//   nothing currently turns it on.

import { cn } from '@auxx/ui/lib/utils'
import { useRef, useState } from 'react'

/** A parse attempt over the typed string: either a value to commit, or a rejection. */
export type CellInputParseResult<T> = { ok: true; value: T } | { ok: false }

export interface CellInputProps<T> {
  value: T
  /** String shown at rest - the readOnly span, and the unfocused editable input's value. */
  format: (value: T) => string
  /**
   * String the draft is seeded with on focus, when it must differ from
   * `format` (see the file doc's `seed` vs `format` note). Defaults to
   * `format`.
   */
  seed?: (value: T) => string
  /** Parses the typed string on commit. */
  parse: (raw: string) => CellInputParseResult<T>
  /** Whether two values are the same, to skip a no-op commit. Defaults to `Object.is`. */
  isEqual?: (a: T, b: T) => boolean
  onCommit: (next: T) => void
  readOnly: boolean
  /** Text alignment for both the readOnly span and the input. Defaults to `'end'`. */
  align?: 'start' | 'end'
  inputMode?: 'text' | 'decimal' | 'numeric'
  ariaLabel?: string
  /** Extra classes merged onto whichever of the input/span renders. */
  className?: string
  /** See the file doc's `live` note. Off by default. */
  live?: boolean
  /** See the file doc's `skipUnlessDirty` note. Off by default. */
  skipUnlessDirty?: boolean
  /** See the file doc's `flashInvalid` note. Off by default. */
  flashInvalid?: boolean
}

const INVALID_FLASH_MS = 1200

/**
 * The chromeless inline editor skeleton shared by every line-grid
 * currency/quantity-shaped cell: quiet at rest, editable on click, commits on
 * blur through `parse`, Escape reverts. See the file doc for the options that
 * reproduce money's two originals exactly.
 */
export function CellInput<T>({
  value,
  format,
  seed,
  parse,
  isEqual = Object.is,
  onCommit,
  readOnly,
  align = 'end',
  inputMode,
  ariaLabel,
  className,
  live = false,
  skipUnlessDirty = false,
  flashInvalid = false,
}: CellInputProps<T>) {
  const [draft, setDraft] = useState<string | null>(null)
  const [invalid, setInvalid] = useState(false)
  const invalidTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Set only by onChange, cleared on focus/commit - whether the draft was
  // actually typed into, not just opened. Only consulted when
  // `skipUnlessDirty` is on.
  const dirtyRef = useRef(false)

  const display = format(value)

  const flash = () => {
    if (!flashInvalid) return
    setInvalid(true)
    if (invalidTimeoutRef.current) clearTimeout(invalidTimeoutRef.current)
    invalidTimeoutRef.current = setTimeout(() => setInvalid(false), INVALID_FLASH_MS)
  }

  const tryCommit = (raw: string) => {
    const result = parse(raw)
    if (!result.ok) {
      flash()
      return
    }
    if (isEqual(result.value, value)) return
    onCommit(result.value)
  }

  const commit = () => {
    if (draft === null) return
    const wasEdited = dirtyRef.current
    const raw = draft
    setDraft(null)
    dirtyRef.current = false
    if (skipUnlessDirty && !wasEdited) return
    tryCommit(raw)
  }

  if (readOnly) {
    return (
      <div
        className={cn(
          'w-full text-sm tabular-nums',
          align === 'end' ? 'text-right' : 'text-left',
          className
        )}>
        {display}
      </div>
    )
  }

  return (
    <input
      aria-label={ariaLabel}
      value={draft ?? display}
      onChange={(e) => {
        setDraft(e.target.value)
        dirtyRef.current = true
        if (live) tryCommit(e.target.value)
      }}
      onFocus={() => {
        setDraft(seed ? seed(value) : format(value))
        dirtyRef.current = false
      }}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          setDraft(null)
          dirtyRef.current = false
        }
      }}
      inputMode={inputMode}
      className={cn(
        'h-full w-full rounded-sm border-none bg-transparent text-sm tabular-nums outline-none',
        align === 'end' ? 'text-right' : 'text-left',
        invalid && 'bg-destructive/10 ring-1 ring-destructive/60',
        className
      )}
    />
  )
}
