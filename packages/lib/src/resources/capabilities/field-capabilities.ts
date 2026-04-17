// packages/lib/src/resources/capabilities/field-capabilities.ts

import type { ResourceField } from '../registry/field-types'

/**
 * Check if a field is hidden from user-facing UI.
 * Hidden fields exist in the registry but never appear in pickers, forms,
 * tables, or panels. System code can still read/write them.
 */
export function isFieldHidden(field: ResourceField | null | undefined): boolean {
  return field?.capabilities.hidden === true
}

/**
 * Check if a field can be updated.
 * Returns false for computed fields or fields marked as non-updatable.
 */
export function canUpdateField(field: ResourceField | null | undefined): boolean {
  if (!field) return false
  if (field.capabilities.computed) return false
  return field.capabilities.updatable !== false
}

/**
 * Check if a field can be used for sorting in user-facing UI.
 */
export function canSortField(field: ResourceField | null | undefined): boolean {
  if (!field || field.capabilities.hidden) return false
  return field.capabilities.sortable !== false
}

/**
 * Check if a field can be used in filters in user-facing UI.
 */
export function canFilterField(field: ResourceField | null | undefined): boolean {
  if (!field || field.capabilities.hidden) return false
  return field.capabilities.filterable !== false
}

/**
 * Check if a field can be set during record creation
 */
export function canCreateField(field: ResourceField | null | undefined): boolean {
  if (!field) return false
  if (field.capabilities.computed) return false
  return field.capabilities.creatable !== false
}
