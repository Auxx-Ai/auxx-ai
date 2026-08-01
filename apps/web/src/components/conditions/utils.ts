// apps/web/src/components/conditions/utils.ts

import { OPERATOR_DEFINITIONS, type Operator } from '@auxx/lib/conditions/client'
import { BaseType, getOperatorsForType } from '@auxx/lib/workflow-engine/client'

/**
 * Encode a fieldId (string or FieldPath array) into a stable string key for Map lookups.
 * This is ONLY for internal cache keys — never pass encoded keys to picker APIs.
 */
export function encodeFieldIdKey(fieldId: string | string[]): string {
  return Array.isArray(fieldId) ? fieldId.join('::') : fieldId
}

/**
 * Narrow an arbitrary picker/definition key to the operator vocabulary.
 *
 * `OperatorDefinition.key` is declared as a plain `string` in lib, and pickers hand
 * back raw `string[]` selections — this is the one place that checks a key really is
 * a live operator before it is written into a `Condition`.
 */
export function isOperator(key: string): key is Operator {
  return key in OPERATOR_DEFINITIONS
}

/**
 * Get the default operator for a field type
 */
export const getDefaultOperatorForType = (fieldType: BaseType): Operator => {
  const operators = getOperatorsForType(fieldType)

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
