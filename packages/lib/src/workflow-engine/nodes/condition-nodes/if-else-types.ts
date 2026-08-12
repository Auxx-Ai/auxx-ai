// packages/lib/src/workflow-engine/nodes/condition-nodes/if-else-types.ts

import type { Operator } from '../../../conditions/operator-definitions'
import type { LogicalOperator } from '../../constants/nodes/if-else'
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
  /**
   * `false` when `value` holds a variable reference rather than a literal — the
   * builder sets it when the right-hand side is switched out of constant mode.
   * A `{{…}}` template is resolved regardless of this flag; it only matters for
   * a bare path (`node_1.total`), which is otherwise a plausible literal string.
   */
  isConstant?: boolean
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
 * A single evaluated condition, emitted in node output for the trace renderer.
 * Captures exactly what the engine compared — no client-side re-evaluation needed.
 */
export interface EvaluatedCondition {
  operator: Operator
  target: NodeCondition['value'] | null
  resolvedValue: any
  result: boolean
}

/**
 * A case the engine actually evaluated (short-circuits at the first match, so cases
 * after the matched one are never recorded).
 */
export interface EvaluatedCase {
  caseId: string
  logicalOperator: LogicalOperator
  matched: boolean
  conditions: EvaluatedCondition[]
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
