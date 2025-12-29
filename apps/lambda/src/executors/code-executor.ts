// apps/lambda/src/executors/code-executor.ts

/**
 * Code executor for Lambda runtime.
 * Executes user code in a sandboxed environment with variable access via $ function.
 */

import {
  interceptConsole,
  getCapturedLogs,
  restoreConsole,
  clearCapturedLogs,
} from '../runtime-helpers/index.ts'
import type { CodeExecutionEvent } from '../validator.ts'

/**
 * Execution result
 */
export interface ExecutionResult {
  /** Result returned from main() function */
  result: any
  /** Execution metadata */
  metadata: {
    /** Captured console logs */
    consoleLogs: Array<{
      level: 'log' | 'warn' | 'error'
      message: string
      args: unknown[]
      timestamp: number
    }>
    settingsSchema?: any
  }
}

/**
 * Helper to resolve variable paths with multiple fallback strategies
 * Ported from packages/lib/src/workflow-engine/nodes/action-nodes/code.ts:237-259
 */
function resolveVariablePath(path: string, variables: Record<string, any>): any {
  // 1. Direct lookup: "sys.currentTime"
  if (variables[path] !== undefined) {
    return variables[path]
  }

  // 2. Underscore format: "sys_currentTime" (for backwards compatibility)
  const underscorePath = path.replace(/\./g, '_')
  if (variables[underscorePath] !== undefined) {
    return variables[underscorePath]
  }

  // 3. Nested object access: "message.subject" where variables['message'] is an object
  const parts = path.split('.')
  if (parts.length > 1) {
    const rootValue = variables[parts[0]]
    if (rootValue && typeof rootValue === 'object') {
      return getNestedProperty(rootValue, parts.slice(1).join('.'))
    }
  }

  return undefined
}

/**
 * Helper for nested property access with array support
 * Ported from packages/lib/src/workflow-engine/nodes/action-nodes/code.ts:262-276
 */
function getNestedProperty(obj: any, path: string): any {
  return path.split('.').reduce((current, prop) => {
    if (current === null || current === undefined) return undefined

    // Handle array access like "items[0]"
    const arrayMatch = prop.match(/^(.+)\[(\d+)\]$/)
    if (arrayMatch) {
      const [, arrayProp, index] = arrayMatch
      const array = current[arrayProp]
      return Array.isArray(array) ? array[parseInt(index, 10)] : undefined
    }

    return current[prop]
  }, obj)
}

/**
 * Check if contextId is a known schema context
 * Ported from packages/lib/src/workflow-engine/nodes/action-nodes/code.ts:279-281
 */
function isSchemaContext(contextId: string): boolean {
  return ['message', 'order', 'customer', 'product', 'ticket', 'user'].includes(contextId)
}

/**
 * Create the $ function for variable access
 * Ported from packages/lib/src/workflow-engine/nodes/action-nodes/code.ts:284-298
 *
 * Usage:
 * - $('sys').var('currentTime') → looks up "sys.currentTime"
 * - $('env').var('apiKey') → looks up "env.apiKey"
 * - $('nodeId').var('result') → looks up "nodeId.result"
 */
function createDollarFunction(variables: Record<string, any>) {
  return function $(contextId: string) {
    return {
      var: function (varPath: string) {
        if (contextId === 'sys' || contextId === 'env' || isSchemaContext(contextId)) {
          // Handle system, environment, and schema variables
          const fullPath = contextId + '.' + varPath
          return resolveVariablePath(fullPath, variables)
        } else {
          // Handle node variables
          const fullPath = contextId + '.' + varPath
          return resolveVariablePath(fullPath, variables)
        }
      },
    }
  }
}

/**
 * Generate the wrapped code that includes $ function and main() execution
 */
function generateWrappedCode(
  userCode: string,
  inputsConfig: Array<{ name: string; variableId: string }>
): string {
  // Build argument list dynamically from inputsConfig
  const argList = inputsConfig.map((input) => `codeInput.${input.name}`).join(', ')

  return `
    return (async function() {
      'use strict';

      // Receive workflow variables and code inputs as parameters (not stringified!)
      // These are passed via Function constructor parameters below
      const __variables = variables;

      // $ function for variable access
      ${resolveVariablePath.toString()}
      ${getNestedProperty.toString()}
      ${isSchemaContext.toString()}

      const $ = function(contextId) {
        return {
          var: function(varPath) {
            if (contextId === 'sys' || contextId === 'env' || isSchemaContext(contextId)) {
              // Handle system, environment, and schema variables
              const fullPath = contextId + '.' + varPath;
              return resolveVariablePath(fullPath, __variables);
            } else {
              // Handle node variables
              const fullPath = contextId + '.' + varPath;
              return resolveVariablePath(fullPath, __variables);
            }
          }
        };
      };

      // User's code
      ${userCode}

      // Execute main function with input values as arguments
      if (typeof main === 'function') {
        // IMPORTANT: Pass input values as arguments in the order defined in inputsConfig
        // Access values from codeInput object (passed as parameter)
        // This preserves complex types: Dates, Functions, circular refs, etc.
        const argValues = [${argList}];
        return await main(...argValues);
      } else {
        throw new Error('Code must define a main() function');
      }
    })()
  `
}

/**
 * Execute JavaScript code in Deno sandbox
 */
async function executeJavaScript(
  code: string,
  codeInput: Record<string, any>,
  inputsConfig: Array<{ name: string; variableId: string }>,
  variables: Record<string, any>,
  timeout: number
): Promise<any> {
  // Generate wrapped code
  const wrappedCode = generateWrappedCode(code, inputsConfig)

  // Execute with timeout
  const timeoutPromise = new Promise((_, reject) => {
    setTimeout(() => reject(new Error(`Code execution timeout after ${timeout}ms`)), timeout)
  })

  const executionPromise = (async () => {
    try {
      // Execute wrapped code with values passed as parameters
      // This avoids JSON.stringify issues with complex objects
      const fn = new Function('variables', 'codeInput', wrappedCode)
      const result = await fn(variables, codeInput)
      return result
    } catch (error) {
      // Enhance error message
      if (error instanceof Error) {
        throw new Error(`Code execution error: ${error.message}\n${error.stack || ''}`)
      }
      throw error
    }
  })()

  return Promise.race([executionPromise, timeoutPromise])
}

/**
 * Execute Python code (placeholder for future implementation)
 */
async function executePython(
  _code: string,
  _codeInput: Record<string, any>,
  _inputsConfig: Array<{ name: string; variableId: string }>,
  _workflowVariables: Record<string, any>,
  _timeout: number
): Promise<any> {
  throw new Error('Python execution not yet implemented')
}

/**
 * Sanitize object for JSON serialization
 * Converts undefined values to null to preserve object structure
 * (JSON.stringify drops undefined properties, but preserves null)
 */
function sanitizeForJson(obj: any): any {
  // Primitives
  if (obj === undefined) return null
  if (obj === null) return null
  if (typeof obj !== 'object') return obj

  // Arrays
  if (Array.isArray(obj)) {
    return obj.map(sanitizeForJson)
  }

  // Objects
  const sanitized: Record<string, any> = {}
  for (const [key, value] of Object.entries(obj)) {
    sanitized[key] = value === undefined ? null : sanitizeForJson(value)
  }
  return sanitized
}

/**
 * Main code executor function.
 * Executes user code in a sandboxed environment with:
 * - $ function for workflow variable access
 * - Input variables passed as function parameters
 * - Console log capture
 * - Timeout enforcement
 *
 * Uses CodeExecutionEvent type from validator for type safety
 */
export async function executeCode(options: CodeExecutionEvent): Promise<ExecutionResult> {
  const {
    code,
    codeLanguage,
    codeInput = {}, // Default to empty object
    inputsConfig = [], // Default to empty array
    variables,
    timeout, // Default provided by Zod schema
  } = options
  console.log('LALAALAL', codeInput, inputsConfig)
  console.log('[CodeExecutor] Executing code:', {
    language: codeLanguage,
    timeout,
    inputCount: Object.keys(codeInput).length,
    variableCount: Object.keys(variables).length,
    workflowId: variables['sys.workflowId'],
    organizationId: variables['sys.organizationId'],
    userId: variables['sys.userId'],
  })

  try {
    // 1. Clear previous logs and intercept console
    clearCapturedLogs()
    interceptConsole()

    // 2. Execute code based on language
    let result: any
    if (codeLanguage === 'javascript') {
      result = await executeJavaScript(
        code,
        codeInput,
        inputsConfig,
        variables, // Pass all variables
        timeout
      )
    } else if (codeLanguage === 'python3') {
      result = await executePython(
        code,
        codeInput,
        inputsConfig,
        variables, // Pass all variables
        timeout
      )
    } else {
      throw new Error(`Unsupported language: ${codeLanguage}`)
    }

    // 3. Get captured logs
    const consoleLogs = getCapturedLogs()

    console.log('[CodeExecutor] Execution succeeded:', {
      resultType: typeof result,
      logCount: consoleLogs.length,
    })

    return {
      result: sanitizeForJson(result),
      metadata: { consoleLogs },
    }
  } finally {
    // 4. Always restore console
    restoreConsole()
  }
}
