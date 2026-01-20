// packages/lib/src/resources/registry/option-helpers.ts

import type { ResourceField } from './field-types'
import type { FieldOptions } from '../../field-values/converters'

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
 * Check if a value is valid for a field's options.
 * Accepts both value (e.g., 'MEDIUM') and label (e.g., 'Medium') formats.
 * @param field - The resource field
 * @param value - The value to validate
 * @returns True if value is valid or field has no options
 */
export function isValidOptionValue(field: ResourceField | null | undefined, value: string): boolean {
  const options = getFieldOptions(field)
  if (options.length === 0) return true
  return options.some((opt) => opt.value === value || opt.label === value)
}

/**
 * Get option label for a stored value.
 * @param field - The resource field
 * @param value - The stored value
 * @returns The option label, or the value itself if not found
 */
export function getOptionLabel(field: ResourceField | null | undefined, value: string): string {
  const options = getFieldOptions(field)
  return options.find((opt) => opt.value === value)?.label ?? value
}

/**
 * Convert label(s) to stored value(s).
 * @param options - Array of field options
 * @param label - Single label or array of labels
 * @returns Single value or array of values
 */
export function labelToValue(options: FieldOptionItem[], label: string | string[]): string | string[] {
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
