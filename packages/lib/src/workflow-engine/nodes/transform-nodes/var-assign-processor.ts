// packages/lib/src/workflow-engine/nodes/transform-nodes/var-assign-processor.ts

import type { ExecutionContextManager } from '../../core/execution-context'
import type { NodeExecutionResult, ValidationResult, WorkflowNode } from '../../core/types'
import { NodeRunningStatus, WorkflowNodeType } from '../../core/types'
import { BaseNodeProcessor } from '../base-node'

interface VariableAssignment {
  id: string
  name: string
  type: 'string' | 'number' | 'boolean' | 'object' | 'array'
  isArray?: boolean
  value: string | string[]
  isConstantMode?: boolean // UI-only: for single values
  itemConstantModes?: boolean[] // UI-only: for array items
}

interface VarAssignConfig {
  variables: VariableAssignment[]
  ignoreTypeError?: boolean
}

export class VarAssignProcessor extends BaseNodeProcessor {
  readonly type = WorkflowNodeType.VAR_ASSIGN

  protected async executeNode(
    node: WorkflowNode,
    contextManager: ExecutionContextManager
  ): Promise<Partial<NodeExecutionResult>> {
    try {
      const config = node.data as unknown as VarAssignConfig

      contextManager.log(
        'INFO',
        node.name,
        `Executing variable assignment with ${config.variables.length} variables`
      )

      const results: Record<string, any> = {}
      const errors: string[] = []

      // Process all variable assignments in parallel
      const assignmentPromises = config.variables
        .filter((assignment) => assignment.name.trim()) // Skip empty names
        .map(async (assignment) => {
          try {
            let processedValue: any

            if (assignment.isArray && Array.isArray(assignment.value)) {
              // Process array values: interpolate and convert each item to the specified type
              processedValue = await Promise.all(
                assignment.value.map(async (val) => {
                  const interpolated = await this.interpolateVariables(val, contextManager)
                  // Convert each array item to the specified type with strict validation
                  return this.convertToType(interpolated, assignment.type, config.ignoreTypeError)
                })
              )
            } else {
              // Process single value
              const valueStr =
                typeof assignment.value === 'string'
                  ? assignment.value
                  : JSON.stringify(assignment.value)

              const interpolated = await this.interpolateVariables(valueStr, contextManager)

              // Type conversion
              processedValue = this.convertToType(
                interpolated,
                assignment.type,
                config.ignoreTypeError
              )
            }

            return {
              name: assignment.name,
              value: processedValue,
              success: true,
              error: null,
            }
          } catch (error) {
            const errorMsg = `Failed to process variable '${assignment.name}': ${
              error instanceof Error ? error.message : String(error)
            }`

            if (config.ignoreTypeError) {
              // Return fallback value
              const fallbackValue =
                typeof assignment.value === 'string' ? assignment.value : assignment.value
              return {
                name: assignment.name,
                value: fallbackValue,
                success: true,
                error: errorMsg,
                isWarning: true,
              }
            } else {
              return {
                name: assignment.name,
                value: null,
                success: false,
                error: errorMsg,
              }
            }
          }
        })

      const assignmentResults = await Promise.all(assignmentPromises)

      // Process results
      for (const result of assignmentResults) {
        if (result.success) {
          contextManager.setVariable(result.name, result.value)
          results[result.name] = result.value

          if (result.isWarning) {
            contextManager.log('WARN', node.name, result.error!)
          } else {
            contextManager.log(
              'DEBUG',
              node.name,
              `Set variable '${result.name}' to: ${JSON.stringify(result.value)}`
            )
          }
        } else {
          errors.push(result.error!)
          contextManager.log('ERROR', node.name, result.error!)
        }
      }

      // Check if any errors occurred
      if (errors.length > 0 && !config.ignoreTypeError) {
        throw new Error(errors.join('; '))
      }

      // Set output variables for the node
      contextManager.setNodeVariable(node.nodeId, 'variables', results)

      return {
        status: NodeRunningStatus.Succeeded,
        output: { variables: results, count: Object.keys(results).length },
        outputHandle: 'source', // Standard output for transform nodes
      }
    } catch (error) {
      contextManager.log(
        'ERROR',
        node.name,
        `Error in variable assignment: ${error instanceof Error ? error.message : String(error)}`
      )
      throw error
    }
  }

  /**
   * Convert a value to the specified type
   */
  private convertToType(value: string, type: string, ignoreError?: boolean): any {
    try {
      switch (type) {
        case 'string':
          return String(value)

        case 'number': {
          const num = Number(value)
          if (Number.isNaN(num)) {
            throw new Error(`Cannot convert '${value}' to number`)
          }
          return num
        }

        case 'boolean':
          if (value === 'true' || value === '1') return true
          if (value === 'false' || value === '0') return false
          throw new Error(`Cannot convert '${value}' to boolean`)

        case 'object':
          try {
            return JSON.parse(value)
          } catch {
            throw new Error(`Cannot parse '${value}' as JSON object`)
          }

        case 'array':
          try {
            const parsed = JSON.parse(value)
            if (!Array.isArray(parsed)) {
              throw new Error('Parsed value is not an array')
            }
            return parsed
          } catch {
            // If not valid JSON, treat as single-item array
            return [value]
          }

        default:
          return value
      }
    } catch (error) {
      if (ignoreError) {
        return value // Return original value
      }
      throw error
    }
  }

  /**
   * Extract variables from variable assignment values
   */
  protected extractRequiredVariables(node: WorkflowNode): string[] {
    const config = node.data as unknown as VarAssignConfig
    const variables = new Set<string>()

    // Extract from all variable assignment values
    if (config.variables && Array.isArray(config.variables)) {
      config.variables.forEach((assignment) => {
        if (assignment.isArray && Array.isArray(assignment.value)) {
          // Extract from array values
          assignment.value.forEach((val) => {
            if (typeof val === 'string') {
              this.extractVariableIds(val).forEach((v) => variables.add(v))
            }
          })
        } else if (typeof assignment.value === 'string') {
          // Extract from single value
          this.extractVariableIds(assignment.value).forEach((v) => variables.add(v))
        }
      })
    }

    return Array.from(variables)
  }

  async validate(node: WorkflowNode): Promise<ValidationResult> {
    const errors: string[] = []
    const warnings: string[] = []
    const config = node.data as unknown as VarAssignConfig

    if (!config.variables || config.variables.length === 0) {
      errors.push('At least one variable assignment is required')
    }

    // Check for duplicate variable names
    const names = config.variables.map((v) => v.name).filter((n) => n.trim())
    const duplicates = names.filter((name, index) => names.indexOf(name) !== index)
    if (duplicates.length > 0) {
      errors.push(`Duplicate variable names: ${duplicates.join(', ')}`)
    }

    // Validate each assignment
    config.variables.forEach((variable, index) => {
      if (variable.name && !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(variable.name)) {
        errors.push(
          `Variable ${index + 1}: Name must start with letter/underscore and contain only alphanumeric characters`
        )
      }
    })

    return { valid: errors.length === 0, errors, warnings }
  }
}
