// packages/lib/src/workflow-engine/nodes/action-nodes/code.ts

import type { ExecutionContextManager } from '../../core/execution-context'
import type { NodeExecutionResult, ValidationResult, WorkflowNode } from '../../core/types'
import { NodeRunningStatus, WorkflowNodeType } from '../../core/types'
import { BaseNodeProcessor } from '../base-node'

interface CodeNodeData {
  // Base node properties (actual structure from workflow engine)
  id: string
  code: string
  desc?: string
  icon?: string
  color?: string
  code_language: 'javascript' | 'python3'
  inputs?: Array<{ name: string; variableId: string }>
  outputs?: Array<{ name: string; type: any; description?: string }>

  // Additional node data properties
  isValid?: boolean
  errors?: string[]
  isInLoop?: boolean
  variables?: any[]
}

/**
 * Code node that executes custom JavaScript or Python code
 * Note: Python execution is not implemented yet
 */
export class CodeProcessor extends BaseNodeProcessor {
  readonly type: WorkflowNodeType = WorkflowNodeType.CODE

  protected async executeNode(
    node: WorkflowNode,
    contextManager: ExecutionContextManager
  ): Promise<Partial<NodeExecutionResult>> {
    const config = node.data as unknown as CodeNodeData

    if (!config.code || !config.code.trim()) {
      throw this.createExecutionError('No code provided for execution', node, {
        hasCode: !!config.code,
        codeLength: config.code?.length || 0,
        nodeConfig: config,
      })
    }

    if (!config.code_language) {
      throw this.createExecutionError('No code language specified', node, {
        nodeConfig: config,
        supportedLanguages: ['javascript', 'python3'],
      })
    }

    contextManager.log('INFO', node.name, 'Executing code via Lambda', {
      language: config.code_language,
    })

    try {
      // Execute via Lambda
      const result = await this.executeCodeViaLambda(config, contextManager, node)

      // Store outputs as variables
      if (config.outputs && result) {
        for (const output of config.outputs) {
          if (Object.hasOwn(result, output.name)) {
            contextManager.setNodeVariable(node.nodeId, output.name, result[output.name])
          }
        }
      }

      // Store the full result (for backward compatibility)
      contextManager.setNodeVariable(node.nodeId, 'result', result)

      return {
        status: NodeRunningStatus.Succeeded,
        output: result,
        outputHandle: 'source', // Standard output for action nodes
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)

      contextManager.log('ERROR', node.name, 'Code execution failed', {
        error: errorMessage,
        errorType: error?.constructor?.name,
        stack: error instanceof Error ? error.stack : undefined,
      })

      // Throw execution error to trigger NODE_FAILED event
      throw this.createExecutionError(
        `Code execution failed: ${errorMessage}`,
        node,
        {
          codeLanguage: config.code_language,
          codeLength: config.code?.length || 0,
          errorType: error?.constructor?.name,
          originalError: errorMessage,
          executionPhase: 'code_execution',
          stack: error instanceof Error ? error.stack : undefined,
        },
        error as Error
      )
    }
  }

  /**
   * Execute code via Lambda runtime
   * This replaces the old isolated-vm based execution with Lambda-based execution
   */
  private async executeCodeViaLambda(
    config: CodeNodeData,
    contextManager: ExecutionContextManager,
    node: WorkflowNode
  ): Promise<any> {
    // 1. Prepare inputs
    const inputs: Record<string, any> = {}
    if (config.inputs) {
      for (const input of config.inputs) {
        if (input.variableId) {
          inputs[input.name] = await contextManager.getVariable(input.variableId)
        }
      }
    }

    // 2. Invoke Lambda via shared helper
    // IMPORTANT: Pass ALL variables (including sys.*, env.*, node.*)
    // The variables object already contains all context (sys.workflowId, sys.userId, etc.)
    const { invokeLambdaExecutor } = await import('@auxx/services/lambda-execution')

    const lambdaResult = await invokeLambdaExecutor({
      payload: {
        type: 'code',
        code: config.code,
        codeLanguage: config.code_language,
        codeInput: inputs, // Values: { input1: value1, input2: value2 }
        inputsConfig: config.inputs || [], // Preserve order: [{ name: "input1", variableId: "..." }, ...]

        // Pass ALL variables - already includes sys.workflowId, sys.userId, sys.organizationId, etc.
        variables: contextManager.getAllVariables(),

        timeout: 30000,
      },
    })

    if (lambdaResult.isErr()) {
      const error = lambdaResult.error

      // Log full error for debugging
      contextManager.log('ERROR', node.name, 'Lambda execution failed', {
        code: error.code,
        message: error.message,
        details: error.details,
        statusCode: error.statusCode,
      })

      // Build detailed error message
      let errorMessage = `Code execution failed: ${error.message}`

      if (error.code === 'VALIDATION_ERROR' && error.details) {
        const validationErrors = error.details
          .map((err: any) => `  - ${err.field}: ${err.message}`)
          .join('\n')
        errorMessage += `\n\nValidation errors:\n${validationErrors}`
      }

      throw new Error(errorMessage)
    }
    // 4. Process console logs from Lambda
    const consoleLogs = lambdaResult.value.metadata?.console_logs || []
    for (const log of consoleLogs) {
      contextManager.log(
        log.level === 'error' ? 'ERROR' : log.level === 'warn' ? 'WARN' : 'INFO',
        'code_execution',
        log.message
      )
    }

    // 5. Return result
    return lambdaResult.value.execution_result
  }

  /**
   * Extract variables from code and inputs
   */
  protected extractRequiredVariables(node: WorkflowNode): string[] {
    const config = node.data as unknown as CodeNodeData
    const variables = new Set<string>()

    // Extract from code (might contain {{variables}})
    if (config.code && typeof config.code === 'string') {
      this.extractVariableIds(config.code).forEach((v) => variables.add(v))
    }

    // Extract from inputs
    if (config.inputs && Array.isArray(config.inputs)) {
      config.inputs.forEach((input) => {
        if (input.variableId) {
          variables.add(input.variableId)
        }
      })
    }

    return Array.from(variables)
  }

  protected async validateNodeConfig(node: WorkflowNode): Promise<ValidationResult> {
    const errors: string[] = []
    const warnings: string[] = []
    const config = node.data as unknown as CodeNodeData

    // Title is not required in the current structure

    // Validate code
    if (!config.code || !config.code.trim()) {
      errors.push('Code is required')
    }

    // Validate code language
    if (!config.code_language) {
      errors.push('Code language is required')
    } else if (!['javascript', 'python3'].includes(config.code_language)) {
      errors.push(`Invalid code language: ${config.code_language}`)
    }

    // Validate JavaScript syntax
    if (config.code_language === 'javascript' && config.code) {
      try {
        new Function(config.code)

        // Check for main function definition
        if (!config.code.includes('main')) {
          errors.push('Code must define a main() function')
        }
      } catch (error) {
        errors.push(
          `JavaScript syntax error: ${error instanceof Error ? error.message : 'Invalid syntax'}`
        )
      }

      // Security warnings
      if (config.code.includes('eval(')) {
        warnings.push('Using eval() is potentially unsafe and should be avoided')
      }
      if (config.code.includes('Function(')) {
        warnings.push('Using Function constructor is potentially unsafe')
      }
      if (config.code.includes('require(')) {
        warnings.push('require() is not available in the Lambda sandbox environment')
      }
      if (config.code.includes('import ')) {
        warnings.push('ES6 imports are not supported, code runs in a sandboxed Lambda environment')
      }
      if (config.code.includes('setTimeout') || config.code.includes('setInterval')) {
        warnings.push('Timer functions (setTimeout, setInterval) are not available in the sandbox')
      }
    }

    // Validate inputs
    if (config.inputs && Array.isArray(config.inputs)) {
      for (let i = 0; i < config.inputs.length; i++) {
        const input = config.inputs[i]
        if (input) {
          if (!input.name || !input.name.trim()) {
            errors.push(`Input ${i + 1}: name is required`)
          }
          if (!input.variableId) {
            errors.push(`Input ${i + 1}: variableId is required`)
          }
        }
      }
    }

    // Validate outputs
    if (config.outputs && Array.isArray(config.outputs)) {
      for (let i = 0; i < config.outputs.length; i++) {
        const output = config.outputs[i]
        if (output) {
          if (!output.name || !output.name.trim()) {
            errors.push(`Output ${i + 1}: name is required`)
          }
        }
      }
    }

    // Python-specific validation
    if (config.code_language === 'python3') {
      errors.push('Python code execution is not implemented yet')
    }

    return { valid: errors.length === 0, errors, warnings }
  }
}
