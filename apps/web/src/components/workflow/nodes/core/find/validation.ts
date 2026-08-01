// apps/web/src/components/workflow/nodes/core/find/validation.ts

import { isCustomResourceId } from '@auxx/lib/resources/client'
import { createFindNodeDefaultData, type FindNodeData, type ValidationResult } from './types'

/**
 * Validation function following the same pattern as other nodes.
 *
 * Deliberately does **not** check field references. This function only receives
 * `data`, so the only vocabulary available to it is the static
 * `FIND_RESOURCE_CONFIGS[type].filterableFields` — which cannot see the org's
 * `CustomField` rows, and therefore rejects fields the panel itself offers.
 * (A ~180-line commented-out attempt at exactly that lived here until
 * 2026-08-01; it was removed rather than revived, because reviving it would
 * reintroduce a third field vocabulary alongside the panel's merged
 * `fieldDefinitions` and the server's canonicalized refs.)
 *
 * Field validation belongs to `FindProcessor.validateNodeConfig`, which reads
 * the same canonical references the query builders do.
 */
export const validateFindNodeConfig = (data: FindNodeData): ValidationResult => {
  const errors: Array<{ field: string; message: string; type?: 'warning' | 'error' }> = []

  // Additional custom validation
  if (!data.title?.trim()) {
    errors.push({ field: 'title', message: 'Title is required', type: 'error' })
  }

  // Check if title is too long
  if (data.title && data.title.length > 100) {
    errors.push({
      field: 'title',
      message: 'Title is too long (max 100 characters)',
      type: 'warning',
    })
  }

  // Validate description length if provided
  if (data.description && data.description.length > 500) {
    errors.push({
      field: 'description',
      message: 'Description is too long (max 500 characters)',
      type: 'warning',
    })
  }

  // Validate resource type
  if (!data.resourceType) {
    errors.push({ field: 'resourceType', message: 'Resource type is required', type: 'error' })
    return { isValid: false, errors }
  }

  // For custom entities, skip static config validation - runtime validation will handle it
  if (isCustomResourceId(data.resourceType)) {
    // Basic validation for custom entities
    const hasConditions =
      (data.conditions && data.conditions.length > 0) ||
      (data.conditionGroups && data.conditionGroups.length > 0)

    if (!hasConditions) {
      errors.push({
        field: 'conditions',
        message:
          'No conditions applied - will return all records (limited by default/specified limit)',
        type: 'warning',
      })
    }

    // Validate limit for findMany. A variable-bound limit is a reference
    // string that only resolves at run time, so there is nothing to check.
    const limit = typeof data.limit === 'number' ? data.limit : Number(data.limit)
    if (data.findMode === 'findMany' && data.limit && !Number.isNaN(limit)) {
      if (limit < 1) {
        errors.push({ field: 'limit', message: 'Limit must be at least 1', type: 'error' })
      } else if (limit > 1000) {
        errors.push({ field: 'limit', message: 'Limit cannot exceed 1000', type: 'error' })
      }
    }

    return { isValid: errors.filter((e) => e.type === 'error').length === 0, errors }
  }

  // Validate limit for findMany. A variable-bound limit is a reference string
  // that only resolves at run time, so there is nothing to check.
  const limit = typeof data.limit === 'number' ? data.limit : Number(data.limit)
  if (data.findMode === 'findMany' && data.limit && !Number.isNaN(limit)) {
    if (limit < 1) {
      errors.push({ field: 'limit', message: 'Limit must be at least 1', type: 'error' })
    } else if (limit > 1000) {
      errors.push({ field: 'limit', message: 'Limit cannot exceed 1000', type: 'error' })
    }
  }

  // Warning if findOne has multiple conditions that might not return expected results
  if (data.findMode === 'findOne' && data.conditions && data.conditions.length > 3) {
    errors.push({
      field: 'conditions',
      message: 'Consider using fewer conditions for findOne mode to ensure predictable results',
      type: 'warning',
    })
  }

  // Warning if no conditions are provided
  const hasConditions =
    (data.conditions && data.conditions.length > 0) ||
    (data.conditionGroups && data.conditionGroups.length > 0)

  if (!hasConditions) {
    errors.push({
      field: 'conditions',
      message:
        'No conditions applied - will return all records (limited by default/specified limit)',
      type: 'warning',
    })
  }

  return { isValid: errors.filter((e) => e.type === 'error').length === 0, errors }
}

export { createFindNodeDefaultData }
