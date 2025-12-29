// apps/web/src/components/workflow/nodes/core/if-else/utils.ts

import { BaseType } from '~/components/workflow/types/variable-types'
import { getOperatorsForType, operatorRequiresValue } from '@auxx/lib/workflow-engine/client'
import type { NodeCondition } from './types'

// Use the comparison operator type from NodeCondition
export type ComparisonOperator = NodeCondition['comparison_operator']

/**
 * Check if operator requires a value input
 * Simple negation of the lib function
 */
export const comparisonOperatorNotRequireValue = (operator?: ComparisonOperator): boolean => {
  if (!operator) return false
  return !operatorRequiresValue(operator)
}

/**
 * Get available operators based on variable type
 */
export const getOperators = (varType?: BaseType): ComparisonOperator[] => {
  return getOperatorsForType(varType || BaseType.STRING) as ComparisonOperator[]
}
