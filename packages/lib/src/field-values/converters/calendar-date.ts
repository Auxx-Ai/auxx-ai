// packages/lib/src/field-values/converters/calendar-date.ts

import type { DateFieldValue, TypedFieldValue, TypedFieldValueInput } from '@auxx/types/field-value'
import { DEFAULT_DATE_OPTIONS } from '../../custom-fields/defaults'
import { normalizeCalendarDayIso } from '../calendar-day'
import { dateConverter } from './date'
import type { FieldOptions, FieldValueConverter } from './index'

/**
 * Converter for `FieldType.DATE` only.
 *
 * A DATE value is a calendar day stored as `YYYY-MM-DDT00:00:00.000Z`
 * (plans/money/tasks/33-calendar-day-fields.md §3). Input is normalised to that
 * form by `normalizeCalendarDayIso`, and display always formats in UTC with no
 * time component, so writer and viewer in different zones read the same day.
 *
 * DATETIME and TIME are instants and keep `dateConverter`.
 */
export const calendarDateConverter: FieldValueConverter = {
  /**
   * Convert raw input to TypedFieldValueInput.
   * Accepts a bare `YYYY-MM-DD`, any parseable instant string, a Date, an epoch
   * number, an already-typed `{ type: 'date', value }`, or null/undefined.
   */
  toTypedInput(value: unknown): TypedFieldValueInput | null {
    const iso = normalizeCalendarDayIso(unwrapTyped(value))
    return iso ? { type: 'date', value: iso } : null
  },

  /**
   * Convert TypedFieldValue/Input to the canonical UTC-midnight ISO string.
   */
  toRawValue(value: TypedFieldValue | TypedFieldValueInput | unknown): string | null {
    return normalizeCalendarDayIso(unwrapTyped(value))
  },

  /**
   * Convert TypedFieldValue to display string.
   *
   * Always renders the stored UTC calendar day: `timeZone` is pinned to UTC and
   * `includeTime` is ignored. `iso` yields the bare `YYYY-MM-DD`.
   */
  toDisplayValue(value: TypedFieldValue | TypedFieldValueInput, options?: FieldOptions): string {
    if (!value) return ''

    const iso = normalizeCalendarDayIso((value as DateFieldValue).value)
    if (!iso) return ''

    const opts = { ...DEFAULT_DATE_OPTIONS, ...options }

    switch (opts.format) {
      case 'iso':
        return iso.slice(0, 10)
      case 'relative':
        return dateConverter.toDisplayValue(
          { type: 'date', value: iso },
          { format: 'relative' }
        ) as string
      case 'short':
        return new Date(iso).toLocaleString(undefined, { timeZone: 'UTC', dateStyle: 'short' })
      case 'long':
        return new Date(iso).toLocaleString(undefined, { timeZone: 'UTC', dateStyle: 'long' })
      default:
        return new Date(iso).toLocaleString(undefined, { timeZone: 'UTC', dateStyle: 'medium' })
    }
  },
}

/** The inner value of an already-typed date, or the input itself. */
function unwrapTyped(value: unknown): unknown {
  if (typeof value === 'object' && value !== null && 'type' in value) {
    const typed = value as TypedFieldValue
    return typed.type === 'date' ? (typed as DateFieldValue).value : null
  }
  return value
}
