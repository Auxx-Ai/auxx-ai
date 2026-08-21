// packages/lib/src/field-values/converters/currency.ts

import type {
  NumberFieldValue,
  TypedFieldValue,
  TypedFieldValueInput,
} from '@auxx/types/field-value'
import { formatCurrency } from '@auxx/utils/currency'
import { DEFAULT_CURRENCY_OPTIONS } from '../../custom-fields/defaults'
import type { FieldOptions, FieldValueConverter } from './index'

const ISO_4217 = /^[A-Z]{3}$/

/** Last-resort code when neither the field nor the org asserts one. */
const FALLBACK_CODE = DEFAULT_CURRENCY_OPTIONS.currencyCode ?? 'USD'

/**
 * Normalise an ISO 4217 code, or return null when it is absent/malformed.
 *
 * Used for FIELD OPTIONS, never for a per-value code — a CURRENCY value does
 * not carry one. A malformed field option just falls through to the fallback.
 */
export function normalizeCurrencyCode(code: unknown): string | null {
  if (typeof code !== 'string') return null
  const upper = code.trim().toUpperCase()
  return ISO_4217.test(upper) ? upper : null
}

/**
 * Resolve the denomination for a CURRENCY field: **field → org → USD**.
 *
 * 🛑 An ABSENT `field.options.currencyCode` means INHERIT, and must stay
 * distinguishable from an asserted one. That is the whole point of the org
 * rung: the ~213 fields that never picked a code follow `organization.currency`
 * and move with it, while a field that DID pick one is pinned. Stamping the
 * resolved code back onto the field — in a cache, a default, or a pre-filled
 * editor that then saves — collapses the two and freezes those fields forever.
 *
 * A malformed code at either rung falls through rather than throwing: a bad
 * setting should not blank every money cell in the org.
 */
export function resolveCurrencyCode(fieldCurrencyCode: unknown, orgCurrencyCode?: unknown): string {
  return (
    normalizeCurrencyCode(fieldCurrencyCode) ??
    normalizeCurrencyCode(orgCurrencyCode) ??
    FALLBACK_CODE
  )
}

/** Coerce an unknown to a finite number, or null. Never scales. */
function toFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'string') {
    const cleaned = value.replace(/[$€£¥₹₩,\s]/g, '').trim()
    if (cleaned === '') return null
    const num = Number.parseFloat(cleaned)
    return Number.isFinite(num) ? num : null
  }
  return null
}

/**
 * Converter for the CURRENCY field type.
 *
 * Storage and shape are exactly NUMBER's — the integer minor-unit amount lives
 * in `valueNumber`, which is what SQL sorts, filters and aggregates on. CURRENCY
 * differs from NUMBER only in how it is DRAWN.
 *
 * 🛑 A value carries NO currency code. The denomination is the field's
 * (`options.currencyCode`), asserted once and inherited by every value. That is
 * what keeps `SUM(valueNumber)` meaningful: a per-row code would let one column
 * mix exponents — USD cents, whole yen, KWD thousandths — inside a single sum,
 * ordering and range filter, silently and with no way to detect it downstream.
 * Real multi-currency is an amount field + its own currency field + an
 * FX-converted base-currency field, not a code smuggled into each cell.
 */
export const currencyConverter: FieldValueConverter = {
  /**
   * Accepts a bare number or numeric string (every existing writer), an already
   * typed value, or an object carrying an amount (`{ amount }` / `{ value }`) —
   * the shape a connector or app sends. Any accompanying currency code is
   * IGNORED, not stored: see the note on the converter above.
   *
   * 🛑 NEVER converts units. Given `600` it cannot know whether that is $6.00 or
   * $600, and guessing is what produced 100×-wrong stored data. A provider that
   * reports major units converts in its own projection.
   */
  toTypedInput(value: unknown): TypedFieldValueInput | null {
    if (value === null || value === undefined) return null

    if (typeof value === 'object') {
      const obj = value as Record<string, unknown>

      // Already-typed value passing back through.
      if ('type' in obj) {
        if (obj.type !== 'number') return null
        return { type: 'number', value: (obj as unknown as NumberFieldValue).value }
      }

      const amount = toFiniteNumber(obj.amount ?? obj.value)
      if (amount === null) return null
      return { type: 'number', value: amount }
    }

    const num = toFiniteNumber(value)
    if (num === null) return null
    return { type: 'number', value: num }
  },

  /**
   * Returns the bare integer minor-unit amount — the same shape NUMBER returns.
   *
   * Deliberately NOT an object. `{ code, amount }` was tried and reverted: an
   * asymmetric read shape (object out, number in) breaks every `===`, `> 0`,
   * `?? null` and arithmetic expression downstream without throwing, and it
   * exists only to carry a per-value code the platform no longer has.
   */
  toRawValue(value: TypedFieldValue | TypedFieldValueInput | unknown): number | null {
    if (value === null || value === undefined) return null

    if (typeof value === 'object' && 'type' in (value as Record<string, unknown>)) {
      const typed = value as NumberFieldValue
      if (typed.type !== 'number') return null
      if (typed.value === null || typed.value === undefined || Number.isNaN(typed.value))
        return null
      return typed.value
    }

    // Bare number passthrough — a value that never went through the typed layer.
    if (typeof value === 'number' && Number.isFinite(value)) return value

    return null
  },

  /**
   * Formats via `formatCurrency`, which takes minor units and derives the scale
   * from the code.
   *
   * `options.currencyCode` is expected to be ALREADY RESOLVED through the org
   * rung — see {@link resolveCurrencyCode}. Server callers wrap their field
   * options with `withOrgCurrency()`; this falls back to USD only when nobody
   * resolved anything, which is the same answer the rung would give for an org
   * on the default setting.
   */
  toDisplayValue(value: TypedFieldValue | TypedFieldValueInput, options?: FieldOptions): string {
    if (!value) return ''

    const typed = value as NumberFieldValue
    const num = typed.value

    if (num === null || num === undefined || Number.isNaN(num)) return ''

    return formatCurrency(num, {
      currencyCode: normalizeCurrencyCode(options?.currencyCode) ?? FALLBACK_CODE,
      decimals: options?.decimals,
      useGrouping: options?.useGrouping ?? DEFAULT_CURRENCY_OPTIONS.useGrouping,
      currencyDisplay: options?.currencyDisplay ?? DEFAULT_CURRENCY_OPTIONS.currencyDisplay,
    })
  },
}

/**
 * Read whatever a CURRENCY read path handed us as an integer minor-unit amount,
 * or null.
 *
 * `toRawValue` emits a bare number, but tolerant narrowing is still worth having
 * at the edges: numeric strings arrive from workflow inputs and form state, and
 * `{ amount }` objects from connector projections. Returns null — an empty cell
 * — rather than `NaN` for anything unreadable.
 */
export function readCurrency(value: unknown): number | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'string') return toFiniteNumber(value)
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>
    return toFiniteNumber(obj.amount ?? obj.value)
  }
  return null
}
