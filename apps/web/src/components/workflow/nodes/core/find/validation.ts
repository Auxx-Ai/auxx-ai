// apps/web/src/components/workflow/nodes/core/find/validation.ts

import { isCustomResourceId } from '@auxx/lib/resources/client'
import { FIND_RESOURCE_CONFIGS, getOperatorsForType } from '@auxx/lib/workflow-engine/client'
import { validateCondition } from '~/components/conditions'
import {
  createFindNodeDefaultData,
  type FindNodeData,
  findNodeDataSchema,
  type ValidationResult,
} from './types'

/**
 * Validation function following the same pattern as other nodes
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

    // Validate limit for findMany
    if (data.findMode === 'findMany' && data.limit) {
      if (data.limit < 1) {
        errors.push({ field: 'limit', message: 'Limit must be at least 1', type: 'error' })
      } else if (data.limit > 1000) {
        errors.push({ field: 'limit', message: 'Limit cannot exceed 1000', type: 'error' })
      }
    }

    return { isValid: errors.filter((e) => e.type === 'error').length === 0, errors }
  }

  // System resource validation using FIND_RESOURCE_CONFIGS
  const resourceConfig = FIND_RESOURCE_CONFIGS[data.resourceType]
  if (!resourceConfig) {
    errors.push({ field: 'resourceType', message: 'Invalid resource type', type: 'error' })
    return { isValid: false, errors }
  }

  // Validate conditions using generic validation
  if (data.conditions && resourceConfig) {
    data.conditions.forEach((condition, index) => {
      // Find the field definition for this condition
      const fieldDef = resourceConfig.filterableFields.find(
        (field) => field.key === condition.fieldId
      )

      if (!fieldDef) {
        errors.push({
          field: `conditions.${index}.fieldId`,
          message: `Field "${condition.fieldId}" is not available for resource type "${data.resourceType}"`,
          type: 'error',
        })
        return
      }

      // Convert to the format expected by validateCondition
      const fieldDefinition = {
        id: fieldDef.key,
        label: fieldDef.label,
        type: fieldDef.type,
        operators: getOperatorsForType(fieldDef.type, fieldDef.operatorOverrides),
        options: fieldDef.options,
      } as const

      const conditionValidation = validateCondition(condition, fieldDefinition)
      if (!conditionValidation.isValid) {
        conditionValidation.errors.forEach((error) => {
          errors.push({
            field: `conditions.${index}`,
            message: error,
            type: 'error',
          })
        })
      }

      // Additional validation for enum fields
      if (fieldDef.type === 'enum' && fieldDef.options?.length && condition.value) {
        const value = String(condition.value)
        if (!['empty', 'not empty', 'exists', 'not exists'].includes(condition.operator)) {
          // Check if value matches any value in the options
          const validValues = fieldDef.options.map((opt) => opt.value)
          if (!validValues.includes(value)) {
            const validLabels = fieldDef.options.map((opt) => opt.label).join(', ')
            errors.push({
              field: `conditions.${index}.value`,
              message: `Value "${value}" is not a valid option for field "${fieldDef.label}". Valid values: ${validLabels}`,
              type: 'error',
            })
          }
        }
      }

      // Validate operator is supported for the field
      const validOperators = getOperatorsForType(fieldDef.type, fieldDef.operatorOverrides)
      if (condition.operator && !validOperators.includes(condition.operator)) {
        errors.push({
          field: `conditions.${index}.operator`,
          message: `Operator "${condition.operator}" is not supported for field "${fieldDef.label}"`,
          type: 'error',
        })
      }
    })
  }

  // Validate condition groups using generic validation
  if (data.conditionGroups && resourceConfig) {
    data.conditionGroups.forEach((group, groupIndex) => {
      // Validate each condition in the group
      group.conditions.forEach((condition, conditionIndex) => {
        // Find the field definition for this condition
        const fieldDef = resourceConfig.filterableFields.find(
          (field) => field.key === condition.fieldId
        )

        if (!fieldDef) {
          errors.push({
            field: `conditionGroups.${groupIndex}.conditions.${conditionIndex}.fieldId`,
            message: `Field "${condition.fieldId}" is not available for resource type "${data.resourceType}"`,
            type: 'error',
          })
          return
        }

        // Convert to the format expected by validateCondition
        const fieldDefinition = {
          id: fieldDef.key,
          label: fieldDef.label,
          type: fieldDef.type,
          operators: getOperatorsForType(fieldDef.type, fieldDef.operatorOverrides),
          options: fieldDef.options,
        }

        const conditionValidation = validateCondition(condition, fieldDefinition)
        if (!conditionValidation.isValid) {
          conditionValidation.errors.forEach((error) => {
            errors.push({
              field: `conditionGroups.${groupIndex}.conditions.${conditionIndex}`,
              message: error,
              type: 'error',
            })
          })
        }

        // Additional validation for enum fields
        if (fieldDef.type === 'enum' && fieldDef.options?.length && condition.value) {
          const value = String(condition.value)
          if (!['empty', 'not empty', 'exists', 'not exists'].includes(condition.operator)) {
            const validValues = fieldDef.options.map((opt) => opt.value)
            if (!validValues.includes(value)) {
              const validLabels = fieldDef.options.map((opt) => opt.label).join(', ')
              errors.push({
                field: `conditionGroups.${groupIndex}.conditions.${conditionIndex}.value`,
                message: `Value "${value}" is not a valid option for field "${fieldDef.label}". Valid values: ${validLabels}`,
                type: 'error',
              })
            }
          }
        }

        // Validate operator is supported for the field
        const validOperators = getOperatorsForType(fieldDef.type, fieldDef.operatorOverrides)
        if (condition.operator && !validOperators.includes(condition.operator)) {
          errors.push({
            field: `conditionGroups.${groupIndex}.conditions.${conditionIndex}.operator`,
            message: `Operator "${condition.operator}" is not supported for field "${fieldDef.label}"`,
            type: 'error',
          })
        }
      })
    })
  }

  // Validate orderBy field
  if (data.orderBy) {
    const sortableField = resourceConfig.sortableFields.find((f) => f.key === data.orderBy!.field)
    if (!sortableField) {
      errors.push({
        field: 'orderBy.field',
        message: `Field ${data.orderBy.field} is not sortable for ${resourceConfig.label}`,
        type: 'error',
      })
    }
  }

  // Validate limit for findMany
  if (data.findMode === 'findMany' && data.limit) {
    if (data.limit < 1) {
      errors.push({ field: 'limit', message: 'Limit must be at least 1', type: 'error' })
    } else if (data.limit > 1000) {
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
