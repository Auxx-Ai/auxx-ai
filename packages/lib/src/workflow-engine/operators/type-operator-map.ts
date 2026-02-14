// packages/lib/src/workflow-engine/operators/type-operator-map.ts

import { OPERATOR_DEFINITIONS, type Operator } from '../../conditions/operator-definitions'
import { BaseType } from '../core/types'

/**
 * Defines valid operators for each BaseType.
 * Now derived from OPERATOR_DEFINITIONS for consistency.
 */
export const TYPE_OPERATOR_MAP: Record<BaseType, Operator[]> = {
  [BaseType.STRING]: getOperatorKeysForType(BaseType.STRING),
  [BaseType.EMAIL]: getOperatorKeysForType(BaseType.EMAIL),
  [BaseType.URL]: getOperatorKeysForType(BaseType.URL),
  [BaseType.PHONE]: getOperatorKeysForType(BaseType.PHONE),
  [BaseType.NUMBER]: getOperatorKeysForType(BaseType.NUMBER),
  [BaseType.CURRENCY]: getOperatorKeysForType(BaseType.CURRENCY),
  [BaseType.BOOLEAN]: getOperatorKeysForType(BaseType.BOOLEAN),
  [BaseType.ENUM]: getOperatorKeysForType(BaseType.ENUM),
  [BaseType.DATE]: getOperatorKeysForType(BaseType.DATE),
  [BaseType.DATETIME]: getOperatorKeysForType(BaseType.DATETIME),
  [BaseType.TIME]: getOperatorKeysForType(BaseType.TIME),
  [BaseType.ARRAY]: getOperatorKeysForType(BaseType.ARRAY),
  [BaseType.TAGS]: getOperatorKeysForType(BaseType.TAGS),
  [BaseType.ADDRESS]: getOperatorKeysForType(BaseType.ADDRESS),
  [BaseType.OBJECT]: getOperatorKeysForType(BaseType.OBJECT),
  [BaseType.JSON]: getOperatorKeysForType(BaseType.JSON),
  [BaseType.FILE]: getOperatorKeysForType(BaseType.FILE),
  [BaseType.REFERENCE]: getOperatorKeysForType(BaseType.REFERENCE),
  [BaseType.RELATION]: getOperatorKeysForType(BaseType.RELATION),
  [BaseType.ACTOR]: getOperatorKeysForType(BaseType.ACTOR),
  [BaseType.SECRET]: getOperatorKeysForType(BaseType.SECRET),
  [BaseType.ANY]: getOperatorKeysForType(BaseType.ANY),
  [BaseType.NULL]: getOperatorKeysForType(BaseType.NULL),
}

/**
 * Helper to get operator keys for a type from definitions
 */
function getOperatorKeysForType(type: BaseType): Operator[] {
  return Object.values(OPERATOR_DEFINITIONS)
    .filter((op) => op.supportedTypes.includes(type))
    .map((op) => op.key as Operator)
}

/**
 * Get valid operators for a given BaseType.
 *
 * @param type - The BaseType to get operators for
 * @param overrides - Optional array to override/restrict operators
 * @returns Array of valid operator keys
 */
export function getOperatorsForType(type: BaseType, overrides?: Operator[]): Operator[] {
  const baseOperators = TYPE_OPERATOR_MAP[type] || []

  // If overrides provided, use them instead
  if (overrides && overrides.length > 0) {
    return overrides
  }

  return baseOperators
}

/**
 * Check if an operator is valid for a given type.
 */
export function isValidOperatorForType(
  operator: Operator,
  type: BaseType,
  overrides?: Operator[]
): boolean {
  const validOperators = getOperatorsForType(type, overrides)
  return validOperators.includes(operator)
}
