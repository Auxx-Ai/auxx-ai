// packages/lib/src/workflow-engine/nodes/condition-nodes/if-else-types.ts

import type { LogicalOperator } from '../../constants/nodes/if-else'
import type { Operator } from '../../../conditions/operator-definitions'
/**
 * Types for if-else node condition evaluation
 * Aligned with frontend types from apps/web/src/components/workflow/nodes/core/if-else/types.ts
 */

/**
 * Individual condition within a case
 * Matches frontend schema exactly
 */
export interface NodeCondition {
  id: string
  // Variable reference
  variableId: string
  // Comparison operator (now required)
  comparison_operator: Operator
  // Value to compare against
  value?: string | number | boolean | any[] | Record<string, any>
}

/**
 * Case definition containing multiple conditions
 */
export interface NodeCase {
  id: string
  case_id: string
  logical_operator: LogicalOperator
  conditions: NodeCondition[]
}

/**
 * If-else node configuration
 */
export interface IfElseNodeConfig {
  // Node title
  title: string
  // Node description
  description?: string
  // Simple condition expression (legacy)
  condition?: string
  // Structured cases (modern)
  cases?: NodeCase[]
  // Target branches configuration
  _targetBranches?: Array<{
    id: string
    name: string
    type: 'default' | 'fail'
  }>
}

/**
 * Result of condition evaluation
 */
export interface ConditionEvaluationResult {
  // Whether any condition matched
  matched: boolean
  // Which case matched (case_id)
  matchedCaseId?: string
  // Index of the matched case
  matchedCaseIndex?: number
  // Details about the evaluation for debugging
  evaluationDetails?: {
    caseId: string
    conditions: Array<{
      conditionId: string
      variablePath: string
      variableValue: any
      operator: Operator
      compareValue: any
      result: boolean
    }>
    finalResult: boolean
  }[]
}
