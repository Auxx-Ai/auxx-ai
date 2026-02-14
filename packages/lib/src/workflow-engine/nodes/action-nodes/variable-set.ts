// packages/lib/src/workflow-engine/nodes/action-nodes/variable-set.ts

import type { ExecutionContextManager } from '../../core/execution-context'
import type {
  NodeExecutionResult,
  PreprocessedNodeData,
  ValidationResult,
  WorkflowNode,
} from '../../core/types'
import { NodeRunningStatus, WorkflowNodeType } from '../../core/types'
import { BaseNodeProcessor } from '../base-node'

/**
 * Action node that sets variables in the execution context
 * Simple utility node for managing workflow state
 */
export class VariableSetProcessor extends BaseNodeProcessor {
  readonly type: WorkflowNodeType = WorkflowNodeType.VARIABLE_SET

  /**
   * Preprocess Variable Set node - resolve variables for client visibility
   */
  async preprocessNode(
    node: WorkflowNode,
    contextManager: ExecutionContextManager
  ): Promise<PreprocessedNodeData> {
    const config = node.data
    const variables = config.variables || {}

    if (Object.keys(variables).length === 0) {
      throw new Error('No variables specified for variable-set node')
    }

    const resolvedVariables: Record<string, any> = {}
    const failedVariables: string[] = []

    // Resolve all variables in parallel with individual error handling
    const entries = Object.entries(variables)
    const resolvePromises = entries.map(async ([key, value]) => {
      try {
        const resolvedValue = await this.resolveVariableValue(value, contextManager)
        return { key, value: resolvedValue, success: true, error: null }
      } catch (error) {
        return {
          key,
          value: null,
          success: false,
          error: error instanceof Error ? error.message : String(error),
        }
      }
    })

    const results = await Promise.all(resolvePromises)

    // Process results and handle stopOnError
    for (const result of results) {
      if (result.success) {
        resolvedVariables[result.key] = result.value
      } else {
        failedVariables.push(result.key)
        // If stopOnError is enabled, fail preprocessing on first error
        if (config.stopOnError !== false) {
          throw new Error(`Failed to resolve variable '${result.key}': ${result.error}`)
        }
      }
    }

    return {
      inputs: { resolvedVariables, failedVariables, stopOnError: config.stopOnError !== false },
      metadata: {
        nodeType: 'variable-set',
        totalVariables: Object.keys(variables).length,
        successfulVariables: Object.keys(resolvedVariables).length,
        failedVariables: failedVariables.length,
        preprocessingComplete: true,
      },
    }
  }

  protected async executeNode(
    node: WorkflowNode,
    contextManager: ExecutionContextManager,
    preprocessedData?: PreprocessedNodeData
  ): Promise<Partial<NodeExecutionResult>> {
    if (preprocessedData?.inputs) {
      const inputs = preprocessedData.inputs
      const setVariables: Record<string, any> = {}

      contextManager.log('INFO', node.nodeId, 'Setting variables with preprocessed data', {
        variableCount: Object.keys(inputs.resolvedVariables).length,
        variableNames: Object.keys(inputs.resolvedVariables),
        failedVariables: inputs.failedVariables.length,
        usedPreprocessedData: true,
      })

      // Set variables using preprocessed resolved values
      for (const [key, value] of Object.entries(inputs.resolvedVariables)) {
        contextManager.setVariable(key, value)
        setVariables[key] = value

        contextManager.log('DEBUG', node.nodeId, `Variable set: ${key}`, {
          resolvedValue: value,
          usedPreprocessedData: true,
        })
      }

      return {
        status: NodeRunningStatus.Succeeded,
        output: {
          variablesSet: setVariables,
          variableCount: Object.keys(setVariables).length,
          failedVariables: inputs.failedVariables,
          usedPreprocessedData: true,
        },
        metadata: {
          usedPreprocessedData: true,
          preprocessingBenefit: 'Skipped variable resolution',
        },
        outputHandle: 'source',
      }
    }

    // Fallback to original implementation
    const config = node.data
    const variables = config.variables || {}

    if (Object.keys(variables).length === 0) {
      throw new Error('No variables specified for variable-set node')
    }

    contextManager.log('INFO', node.nodeId, 'Setting variables', {
      variableCount: Object.keys(variables).length,
      variableNames: Object.keys(variables),
    })

    const setVariables: Record<string, any> = {}

    // Resolve all variables in parallel with individual error handling
    const entries = Object.entries(variables)
    const resolvePromises = entries.map(async ([key, value]) => {
      try {
        const resolvedValue = await this.resolveVariableValue(value, contextManager)
        return { key, value: resolvedValue, originalValue: value, success: true, error: null }
      } catch (error) {
        return {
          key,
          value: null,
          originalValue: value,
          success: false,
          error: error instanceof Error ? error.message : String(error),
        }
      }
    })

    const results = await Promise.all(resolvePromises)

    // Process results and handle stopOnError
    for (const result of results) {
      if (result.success) {
        contextManager.setVariable(result.key, result.value)
        setVariables[result.key] = result.value

        contextManager.log('DEBUG', node.nodeId, `Variable set: ${result.key}`, {
          originalValue: result.originalValue,
          resolvedValue: result.value,
        })
      } else {
        contextManager.log('ERROR', node.nodeId, `Failed to set variable: ${result.key}`, {
          value: result.originalValue,
          error: result.error,
        })

        if (config.stopOnError !== false) {
          throw new Error(`Failed to set variable '${result.key}': ${result.error}`)
        }
      }
    }

    return {
      status: NodeRunningStatus.Succeeded,
      output: { variablesSet: setVariables, variableCount: Object.keys(setVariables).length },
      outputHandle: 'source', // Standard output for action nodes
    }
  }

  /**
   * Extract variables from variable assignments
   */
  protected extractRequiredVariables(node: WorkflowNode): string[] {
    const config = node.data
    const variables = new Set<string>()

    // Extract from all variable values
    if (config.variables && typeof config.variables === 'object') {
      Object.values(config.variables).forEach((value: any) => {
        if (typeof value === 'string') {
          this.extractVariableIds(value).forEach((v) => variables.add(v))
        }
      })
    }

    return Array.from(variables)
  }

  protected async validateNodeConfig(node: WorkflowNode): Promise<ValidationResult> {
    const errors: string[] = []
    const warnings: string[] = []
    const config = node.data

    // Check for variables
    if (!config.variables || typeof config.variables !== 'object') {
      errors.push('variables must be an object')
    } else if (Object.keys(config.variables).length === 0) {
      errors.push('At least one variable must be specified')
    } else {
      // Validate variable names
      for (const key of Object.keys(config.variables)) {
        if (!this.isValidVariableName(key)) {
          errors.push(`Invalid variable name: '${key}' (must be alphanumeric with underscores)`)
        }
      }
    }

    // Check for next connection
    // if (!node.connections.default) {
    //   warnings.push('No default connection specified - workflow may end')
    // }

    return { valid: errors.length === 0, errors, warnings }
  }

  /**
   * Legacy method - now delegates to base class enhanced resolution
   */
  // private resolveValue(value: any, contextManager: ExecutionContextManager): any {
  //   return await this.resolveVariableValue(value, contextManager)
  // }

  /**
   * Get variable value with support for dot notation
   */
  // private getVariableValue(varPath: string, contextManager: ExecutionContextManager): any {
  //   if (varPath.startsWith('variables.')) {
  //     const varName = varPath.substring(10)
  //     return await contextManager.getVariable(varName)
  //   }

  //   if (varPath.startsWith('message.')) {
  //     const message = contextManager.getContext().message
  //     if (!message) return undefined

  //     const propPath = varPath.substring(8)
  //     return this.getNestedProperty(message, propPath)
  //   }

  //   if (varPath.startsWith('context.')) {
  //     const context = contextManager.getContext()
  //     const propPath = varPath.substring(8)
  //     return this.getNestedProperty(context, propPath)
  //   }

  //   // Direct variable name
  //   return await contextManager.getVariable(varPath)
  // }

  /**
   * Interpolate string with {{}} patterns
   */
  // private interpolateString(template: string, contextManager: ExecutionContextManager): string {
  //   return template.replace(/\{\{([^}]+)\}\}/g, (match, expression) => {
  //     try {
  //       const result = this.evaluateExpression(expression.trim(), contextManager)
  //       return String(result ?? '')
  //     } catch (error) {
  //       contextManager.log('WARN', undefined, `Failed to interpolate expression: ${expression}`, {
  //         error: error instanceof Error ? error.message : String(error)
  //       })
  //       return match // Return original if evaluation fails
  //     }
  //   })
  // }

  /**
   * Validate variable name (alphanumeric with underscores)
   */
  private isValidVariableName(name: string): boolean {
    return /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)
  }
}
