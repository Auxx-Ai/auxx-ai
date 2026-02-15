// apps/web/src/components/workflow/nodes/core/crud/validation.ts

import { RelationUpdateMode } from '@auxx/types/custom-field'
import type { CrudNodeData } from './types'

/**
 * Validation result interface
 */
export interface ValidationResult {
  isValid: boolean
  errors: Array<{ field: string; message: string; type?: 'warning' | 'error' }>
}

/**
 * Validation function for CRUD node configuration
 * Now supports both system resources and custom entities (dynamic resources)
 */
export const validateCrudNodeConfig = (data: CrudNodeData): ValidationResult => {
  const errors: Array<{ field: string; message: string; type?: 'warning' | 'error' }> = []

  // Guard against undefined/null data
  if (!data) {
    return {
      isValid: false,
      errors: [{ field: 'data', message: 'Node data is missing', type: 'error' }],
    }
  }

  // Basic field validation
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

  // Validate resource type - now accepts any string (system or custom entity)
  if (!data.resourceType) {
    errors.push({ field: 'resourceType', message: 'Resource type is required', type: 'error' })
    return { isValid: false, errors }
  }

  // Validate operation mode
  if (!data.mode) {
    errors.push({ field: 'mode', message: 'Operation mode is required', type: 'error' })
    return { isValid: false, errors }
  }

  if (!['create', 'update', 'delete'].includes(data.mode)) {
    errors.push({
      field: 'mode',
      message: 'Operation mode must be create, update, or delete',
      type: 'error',
    })
    return { isValid: false, errors }
  }

  // Validate resource ID for update/delete operations
  if ((data.mode === 'update' || data.mode === 'delete') && !data.resourceId?.trim()) {
    errors.push({
      field: 'resourceId',
      message: 'Resource ID is required for update and delete operations',
      type: 'error',
    })
  }

  // Warning if no field data is provided for create/update (delete doesn't need data)
  if (data.mode !== 'delete') {
    if (!data.data || Object.keys(data.data).length === 0) {
      errors.push({
        field: 'data',
        message: `No field data provided for ${data.mode} operation`,
        type: 'warning',
      })
    }
  }

  // Warning for delete operations
  if (data.mode === 'delete' && data.resourceId?.trim()) {
    errors.push({
      field: 'resourceId',
      message: 'Delete operations are irreversible. Ensure you have the correct resource ID.',
      type: 'warning',
    })
  }

  // Validate relation update modes
  if (data.fieldUpdateModes) {
    for (const [fieldKey, mode] of Object.entries(data.fieldUpdateModes)) {
      // Dynamic mode requires a mode variable
      if (mode === RelationUpdateMode.DYNAMIC && !data.fieldUpdateModeVars?.[fieldKey]) {
        errors.push({
          field: `data.${fieldKey}`,
          message: 'Dynamic mode requires a mode variable',
          type: 'warning',
        })
      }
    }
  }

  return { isValid: errors.filter((e) => e.type === 'error').length === 0, errors }
}
