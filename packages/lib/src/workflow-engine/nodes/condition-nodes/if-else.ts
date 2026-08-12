// packages/lib/src/workflow-engine/nodes/condition-nodes/if-else.ts

import { evaluateOperator } from '../../../conditions/evaluate-operator'
import { getOperatorDefinition } from '../../../conditions/operator-definitions'
import type { ExecutionContextManager } from '../../core/execution-context'
import type {
  NodeExecutionResult,
  PreprocessedNodeData,
  ValidationResult,
  WorkflowNode,
} from '../../core/types'
import { NodeRunningStatus, WorkflowNodeType } from '../../core/types'
import { BaseNodeProcessor } from '../base-node'
import type {
  EvaluatedCase,
  EvaluatedCondition,
  IfElseNodeConfig,
  NodeCondition,
} from './if-else-types'

/**
 * Condition node that evaluates an if/else condition
 * Routes execution to different paths based on the condition result
 */
export class IfElseProcessor extends BaseNodeProcessor {
  readonly type: WorkflowNodeType = WorkflowNodeType.IF_ELSE

  /**
   * Preprocess if-else node to resolve all variable values upfront
   */
  async preprocessNode(
    node: WorkflowNode,
    contextManager: ExecutionContextManager
  ): Promise<PreprocessedNodeData> {
    const data = node.data as unknown as IfElseNodeConfig

    if (!data.cases || !Array.isArray(data.cases)) {
      throw new Error('If-else node requires structured cases')
    }

    // Resolve all variable values upfront - process all cases in parallel
    const resolvedCases = await Promise.all(
      data.cases.map(async (caseItem) => {
        // Resolve values for all conditions in this case in parallel
        const resolvedConditions = await Promise.all(
          caseItem.conditions.map(async (condition) => {
            const [variableValue, targetValue] = await Promise.all([
              contextManager.getVariable(condition.variableId),
              this.resolveConditionTarget(condition, contextManager),
            ])

            return {
              condition, // Original NodeCondition
              resolvedValue: variableValue,
              targetValue,
            }
          })
        )

        return {
          caseItem, // Original NodeCase
          resolvedConditions,
        }
      })
    )

    return {
      inputs: {
        resolvedCases,
      },
      metadata: {
        nodeType: 'if-else',
        conditionType: 'structured',
        caseCount: data.cases.length,
        totalConditions: data.cases.reduce((sum, c) => sum + c.conditions.length, 0),
        variablesResolved: true,
        readyForEvaluation: true,
      },
    }
  }

  protected async executeNode(
    node: WorkflowNode,
    contextManager: ExecutionContextManager,
    preprocessedData?: PreprocessedNodeData
  ): Promise<Partial<NodeExecutionResult>> {
    if (!preprocessedData?.inputs?.resolvedCases) {
      throw new Error('If-else node requires preprocessed data')
    }

    const { resolvedCases } = preprocessedData.inputs

    contextManager.log('DEBUG', node.name, 'Evaluating if-else conditions', {
      totalCases: resolvedCases.length,
      totalConditions: resolvedCases.reduce(
        (sum: number, rc: any) => sum + rc.resolvedConditions.length,
        0
      ),
    })

    // Evaluate each case sequentially (for short-circuit behavior). Record what we
    // evaluate so the trace renderer can display it without re-computing — cases after
    // the matched one are never reached and therefore never recorded.
    const evaluatedCases: EvaluatedCase[] = []
    for (let index = 0; index < resolvedCases.length; index++) {
      const { caseItem, resolvedConditions } = resolvedCases[index]

      // Evaluate all conditions in this case
      const conditions: EvaluatedCondition[] = resolvedConditions.map(
        ({ condition, resolvedValue, targetValue }: any) => ({
          operator: condition.comparison_operator,
          // The *resolved* target, so the trace shows what was actually compared
          // rather than the `{{…}}` template the author typed.
          target: targetValue ?? null,
          resolvedValue: resolvedValue ?? null,
          result: this.evaluateCondition(condition, resolvedValue, targetValue, contextManager),
        })
      )

      // Apply logical operator
      const matched =
        caseItem.logical_operator === 'and'
          ? conditions.every((c) => c.result)
          : conditions.some((c) => c.result)

      evaluatedCases.push({
        caseId: caseItem.case_id,
        logicalOperator: caseItem.logical_operator,
        matched,
        conditions,
      })

      if (matched) {
        contextManager.log('INFO', node.name, `Case matched: ${caseItem.case_id}`, {
          caseIndex: index,
          logical_operator: caseItem.logical_operator,
        })
        return this.buildExecutionResult(
          true,
          caseItem.case_id,
          index,
          node,
          contextManager,
          evaluatedCases
        )
      }
    }

    contextManager.log('INFO', node.name, 'No cases matched - taking false branch')
    return this.buildExecutionResult(false, null, -1, node, contextManager, evaluatedCases)
  }

  /**
   * Build execution result with consistent output format
   */
  private buildExecutionResult(
    conditionResult: boolean,
    matchedCaseId: string | null,
    matchedCaseIndex: number,
    node: WorkflowNode,
    contextManager: ExecutionContextManager,
    evaluatedCases: EvaluatedCase[]
  ): Partial<NodeExecutionResult> {
    // Store output variables to match frontend schema
    contextManager.setNodeVariable(
      node.nodeId,
      'matched_condition',
      matchedCaseId || (conditionResult ? 'true' : 'false')
    )
    contextManager.setNodeVariable(node.nodeId, 'condition_index', matchedCaseIndex)
    contextManager.setNodeVariable(node.nodeId, 'branch_taken', conditionResult ? 'true' : 'false')

    // Determine output handle based on result
    let outputHandle: string

    if (matchedCaseId) {
      // For structured cases, use the case ID as the output handle
      outputHandle = matchedCaseId
    } else {
      // For simple conditions, use 'true' or 'false'
      outputHandle = conditionResult ? 'true' : 'false'
    }

    contextManager.log('DEBUG', node.name, `If-else result: outputHandle=${outputHandle}`, {
      matchedCaseId,
      conditionResult,
    })

    return {
      status: NodeRunningStatus.Succeeded,
      output: {
        matched: conditionResult,
        matchedCase: matchedCaseId,
        caseIndex: matchedCaseIndex,
        evaluatedCases,
      },
      outputHandle,
    }
  }

  /**
   * Resolve the right-hand side of a condition.
   *
   * The comparison value is not always a literal — the builder lets you compare a
   * variable against another variable (`isConstant: false`), and templates ship
   * `{{env.HIGH_VALUE_THRESHOLD}}`-style targets. Left unresolved these compare as
   * the literal string `"{{…}}"`, which silently fails every match rather than
   * erroring, so the branch just never fires.
   *
   * Only strings are resolved; numbers, booleans and the array targets used by the
   * `in` / `not in` operators are already literal values and pass straight through.
   */
  private async resolveConditionTarget(
    condition: NodeCondition,
    contextManager: ExecutionContextManager
  ): Promise<NodeCondition['value']> {
    const { value } = condition
    if (typeof value !== 'string' || value.length === 0) return value

    const isTemplate = value.includes('{{') && value.includes('}}')
    // A bare path is only a reference when the author said so — otherwise
    // "shipped.today" is a perfectly good string to compare against.
    if (!isTemplate && condition.isConstant !== false) return value

    return this.resolveVariableValue(value, contextManager)
  }

  /**
   * Extract variables from condition expressions
   */
  protected extractRequiredVariables(node: WorkflowNode): string[] {
    const data = node.data as IfElseNodeConfig
    const variables = new Set<string>()

    // Extract from all conditions in all cases
    if (data.cases && Array.isArray(data.cases)) {
      data.cases.forEach((caseItem) => {
        caseItem.conditions?.forEach((condition) => {
          if (condition.variableId) {
            variables.add(condition.variableId)
          }
          // The comparison value can reference a variable too — declare it, or the
          // node looks independent of an upstream it actually reads.
          if (typeof condition.value === 'string') {
            this.extractVariableIds(condition.value).forEach((v) => variables.add(v))
            if (condition.isConstant === false && !condition.value.includes('{{')) {
              variables.add(condition.value)
            }
          }
        })
      })
    }

    return Array.from(variables)
  }

  protected async validateNodeConfig(node: WorkflowNode): Promise<ValidationResult> {
    const errors: string[] = []
    const warnings: string[] = []
    const data = node.data as IfElseNodeConfig

    // Check for cases
    if (!data.cases || !Array.isArray(data.cases)) {
      errors.push('If-else node requires structured cases')
    } else if (data.cases.length === 0) {
      warnings.push('No cases defined for if-else node')
    } else {
      // Validate each case
      data.cases.forEach((caseItem, index) => {
        if (!caseItem.conditions || caseItem.conditions.length === 0) {
          warnings.push(`Case ${index + 1} has no conditions`)
        }

        caseItem.conditions.forEach((condition, condIndex) => {
          if (!condition.variableId) {
            errors.push(`Case ${index + 1}, condition ${condIndex + 1}: Missing variable ID`)
          }
          if (!condition.comparison_operator) {
            errors.push(
              `Case ${index + 1}, condition ${condIndex + 1}: Missing comparison operator`
            )
          }
        })
      })
    }

    return { valid: errors.length === 0, errors, warnings }
  }

  /**
   * Determine the type of a value for condition evaluation
   */
  private determineValueType(value: any): string {
    if (value === null || value === undefined) return 'null'
    if (Array.isArray(value)) return 'array'
    if (value instanceof Date) return 'date'
    if (typeof value === 'object') {
      // Check if it's a date string
      if (typeof value === 'string' && !Number.isNaN(Date.parse(value))) {
        return 'date'
      }
      return 'object'
    }
    return typeof value
  }

  /**
   * Evaluate a single condition.
   *
   * The operator semantics themselves live in `conditions/evaluate-operator.ts` — one
   * implementation shared with the mail/record-rule evaluator (`conditions/evaluate.ts`)
   * and the list node's filter, so `is` cannot mean one thing in a workflow branch and
   * another in a mail filter. This method only adds the node's tracing.
   */
  private evaluateCondition(
    condition: NodeCondition,
    resolvedValue: any,
    value: NodeCondition['value'],
    contextManager: ExecutionContextManager
  ): boolean {
    const { comparison_operator } = condition
    const def = getOperatorDefinition(comparison_operator)

    if (!def) {
      contextManager.log('WARN', undefined, `Unknown operator: ${comparison_operator}`)
      return false
    }

    contextManager.log('DEBUG', undefined, 'Evaluating condition', {
      variableId: condition.variableId,
      operator: comparison_operator,
      category: def.category,
      resolvedValue,
      compareValue: value,
    })

    return evaluateOperator(resolvedValue, comparison_operator, value)
  }

  /**
   * Resolve connection key for a given case ID
   */
  private resolveConnectionKeyForCase(
    caseId: string,
    connections: Record<string, any>
  ): string | undefined {
    // Map standard case IDs
    if (caseId === 'true') {
      return connections.onTrue || connections.true
    }
    if (caseId === 'false') {
      return connections.onFalse || connections.false
    }

    // Try custom case formats
    const candidates = [`case_${caseId}`, caseId, `on${caseId}`, 'default']

    for (const key of candidates) {
      if (connections[key]) {
        return connections[key]
      }
    }

    return undefined
  }

  /**
   * Resolve connection for a given case ID and extract node ID
   */
  private resolveConnectionForCase(
    caseId: string,
    connections: Record<string, any>
  ): string | undefined {
    const connection = this.resolveConnectionKeyForCase(caseId, connections)
    return connection ? this.extractNodeId(connection) : undefined
  }

  /**
   * Extract node ID from connection value (handles string, array, or object)
   */
  private extractNodeId(connection: any): string | undefined {
    if (typeof connection === 'string') {
      return connection
    }
    if (Array.isArray(connection) && connection.length > 0) {
      return connection[0]
    }
    if (typeof connection === 'object' && connection !== null) {
      return Object.values(connection)[0] as string
    }
    return undefined
  }
}
