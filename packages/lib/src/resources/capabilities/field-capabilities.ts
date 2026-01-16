// packages/lib/src/resources/capabilities/field-capabilities.ts

import type { ResourceField } from '../registry/field-types'

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
 * Check if a field can be used for sorting
 */
export function canSortField(field: ResourceField | null | undefined): boolean {
  return field?.capabilities.sortable !== false
}

/**
 * Check if a field can be used in filters
 */
export function canFilterField(field: ResourceField | null | undefined): boolean {
  return field?.capabilities.filterable !== false
}

/**
 * Check if a field can be set during record creation
 */
export function canCreateField(field: ResourceField | null | undefined): boolean {
  if (!field) return false
  if (field.capabilities.computed) return false
  return field.capabilities.creatable !== false
}
