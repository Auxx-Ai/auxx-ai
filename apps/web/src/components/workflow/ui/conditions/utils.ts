// apps/web/src/components/workflow/ui/conditions/utils.ts

import type {
  GenericCondition,
  ConditionGroup,
  FieldDefinition,
  OperatorDefinition,
  ConditionSystemConfig,
} from './types'
import { STANDARD_OPERATORS } from './types'
import type { UnifiedVariable } from '~/components/workflow/types/variable-types'
import { BaseType } from '@auxx/lib/workflow-engine/types'
import { getOperatorsForType } from '@auxx/lib/workflow-engine/client'

/**
 * Convert UnifiedVariable to FieldDefinition for variable-based systems
 */
export const convertVariableToFieldDefinition = (variable: UnifiedVariable): FieldDefinition => {
  return {
    id: variable.id,
    label: variable.label || variable.id,
    type: variable.type,
    operators: getOperatorsForType(variable.type), // ✅ Use TYPE_OPERATOR_MAP
    variable,
    placeholder: `Select ${variable.label || 'variable'}`,
    description: variable.description,
  }
}

/**
 * Convert array of UnifiedVariables to FieldDefinitions
 */
export const convertVariablesToFieldDefinitions = (
  variables: UnifiedVariable[]
): FieldDefinition[] => {
  return variables.map(convertVariableToFieldDefinition)
}

/**
 * Get operator definitions for a specific field type
 */
export const getOperatorDefinitionsForType = (fieldType: BaseType): OperatorDefinition[] => {
  const operatorKeys = getOperatorsForType(fieldType)
  return operatorKeys
    .map((key) => STANDARD_OPERATORS[key])
    .filter((op): op is OperatorDefinition => op !== undefined)
}

/**
 * Check if an operator requires a value input
 */
export const doesOperatorRequireValue = (operator: string): boolean => {
  const operatorDef = STANDARD_OPERATORS[operator]
  return operatorDef ? operatorDef.requiresValue : true
}

/**
 * Get the default operator for a field type
 */
export const getDefaultOperatorForType = (fieldType: BaseType): string => {
  const operators = getOperatorsForType(fieldType)

  // Prefer common operators based on type
  switch (fieldType) {
    case BaseType.STRING:
    case BaseType.EMAIL:
    case BaseType.URL:
    case BaseType.PHONE:
    case BaseType.ANY:
      return operators.includes('contains') ? 'contains' : operators[0] || 'is'
    case BaseType.NUMBER:
    case BaseType.DATE:
    case BaseType.DATETIME:
      return operators.includes('is') ? 'is' : operators[0] || 'is'
    case BaseType.BOOLEAN:
      return operators.includes('is') ? 'is' : operators[0] || 'is'
    default:
      return operators[0] || 'is'
  }
}

/**
 * Validate a condition based on its configuration
 */
export const validateCondition = (
  condition: GenericCondition,
  fieldDefinition?: FieldDefinition
): { isValid: boolean; errors: string[] } => {
  const errors: string[] = []

  // Check if field is selected
  if (!condition.fieldId) {
    errors.push('Field is required')
  }

  // Check if operator is selected
  if (!condition.operator) {
    errors.push('Operator is required')
  }

  // Check if value is required and provided
  if (condition.operator && doesOperatorRequireValue(condition.operator)) {
    if (condition.value === '' || condition.value === null || condition.value === undefined) {
      errors.push('Value is required for this operator')
    }
  }

  // Type-specific validation
  if (
    fieldDefinition &&
    condition.value !== '' &&
    condition.value !== null &&
    condition.value !== undefined
  ) {
    switch (fieldDefinition.type) {
      case 'number':
        if (typeof condition.value === 'string' && isNaN(Number(condition.value))) {
          errors.push('Value must be a number')
        }
        break
      case 'boolean':
        const boolValue = condition.value?.toString().toLowerCase()
        if (boolValue !== 'true' && boolValue !== 'false') {
          errors.push('Value must be true or false')
        }
        break
      case 'date':
      case 'datetime':
        if (typeof condition.value === 'string' && isNaN(Date.parse(condition.value))) {
          errors.push('Value must be a valid date')
        }
        break
    }
  }

  return {
    isValid: errors.length === 0,
    errors,
  }
}

/**
 * Validate all conditions in a group
 */
export const validateConditionGroup = (
  group: ConditionGroup,
  getFieldDefinition: (fieldId: string) => FieldDefinition | undefined
): { isValid: boolean; errors: Array<{ conditionId: string; errors: string[] }> } => {
  const conditionErrors: Array<{ conditionId: string; errors: string[] }> = []

  group.conditions.forEach((condition) => {
    const fieldDef = getFieldDefinition(condition.fieldId)
    const validation = validateCondition(condition, fieldDef)

    if (!validation.isValid) {
      conditionErrors.push({
        conditionId: condition.id,
        errors: validation.errors,
      })
    }
  })

  return {
    isValid: conditionErrors.length === 0,
    errors: conditionErrors,
  }
}

/**
 * Create a default condition for a field
 */
export const createDefaultCondition = (
  fieldId: string,
  fieldDefinition?: FieldDefinition
): Omit<GenericCondition, 'id'> => {
  const fieldType = fieldDefinition?.type || 'any'
  const defaultOperator = getDefaultOperatorForType(fieldType)

  return {
    fieldId,
    operator: defaultOperator,
    value: '',
    variableId: fieldId, // For backward compatibility
  }
}

/**
 * Create a default condition group
 */
export const createDefaultConditionGroup = (): Omit<ConditionGroup, 'id'> => {
  return {
    conditions: [],
    logicalOperator: 'AND',
  }
}

/**
 * Clean up condition values based on operator changes
 */
export const cleanupConditionValue = (condition: GenericCondition, newOperator: string): any => {
  const operatorDef = STANDARD_OPERATORS[newOperator]

  if (!operatorDef || !operatorDef.requiresValue) {
    return ''
  }

  // Keep existing value if operator still requires value
  return condition.value
}

/**
 * Convert between different condition data formats for backward compatibility
 */
export const convertLegacyCondition = (legacyCondition: any): GenericCondition => {
  return {
    id: legacyCondition.id,
    fieldId: legacyCondition.variableId || legacyCondition.fieldId,
    operator: legacyCondition.comparison_operator || legacyCondition.operator,
    value: legacyCondition.value,
    logicalOperator: legacyCondition.logicalOperator,
    key: legacyCondition.key,
    subConditions: legacyCondition.subConditions,
    metadata: legacyCondition.metadata,
    numberVarType: legacyCondition.numberVarType,
    variableId: legacyCondition.variableId,
  }
}

/**
 * Convert generic condition back to legacy format
 */
export const convertToLegacyCondition = (condition: GenericCondition): any => {
  return {
    id: condition.id,
    variableId: condition.variableId || condition.fieldId,
    comparison_operator: condition.operator,
    value: condition.value,
    logicalOperator: condition.logicalOperator,
    key: condition.key,
    subConditions: condition.subConditions,
    metadata: condition.metadata,
    numberVarType: condition.numberVarType,
  }
}

/**
 * Deep clone a condition to prevent mutation issues
 */
export const cloneCondition = (condition: GenericCondition): GenericCondition => {
  return JSON.parse(JSON.stringify(condition))
}

/**
 * Deep clone a condition group to prevent mutation issues
 */
export const cloneConditionGroup = (group: ConditionGroup): ConditionGroup => {
  return JSON.parse(JSON.stringify(group))
}

/**
 * Check if two conditions are equal (useful for optimization)
 */
export const areConditionsEqual = (a: GenericCondition, b: GenericCondition): boolean => {
  return JSON.stringify(a) === JSON.stringify(b)
}

/**
 * Generate a human-readable description of a condition
 */
export const describeCondition = (
  condition: GenericCondition,
  fieldDefinition?: FieldDefinition
): string => {
  const fieldName = fieldDefinition?.label || condition.fieldId
  const operatorDef = STANDARD_OPERATORS[condition.operator]
  const operatorName = operatorDef?.label || condition.operator

  if (!operatorDef || !operatorDef.requiresValue) {
    return `${fieldName} ${operatorName}`
  }

  let valueDescription = String(condition.value)
  if (Array.isArray(condition.value)) {
    valueDescription = condition.value.join(', ')
  }

  return `${fieldName} ${operatorName} ${valueDescription}`
}

/**
 * Generate a human-readable description of a condition group
 */
export const describeConditionGroup = (
  group: ConditionGroup,
  getFieldDefinition: (fieldId: string) => FieldDefinition | undefined
): string => {
  if (group.conditions.length === 0) {
    return 'Empty group'
  }

  if (group.conditions.length === 1) {
    const fieldDef = getFieldDefinition(group.conditions[0].fieldId)
    return describeCondition(group.conditions[0], fieldDef)
  }

  const descriptions = group.conditions.map((condition) => {
    const fieldDef = getFieldDefinition(condition.fieldId)
    return describeCondition(condition, fieldDef)
  })

  const operator = group.logicalOperator.toLowerCase()
  return descriptions.join(` ${operator} `)
}
