// packages/lib/src/workflow-engine/nodes/condition-nodes/if-else.ts

import { BaseNodeProcessor } from '../base-node'
import type {
  WorkflowNode,
  NodeExecutionResult,
  ValidationResult,
  PreprocessedNodeData,
} from '../../core/types'
import { NodeRunningStatus, WorkflowNodeType } from '../../core/types'
import type { ExecutionContextManager } from '../../core/execution-context'
import type { NodeCondition, NodeCase, IfElseNodeConfig } from './if-else-types'
import {
  type WorkflowFileData,
  analyzeFileName,
  isExtensionInCategory,
  isFileValid,
  isUploadedToday,
  isUploadedWithinDays,
  isWithinSizeLimit,
} from '../../types/file-variable'
import { getOperatorDefinition, type Operator } from '../../../conditions/operator-definitions'
import {
  isSameDay,
  isWithinDays,
  isOlderThanDays,
  isThisWeek,
  isThisMonth,
  parseDate,
} from '../utils/date-helpers'

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
            const variableValue = await contextManager.getVariable(condition.variableId)

            return {
              condition, // Original NodeCondition
              resolvedValue: variableValue,
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

    // Evaluate each case sequentially (for short-circuit behavior)
    for (let index = 0; index < resolvedCases.length; index++) {
      const { caseItem, resolvedConditions } = resolvedCases[index]

      // Evaluate all conditions in this case
      const results = resolvedConditions.map(({ condition, resolvedValue }: any) =>
        this.evaluateCondition(condition, resolvedValue, contextManager)
      )

      // Apply logical operator
      const matched =
        caseItem.logical_operator === 'and' ? results.every((r) => r) : results.some((r) => r)

      if (matched) {
        contextManager.log('INFO', node.name, `Case matched: ${caseItem.case_id}`, {
          caseIndex: index,
          logical_operator: caseItem.logical_operator,
        })
        return this.buildExecutionResult(true, caseItem.case_id, index, node, contextManager)
      }
    }

    contextManager.log('INFO', node.name, 'No cases matched - taking false branch')
    return this.buildExecutionResult(false, null, -1, node, contextManager)
  }

  /**
   * Build execution result with consistent output format
   */
  private buildExecutionResult(
    conditionResult: boolean,
    matchedCaseId: string | null,
    matchedCaseIndex: number,
    node: WorkflowNode,
    contextManager: ExecutionContextManager
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
      output: { matched: conditionResult, matchedCase: matchedCaseId, caseIndex: matchedCaseIndex },
      outputHandle,
    }
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
      if (typeof value === 'string' && !isNaN(Date.parse(value))) {
        return 'date'
      }
      return 'object'
    }
    return typeof value
  }

  /**
   * Evaluate a single condition using category-based routing
   * This is the main entry point for condition evaluation
   */
  private evaluateCondition(
    condition: NodeCondition,
    resolvedValue: any,
    contextManager: ExecutionContextManager
  ): boolean {
    const { comparison_operator, value } = condition
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

    // Route by operator category
    switch (def.category) {
      case 'equality':
        return this.evaluateEqualityOperator(resolvedValue, comparison_operator, value)

      case 'comparison':
        return this.evaluateComparisonOperator(resolvedValue, comparison_operator, value)

      case 'string':
        return this.evaluateStringOperator(resolvedValue, comparison_operator, value)

      case 'set':
        return this.evaluateSetOperator(resolvedValue, comparison_operator, value)

      case 'existence':
        return this.evaluateExistenceOperator(resolvedValue, comparison_operator)

      case 'file':
        return this.evaluateFileOperator(resolvedValue, comparison_operator, value)

      case 'date':
        return this.evaluateDateOperator(resolvedValue, comparison_operator, value)

      case 'array':
        return this.evaluateArrayOperator(resolvedValue, comparison_operator, value)

      case 'object':
        return this.evaluateObjectOperator(resolvedValue, comparison_operator, value)

      default:
        contextManager.log('WARN', undefined, `Unknown operator category: ${def.category}`)
        return false
    }
  }

  /**
   * EQUALITY: is, is not
   */
  private evaluateEqualityOperator(
    resolvedValue: any,
    operator: Operator,
    compareValue: any
  ): boolean {
    switch (operator) {
      case 'is':
        return resolvedValue == compareValue
      case 'is not':
        return resolvedValue != compareValue
      default:
        return false
    }
  }

  /**
   * COMPARISON: >, <, >=, <= (ONLY for numbers!)
   */
  private evaluateComparisonOperator(
    resolvedValue: any,
    operator: Operator,
    compareValue: any
  ): boolean {
    const num1 = Number(resolvedValue)
    const num2 = Number(compareValue)

    switch (operator) {
      case '>':
        return num1 > num2
      case '<':
        return num1 < num2
      case '>=':
        return num1 >= num2
      case '<=':
        return num1 <= num2
      default:
        return false
    }
  }

  /**
   * STRING: contains, not contains, starts with, ends with
   */
  private evaluateStringOperator(
    resolvedValue: any,
    operator: Operator,
    compareValue: any
  ): boolean {
    const str = String(resolvedValue)
    const val = String(compareValue)

    switch (operator) {
      case 'contains':
        return str.includes(val)
      case 'not contains':
        return !str.includes(val)
      case 'starts with':
        return str.startsWith(val)
      case 'ends with':
        return str.endsWith(val)
      default:
        return false
    }
  }

  /**
   * SET: in, not in (for multiple values)
   */
  private evaluateSetOperator(resolvedValue: any, operator: Operator, compareValue: any): boolean {
    if (!Array.isArray(compareValue)) {
      return operator === 'not in' // If not array, "not in" is true, "in" is false
    }

    switch (operator) {
      case 'in':
        return compareValue.includes(resolvedValue)
      case 'not in':
        return !compareValue.includes(resolvedValue)
      default:
        return false
    }
  }

  /**
   * EXISTENCE: exists, not exists, empty, not empty
   */
  private evaluateExistenceOperator(resolvedValue: any, operator: Operator): boolean {
    switch (operator) {
      case 'exists':
        return resolvedValue !== undefined && resolvedValue !== null
      case 'not exists':
        return resolvedValue === undefined || resolvedValue === null
      case 'empty':
        return this.isEmpty(resolvedValue)
      case 'not empty':
        return !this.isEmpty(resolvedValue)
      default:
        return false
    }
  }

  /**
   * DATE: is, is not, before, after, within_days, older_than_days, today, yesterday, etc.
   * NO comparison operators (>, <, etc.) - those are for numbers only!
   */
  private evaluateDateOperator(
    resolvedValue: any,
    operator: Operator,
    compareValue?: any
  ): boolean {
    const date = parseDate(resolvedValue)

    if (!date) {
      return false
    }

    switch (operator) {
      case 'is': {
        const targetDate = parseDate(compareValue)
        return targetDate ? isSameDay(date, targetDate) : false
      }

      case 'is not': {
        const targetDate = parseDate(compareValue)
        return targetDate ? !isSameDay(date, targetDate) : true
      }

      case 'before': {
        const beforeDate = parseDate(compareValue)
        return beforeDate ? date.getTime() < beforeDate.getTime() : false
      }

      case 'after': {
        const afterDate = parseDate(compareValue)
        return afterDate ? date.getTime() > afterDate.getTime() : false
      }

      case 'within_days':
        return isWithinDays(date, Number(compareValue))

      case 'older_than_days':
        return isOlderThanDays(date, Number(compareValue))

      case 'today':
        return isSameDay(date, new Date())

      case 'yesterday': {
        const yesterday = new Date()
        yesterday.setDate(yesterday.getDate() - 1)
        return isSameDay(date, yesterday)
      }

      case 'this_week':
        return isThisWeek(date)

      case 'this_month':
        return isThisMonth(date)

      default:
        return false
    }
  }

  /**
   * ARRAY: contains, not contains, empty, not empty, length operators
   */
  private evaluateArrayOperator(
    resolvedValue: any,
    operator: Operator,
    compareValue?: any
  ): boolean {
    if (!Array.isArray(resolvedValue)) {
      return operator === 'not exists'
    }

    switch (operator) {
      case 'contains':
        return resolvedValue.includes(compareValue)
      case 'not contains':
        return !resolvedValue.includes(compareValue)
      case 'empty':
        return resolvedValue.length === 0
      case 'not empty':
        return resolvedValue.length > 0
      case 'length =':
        return resolvedValue.length === Number(compareValue)
      case 'length >':
        return resolvedValue.length > Number(compareValue)
      case 'length <':
        return resolvedValue.length < Number(compareValue)
      case 'length >=':
        return resolvedValue.length >= Number(compareValue)
      case 'length <=':
        return resolvedValue.length <= Number(compareValue)
      default:
        return false
    }
  }

  /**
   * OBJECT: empty, not empty, has key, key equals
   */
  private evaluateObjectOperator(
    resolvedValue: any,
    operator: Operator,
    compareValue?: any
  ): boolean {
    const isObject =
      resolvedValue !== null && typeof resolvedValue === 'object' && !Array.isArray(resolvedValue)

    if (!isObject) {
      return operator === 'not exists'
    }

    switch (operator) {
      case 'empty':
        return Object.keys(resolvedValue).length === 0
      case 'not empty':
        return Object.keys(resolvedValue).length > 0
      case 'has key':
        return String(compareValue) in resolvedValue
      case 'key equals': {
        // Format: "key:value"
        const parts = String(compareValue).split(':')
        const key = parts[0]
        const value = parts.slice(1).join(':') // Handle values with colons
        return resolvedValue[key] == value
      }
      default:
        return false
    }
  }

  /**
   * FILE: All file-specific operators
   */
  private evaluateFileOperator(
    resolvedValue: any,
    operator: Operator,
    compareValue?: any
  ): boolean {
    if (!this.isFileVariable(resolvedValue)) {
      return false
    }

    switch (operator) {
      // Validation
      case 'is_valid':
        return isFileValid(resolvedValue)
      case 'is_invalid':
        return !isFileValid(resolvedValue)

      // Upload date
      case 'uploaded_today':
        return isUploadedToday(resolvedValue)
      case 'uploaded_within_days':
        return isUploadedWithinDays(resolvedValue, Number(compareValue))

      // Pattern matching
      case 'matches_pattern':
        return this.evaluateFilePattern(resolvedValue, compareValue)
      case 'contains_numbers':
        return analyzeFileName(resolvedValue.filename).hasNumbers
      case 'contains_date':
        return analyzeFileName(resolvedValue.filename).hasDate
      case 'has_version':
        return analyzeFileName(resolvedValue.filename).hasVersion

      // Extension categories
      case 'is_office_document':
        return isExtensionInCategory(resolvedValue.filename, 'office_document')
      case 'is_image_format':
        return isExtensionInCategory(resolvedValue.filename, 'image_format')
      case 'is_text_format':
        return isExtensionInCategory(resolvedValue.filename, 'text_format')
      case 'is_compressed':
        return isExtensionInCategory(resolvedValue.filename, 'compressed')
      case 'is_executable':
        return isExtensionInCategory(resolvedValue.filename, 'executable')

      // Size
      case 'within_size_limit':
        return isWithinSizeLimit(resolvedValue, Number(compareValue))
      case 'exceeds_limit':
        return !isWithinSizeLimit(resolvedValue, Number(compareValue))

      default:
        return false
    }
  }

  /**
   * Helper: Evaluate file pattern matching
   */
  private evaluateFilePattern(fileData: any, pattern: any): boolean {
    try {
      const regex = new RegExp(String(pattern), 'i')
      return regex.test(fileData.filename)
    } catch (error) {
      return false
    }
  }

  /**
   * Check if a value is empty
   */
  private isEmpty(value: any): boolean {
    if (value === null || value === undefined) return true
    if (typeof value === 'string') return value.trim().length === 0
    if (Array.isArray(value)) return value.length === 0
    if (typeof value === 'object') return Object.keys(value).length === 0
    return false
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

  /**
   * Check if a value is a file variable
   */
  private isFileVariable(value: any): value is WorkflowFileData {
    return (
      value &&
      typeof value === 'object' &&
      'filename' in value &&
      'mimeType' in value &&
      'size' in value &&
      'url' in value
    )
  }
}
