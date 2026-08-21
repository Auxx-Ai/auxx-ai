// packages/lib/src/resources/registry/option-helpers.ts

import type { SelectOptionColor } from '@auxx/types/custom-field'
import type { FieldOptions } from '../../field-values/converters'
import type { ResourceField } from './field-types'

/**
 * Single option item type extracted from FieldOptions.
 * This is the unified option format used throughout the system.
 */
export type FieldOptionItem = NonNullable<FieldOptions['options']>[number]

/**
 * Get options from a field (null-safe).
 * Returns options from field.options.options.
 * @param field - The resource field
 * @returns Array of field option items, or empty array if none
 */
export function getFieldOptions(field: ResourceField | null | undefined): FieldOptionItem[] {
  return field?.options?.options ?? []
}

/**
 * The id a `FieldValue` stores for an option row: `id` when present, else `value`.
 *
 * This is the WRITE rule. Reads must stay tolerant of both keyspaces
 * ({@link buildOptionIndex}), because rows written before an option gained an
 * explicit `id` still hold its `value`.
 *
 * @param option - The option row
 * @returns The key a stored value would carry, or undefined when the row has neither
 */
export function optionKey(option: FieldOptionItem | null | undefined): string | undefined {
  if (!option) return undefined
  const key = option.id ?? option.value
  return key ? key : undefined
}

/**
 * Index an option list by BOTH keyspaces (`id` and `value`), first writer winning.
 *
 * Every consumer resolves N stored ids against ONE list — a table cell renders a
 * whole column, `resolveGroupLabels` a whole axis, the options diff a whole field.
 * Build the index once; never `.find()` per id.
 *
 * Both keys are registered because a stored id can be either: `id` for
 * app/connector-provisioned option sets, `value` for everything minted in the
 * product. Matching only one keyspace silently orphans live values.
 *
 * @param options - The field's current option list
 * @returns A map from either key onto the option row that owns it
 */
export function buildOptionIndex(options: FieldOptionItem[]): Map<string, FieldOptionItem> {
  const index = new Map<string, FieldOptionItem>()
  for (const option of options) {
    if (!option) continue
    // `id` before `value` so an option's own primary key wins its own row; the
    // `has` guard makes a cross-option collision resolve to the earlier option
    // rather than to whichever happened to be indexed last.
    if (option.id && !index.has(option.id)) index.set(option.id, option)
    if (option.value && !index.has(option.value)) index.set(option.value, option)
  }
  return index
}

/**
 * The outcome of resolving one stored `optionId` against a field's option set.
 *
 * `unknown` is returned rather than a pre-rendered fallback string because not
 * every consumer has a chip to mute — copy/paste puts the value in the clipboard,
 * timeline snapshots have their own denormalized fallback.
 */
export type ResolvedOption =
  | { status: 'known'; optionId: string; label: string; color?: SelectOptionColor }
  /** No option in the field's current set matches. `raw` is what's stored. */
  | { status: 'unknown'; optionId: string; raw: string }

/**
 * Resolve one stored option id against a field's option set, matching EITHER
 * keyspace (`id` or `value`).
 *
 * Deliberately does NOT match on `label`: label tolerance belongs to the write
 * path ({@link findOptionKey}), where a human or an import supplies a name. A
 * stored id that happens to equal another option's label is not that option.
 *
 * @param optionId - The stored key
 * @param source - The field's options, or a prebuilt {@link buildOptionIndex}
 * @returns A discriminated result; `unknown` preserves the raw stored value
 */
export function resolveOptionId(
  optionId: string,
  source: FieldOptionItem[] | Map<string, FieldOptionItem>
): ResolvedOption {
  const index = Array.isArray(source) ? buildOptionIndex(source) : source
  const option = index.get(optionId)
  if (!option) return { status: 'unknown', optionId, raw: optionId }
  return {
    status: 'known',
    optionId,
    label: option.label ?? option.value ?? optionId,
    color: option.color,
  }
}

/**
 * Resolve many stored option ids against one option set.
 *
 * Builds the index once — the whole reason {@link buildOptionIndex} exists.
 *
 * @param ids - The stored keys, in order
 * @param options - The field's current option list
 * @returns One {@link ResolvedOption} per input id, in the same order
 */
export function resolveOptionIds(ids: string[], options: FieldOptionItem[]): ResolvedOption[] {
  const index = buildOptionIndex(options)
  return ids.map((id) => resolveOptionId(id, index))
}

/**
 * Fold a label onto its match key. Case- and whitespace-insensitive, so
 * `Enterprise`, `enterprise` and ` Enterprise ` all collapse onto one option.
 *
 * @param label - The raw label
 * @returns The folded match key
 */
export function optionMatchKey(label: string): string {
  return label.trim().replace(/\s+/g, ' ').toLowerCase()
}

/**
 * Label → option key, for WRITE paths (imports, connectors, paste, AI autofill).
 *
 * Exact matches on either keyspace win first, then a case- and whitespace-folded
 * match on `label` and `value`. Tolerance here is intentional and one-directional:
 * a write saying `enterprise` should land on the existing `Enterprise` rather than
 * mint a label-shaped orphan. Read paths must NOT use this.
 *
 * @param query - The incoming string (a label, value or id)
 * @param options - The field's current option list
 * @returns The key to store ({@link optionKey}), or undefined when nothing matches
 */
export function findOptionKey(query: string, options: FieldOptionItem[]): string | undefined {
  if (!query || options.length === 0) return undefined

  const exact = query.trim()
  for (const option of options) {
    if (!option) continue
    if (option.id === exact || option.value === exact) return optionKey(option)
  }

  const folded = optionMatchKey(query)
  if (folded === '') return undefined
  for (const option of options) {
    if (!option) continue
    const label = option.label ?? ''
    const value = option.value ?? ''
    if (optionMatchKey(label) === folded || optionMatchKey(value) === folded) {
      return optionKey(option)
    }
  }

  return undefined
}

/**
 * Check if a value is valid for a field's options.
 * Accepts both value (e.g., 'MEDIUM') and label (e.g., 'Medium') formats.
 *
 * Keyspace: the STATIC `RESOURCE_FIELD_REGISTRY` (value-as-label options such as
 * `'MEDIUM'`). For stored custom-field option ids use {@link resolveOptionId}
 * (read) or {@link findOptionKey} (write).
 *
 * @param field - The resource field
 * @param value - The value to validate
 * @returns True if value is valid or field has no options
 */
export function isValidOptionValue(
  field: ResourceField | null | undefined,
  value: string
): boolean {
  const options = getFieldOptions(field)
  if (options.length === 0) return true
  return options.some((opt) => opt.value === value || opt.label === value)
}

/**
 * Get option label for a stored value.
 * @param field - The resource field
 * @param value - The stored value (either keyspace)
 * @returns The option label, or the value itself if not found
 */
export function getOptionLabel(field: ResourceField | null | undefined, value: string): string {
  const resolved = resolveOptionId(value, getFieldOptions(field))
  return resolved.status === 'known' ? resolved.label : resolved.raw
}

/**
 * Convert label(s) to stored value(s).
 *
 * Keyspace: the STATIC `RESOURCE_FIELD_REGISTRY` (exact, case-sensitive, `value`
 * only). Custom-field write paths want {@link findOptionKey} instead.
 *
 * @param options - Array of field options
 * @param label - Single label or array of labels
 * @returns Single value or array of values
 */
export function labelToValue(
  options: FieldOptionItem[],
  label: string | string[]
): string | string[] {
  if (Array.isArray(label)) return label.map((l) => labelToValue(options, l) as string)
  return options.find((opt) => opt.label === label)?.value ?? label
}

/**
 * Check if field has options.
 * @param field - The resource field
 * @returns True if field has at least one option
 */
export function hasOptions(field: ResourceField | null | undefined): boolean {
  return (field?.options?.options?.length ?? 0) > 0
}
