// packages/lib/src/placeholders/format-codec.ts

import type { FieldOptions } from '../custom-fields/field-options'

/** Field types whose standard display options can be overridden per placeholder occurrence. */
export const PLACEHOLDER_FORMAT_TYPES = [
  'NUMBER',
  'CURRENCY',
  'DATE',
  'DATETIME',
  'TIME',
  'CHECKBOX',
  'PHONE_INTL',
  'URL',
] as const

/** A field type supported by the shared placeholder formatting editor. */
export type PlaceholderFormatType = (typeof PLACEHOLDER_FORMAT_TYPES)[number]

/** A versioned, per-placeholder override of the normal field display options. */
export interface PlaceholderFormatPayload {
  v: 1
  t: PlaceholderFormatType
  o: Partial<FieldOptions>
}

/** Check whether a field type can use the shared placeholder formatting editor. */
export function isPlaceholderFormatType(value: string): value is PlaceholderFormatType {
  return (PLACEHOLDER_FORMAT_TYPES as readonly string[]).includes(value)
}

/** Serialize a display override for the placeholder node's `data-format` attribute. */
export function encodePlaceholderFormat(payload: PlaceholderFormatPayload): string {
  const normalized = normalizePlaceholderFormat(payload)
  return normalized ? JSON.stringify(normalized) : ''
}

/**
 * Parse and normalize a placeholder display override.
 *
 * Only formatting keys produced by the shared editors are accepted. In
 * particular, `timeZone` is deliberately excluded: Visit resolution owns that
 * context-sensitive option so sequence delivery timezone remains authoritative.
 */
export function decodePlaceholderFormat(
  raw: string | null | undefined
): PlaceholderFormatPayload | null {
  if (!raw) return null

  try {
    const parsed = JSON.parse(raw) as { v?: unknown; t?: unknown; o?: unknown }
    if (parsed.v !== 1 || typeof parsed.t !== 'string' || !isPlaceholderFormatType(parsed.t)) {
      return null
    }
    return normalizePlaceholderFormat(parsed)
  } catch {
    return null
  }
}

/**
 * Normalize a format payload before it is retained in editor JSON or HTML.
 *
 * This makes the node state and rendered span obey the same allow-list, so a
 * runtime-only option such as a resolver-provided timezone cannot be saved by
 * a caller that updates node attributes directly.
 */
export function normalizePlaceholderFormat(payload: {
  v?: unknown
  t?: unknown
  o?: unknown
}): PlaceholderFormatPayload | null {
  if (payload.v !== 1 || typeof payload.t !== 'string' || !isPlaceholderFormatType(payload.t)) {
    return null
  }
  const options = normalizeOptions(payload.t, payload.o)
  return options ? { v: 1, t: payload.t, o: options } : null
}

/** Return the override when it applies to the resolved field type. */
export function getPlaceholderFormatOptions(
  payload: PlaceholderFormatPayload | null,
  fieldType: string
): Partial<FieldOptions> | undefined {
  return payload?.t === fieldType ? payload.o : undefined
}

/** Normalize only the field options supported by the matching display editor. */
function normalizeOptions(
  fieldType: PlaceholderFormatType,
  input: unknown
): Partial<FieldOptions> | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null
  const value = input as Record<string, unknown>

  switch (fieldType) {
    case 'NUMBER':
      return pickNumberOptions(value)
    case 'CURRENCY':
      return { ...pickNumberOptions(value), ...pickCurrencyOptions(value) }
    case 'DATE':
    case 'DATETIME':
    case 'TIME':
      return pickDateOptions(value, fieldType)
    case 'CHECKBOX':
      return pickCheckboxOptions(value)
    case 'PHONE_INTL':
      return pickPhoneOptions(value)
    case 'URL':
      return pickUrlOptions(value)
  }
}

/** Select valid number display options. */
function pickNumberOptions(value: Record<string, unknown>): Partial<FieldOptions> {
  const options: Partial<FieldOptions> = {}
  if (typeof value.decimals === 'number' && Number.isInteger(value.decimals)) {
    options.decimals = value.decimals
  }
  if (typeof value.useGrouping === 'boolean') options.useGrouping = value.useGrouping
  if (isOneOf(value.displayAs, ['number', 'percentage', 'compact', 'bytes'])) {
    options.displayAs = value.displayAs
  }
  if (typeof value.prefix === 'string') options.prefix = value.prefix
  if (typeof value.suffix === 'string') options.suffix = value.suffix
  return options
}

/** Select valid currency-specific display options. */
function pickCurrencyOptions(value: Record<string, unknown>): Partial<FieldOptions> {
  const options: Partial<FieldOptions> = {}
  if (typeof value.currencyCode === 'string') options.currencyCode = value.currencyCode
  if (isOneOf(value.currencyDisplay, ['symbol', 'code', 'name', 'compact'])) {
    options.currencyDisplay = value.currencyDisplay
  }
  return options
}

/** Select valid date and time display options without permitting timezone overrides. */
function pickDateOptions(
  value: Record<string, unknown>,
  fieldType: 'DATE' | 'DATETIME' | 'TIME'
): Partial<FieldOptions> {
  const options: Partial<FieldOptions> = {}
  if (
    fieldType !== 'TIME' &&
    isOneOf(value.format, ['short', 'medium', 'long', 'relative', 'iso'])
  ) {
    options.format = value.format
  }
  if (fieldType !== 'DATE' && isOneOf(value.timeFormat, ['12h', '24h'])) {
    options.timeFormat = value.timeFormat
  }
  return options
}

/** Select valid checkbox display options. */
function pickCheckboxOptions(value: Record<string, unknown>): Partial<FieldOptions> {
  const options: Partial<FieldOptions> = {}
  if (isOneOf(value.checkboxStyle, ['icon', 'text', 'icon-text'])) {
    options.checkboxStyle = value.checkboxStyle
  }
  if (typeof value.trueLabel === 'string') options.trueLabel = value.trueLabel
  if (typeof value.falseLabel === 'string') options.falseLabel = value.falseLabel
  return options
}

/** Select a valid phone display option. */
function pickPhoneOptions(value: Record<string, unknown>): Partial<FieldOptions> {
  return isOneOf(value.phoneFormat, ['raw', 'national', 'international'])
    ? { phoneFormat: value.phoneFormat }
    : {}
}

/** Select a valid URL display option. */
function pickUrlOptions(value: Record<string, unknown>): Partial<FieldOptions> {
  return isOneOf(value.urlDisplay, ['link', 'image']) ? { urlDisplay: value.urlDisplay } : {}
}

/** Narrow an unknown value to one literal from an allowed list. */
function isOneOf<const T extends string>(value: unknown, allowed: readonly T[]): value is T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value)
}
