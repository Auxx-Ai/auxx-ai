// packages/lib/src/workflow-engine/nodes/base-node.ts

import { createScopedLogger } from '@auxx/logger'
import {
  type NodeErrorContext,
  WorkflowNodeConfigurationError,
  WorkflowNodeError,
  WorkflowNodeExecutionError,
  WorkflowNodeProcessingError,
  WorkflowNodeValidationError,
} from '../core/errors'
import type { ExecutionContextManager } from '../core/execution-context'
import type {
  NodeExecutionResult,
  NodeProcessor,
  PreprocessedNodeData,
  ValidationResult,
  WorkflowNode,
  WorkflowNodeType,
} from '../core/types'
import { NodeRunningStatus } from '../core/types'
import { safeJsonStringify } from '../utils/serialization'

const logger = createScopedLogger('base-node')

/**
 * Abstract base class for all workflow node processors
 */
export abstract class BaseNodeProcessor implements NodeProcessor {
  abstract readonly type: WorkflowNodeType | string // string supports app blocks (format: "appId:blockId")

  /**
   * Default preprocessing implementation - stores minimal node configuration
   * Override in subclasses for specific preprocessing logic
   */
  async preprocessNode(
    node: WorkflowNode,
    contextManager: ExecutionContextManager
  ): Promise<PreprocessedNodeData> {
    return {
      inputs: {
        nodeId: node.nodeId,
        nodeType: node.type,
        config: node.data || {},
      },
      metadata: {
        nodeType: node.type,
        hasConfig: !!node.data,
      },
    }
  }

  /**
   * Execute the node with the given context
   */
  async execute(
    node: WorkflowNode,
    contextManager: ExecutionContextManager,
    preprocessedData?: PreprocessedNodeData
  ): Promise<NodeExecutionResult> {
    const startTime = Date.now()

    try {
      // Extract required variables
      const requiredVariables = this.extractRequiredVariables(node)

      // Pre-validate variables exist
      if (requiredVariables.length > 0) {
        const validation = await contextManager.validateRequiredVariables(requiredVariables)

        if (!validation.valid) {
          // Get validation mode from options (default to 'warn' for backward compatibility)
          const options = contextManager.getOptions()
          const mode = options?.variableValidationMode ?? 'warn'

          // Build helpful error message
          const availableVars = contextManager.getAvailableVariableIds()
          const variablesByNode = contextManager.getVariablesByNode()

          let errorMessage = `Node "${node.name}" requires variables that are not available:\n`
          errorMessage += `\nMissing variables:\n`

          validation.missingVariables.forEach((missing) => {
            errorMessage += `  - ${missing}\n`

            // Check for partial matches
            const partial = validation.partialMatches.find((p) => p.requested === missing)
            if (partial && partial.available.length > 0) {
              errorMessage += `    Similar variables available: ${partial.available.slice(0, 3).join(', ')}\n`
            }
          })

          errorMessage += `\nAvailable variables:\n`

          // Group by node for better readability
          for (const [nodeId, vars] of variablesByNode) {
            errorMessage += `  ${nodeId}:\n`
            vars.slice(0, 5).forEach((v) => {
              errorMessage += `    - ${v}\n`
            })
            if (vars.length > 5) {
              errorMessage += `    ... and ${vars.length - 5} more\n`
            }
          }

          const errorMetadata = {
            requiredVariables,
            missingVariables: validation.missingVariables,
            availableVariables: availableVars,
            partialMatches: validation.partialMatches,
          }

          if (mode === 'strict') {
            // Fail execution
            contextManager.log('ERROR', node.name, errorMessage, errorMetadata)
            throw this.createValidationError(errorMessage, node, errorMetadata)
          } else if (mode === 'warn') {
            // Log warning but continue
            contextManager.log('WARN', node.name, errorMessage, errorMetadata)
          }
          // If 'off', skip validation entirely
        } else {
          // Variables validated successfully
          contextManager.log('DEBUG', node.name, 'All required variables are available', {
            requiredVariables,
            availableVariables: validation.availableVariables,
          })
        }
      }

      // Validate node configuration before execution
      const configValidation = await this.validate(node)
      if (!configValidation.valid) {
        throw this.createValidationError(
          `Node validation failed: ${configValidation.errors.join(', ')}`,
          node,
          {
            validationErrors: configValidation.errors,
            validationWarnings: configValidation.warnings,
          }
        )
      }

      // Execute the specific node logic
      const result = await this.executeNode(node, contextManager, preprocessedData)

      const executionTime = Date.now() - startTime

      contextManager.log('INFO', node.name, `Node execution completed`, {
        status: result.status,
        executionTime,
        nextNodeId: result.nextNodeId,
        requiredVariables,
        variablesUsed: requiredVariables.length,
      })

      return {
        nodeId: node.nodeId,
        status: result.status || NodeRunningStatus.Succeeded,
        output: result.output,
        processData: result.processData,
        error: result.error,
        nextNodeId: result.nextNodeId,
        outputHandle: result.outputHandle,
        pauseReason: result.pauseReason,
        executionTime,
        metadata: {
          ...result.metadata,
          requiredVariables,
          variablesUsed: requiredVariables.length,
        },
      }
    } catch (error) {
      const executionTime = Date.now() - startTime

      // If it's already a WorkflowNodeError, re-throw it
      if (error instanceof WorkflowNodeError) {
        throw error
      }

      // Otherwise, wrap it in an execution error
      const errorMessage = error instanceof Error ? error.message : String(error)

      contextManager.log('ERROR', node.name, `Node execution failed: ${errorMessage}`, {
        error: errorMessage,
        stack: error instanceof Error ? error.stack : undefined,
        executionTime,
      })

      throw this.createExecutionError(
        errorMessage,
        node,
        {
          executionTime,
          errorType: error?.constructor?.name,
          stack: error instanceof Error ? error.stack : undefined,
        },
        error as Error
      )
    }
  }

  /**
   * Validate node configuration - override in subclasses
   */
  async validate(node: WorkflowNode): Promise<ValidationResult> {
    const errors: string[] = []
    const warnings: string[] = []

    // Basic validation
    if (!node.nodeId) {
      errors.push('Node ID is required')
    }

    if (!node.name) {
      errors.push('Node name is required')
    }

    if (node.type !== this.type) {
      errors.push(`Invalid node type. Expected ${this.type}, got ${node.type}`)
    }

    // Allow subclasses to add their own validation
    const customValidation = await this.validateNodeConfig(node)
    errors.push(...customValidation.errors)
    warnings.push(...customValidation.warnings)

    return { valid: errors.length === 0, errors, warnings }
  }

  /**
   * Abstract method for node-specific execution logic
   */
  protected abstract executeNode(
    node: WorkflowNode,
    contextManager: ExecutionContextManager,
    preprocessedData?: PreprocessedNodeData
  ): Promise<Partial<NodeExecutionResult>>

  /**
   * Override in subclasses for custom validation logic
   */
  protected async validateNodeConfig(node: WorkflowNode): Promise<ValidationResult> {
    return { valid: true, errors: [], warnings: [] }
  }

  /**
   * Extract variable IDs that this node requires from its configuration
   * Override in subclasses to specify which variables the node will use
   *
   * This enables:
   * - Pre-execution validation (check variables exist)
   * - Efficient context building (only include needed variables)
   * - Better error messages (identify missing variables)
   * - Variable dependency tracking
   *
   * @param node - The workflow node to analyze
   * @returns Array of variable IDs (e.g., ["webhook1.body.email", "find1.ticket.title"])
   *
   * @example
   * // AI node extracts from prompt templates
   * protected extractRequiredVariables(node: WorkflowNode): string[] {
   *   const data = node.data
   *   const variables = new Set<string>()
   *
   *   data.prompt_template?.forEach(template => {
   *     this.extractVariableIds(template.text).forEach(v => variables.add(v))
   *   })
   *
   *   return Array.from(variables)
   * }
   */
  protected extractRequiredVariables(node: WorkflowNode): string[] {
    // Default implementation - returns empty array
    // Subclasses should override to extract variables from their specific config
    return []
  }

  /**
   * Get optimized context with only required variables
   * Nodes can use this to build efficient context for external calls
   *
   * @param node - The workflow node
   * @param contextManager - The execution context
   * @returns Map with only required variables
   *
   * @example
   * // In AI node, pass only needed variables to AI service
   * const optimizedContext = this.getOptimizedContext(node, contextManager)
   * const contextObject = this.buildContextObject(optimizedContext)
   * await aiService.generate(prompt, contextObject)
   */
  protected getOptimizedContext(
    node: WorkflowNode,
    contextManager: ExecutionContextManager
  ): Map<string, unknown> {
    const requiredVariables = this.extractRequiredVariables(node)
    return contextManager.buildOptimizedContext(requiredVariables)
  }

  /**
   * Build context object from optimized context map
   * Useful for AI nodes that need to send minimal context
   *
   * @param optimizedContext - Map of variable IDs to values
   * @returns Plain object suitable for serialization
   *
   * @example
   * const optimizedContext = this.getOptimizedContext(node, contextManager)
   * const contextObject = this.buildContextObject(optimizedContext)
   * // contextObject = { 'webhook1.body.email': 'user@example.com', ... }
   */
  protected buildContextObject(optimizedContext: Map<string, unknown>): Record<string, unknown> {
    const obj: Record<string, unknown> = {}

    for (const [key, value] of optimizedContext) {
      obj[key] = value
    }

    return obj
  }

  /**
   * Check if required variables exist in context
   * Returns array of missing variable IDs
   * @deprecated Use contextManager.validateRequiredVariables() instead for better error messages
   */
  protected validateVariablesExist(
    variableIds: string[],
    contextManager: ExecutionContextManager
  ): string[] {
    const missing: string[] = []

    for (const varId of variableIds) {
      // Try to resolve the variable
      const value = contextManager.getVariable(varId)

      if (value === undefined) {
        // Variable not found - could be missing or not yet executed
        missing.push(varId)
      }
    }

    return missing
  }

  /**
   * Create standardized node error context for consistent error reporting
   */
  protected createNodeErrorContext(
    node: WorkflowNode,
    metadata: Record<string, any> = {}
  ): Omit<NodeErrorContext, 'errorSource'> {
    return {
      nodeId: node.nodeId,
      nodeType: node.type,
      nodeName: node.name,
      timestamp: new Date(),
      metadata,
    }
  }

  /**
   * Create a processing error with standardized context
   */
  protected createProcessingError(
    message: string,
    node: WorkflowNode,
    metadata: Record<string, any> = {},
    originalError?: Error
  ): WorkflowNodeProcessingError {
    return new WorkflowNodeProcessingError(
      message,
      this.createNodeErrorContext(node, metadata),
      originalError
    )
  }

  /**
   * Create an execution error with standardized context
   */
  protected createExecutionError(
    message: string,
    node: WorkflowNode,
    metadata: Record<string, any> = {},
    originalError?: Error
  ): WorkflowNodeExecutionError {
    return new WorkflowNodeExecutionError(
      message,
      this.createNodeErrorContext(node, metadata),
      originalError
    )
  }

  /**
   * Create a validation error with standardized context
   */
  protected createValidationError(
    message: string,
    node: WorkflowNode,
    metadata: Record<string, any> = {},
    originalError?: Error
  ): WorkflowNodeValidationError {
    return new WorkflowNodeValidationError(
      message,
      this.createNodeErrorContext(node, metadata),
      originalError
    )
  }

  /**
   * Create a configuration error with standardized context
   */
  protected createConfigurationError(
    message: string,
    node: WorkflowNode,
    metadata: Record<string, any> = {},
    originalError?: Error
  ): WorkflowNodeConfigurationError {
    return new WorkflowNodeConfigurationError(
      message,
      this.createNodeErrorContext(node, metadata),
      originalError
    )
  }

  /**
   * Enhanced variable resolution supporting new format {{variable.path}}
   * NOW ASYNC for lazy loading support
   *
   * Handles three cases:
   * 1. Template strings with {{variable}}: "Hello {{name}}" → "Hello John"
   * 2. Plain variable paths: "nodeId.field.path" → resolved value
   * 3. Literal strings: "constant" → "constant"
   */
  protected async resolveVariableValue(
    value: any,
    contextManager: ExecutionContextManager
  ): Promise<any> {
    if (typeof value !== 'string') {
      return value
    }

    // Handle {{variable}} format (template strings)
    if (value.includes('{{') && value.includes('}}')) {
      return await this.interpolateVariables(value, contextManager)
    }

    // Check if this is a plain variable path (e.g., "nodeId.field.path")
    // Variable paths typically contain dots and reference workflow variables
    if (value.includes('.')) {
      // Try to find a matching variable prefix
      // Check progressively longer prefixes: nodeId, nodeId.resource, etc.
      const segments = value.split('.')

      for (let i = 1; i <= segments.length; i++) {
        const prefix = segments.slice(0, i).join('.')
        const prefixValue = await contextManager.getVariable(prefix)

        if (prefixValue !== undefined) {
          // Found a matching variable prefix - this IS a variable path
          // Now resolve the full path (may trigger lazy loading)
          const resolved = await contextManager.getVariable(value)
          return resolved // May be undefined if the nested path doesn't exist
        }
      }
    }

    // Return as literal value
    return value
  }

  /**
   * Interpolate variables in a string template
   * NOW ASYNC for lazy loading support
   */
  protected async interpolateVariables(
    template: string,
    contextManager: ExecutionContextManager
  ): Promise<string> {
    return await contextManager.interpolateVariables(template)
  }

  /**
   * Resolve a variable path (e.g., "message.subject", "env.API_KEY", "sys.currentTime")
   * NOW ASYNC for lazy loading support
   */
  protected async resolveVariablePath(
    path: string,
    contextManager: ExecutionContextManager
  ): Promise<any> {
    return await contextManager.getVariable(path)
  }

  /**
   * DEPRECATED: Sync version kept for backward compatibility
   * Use resolveVariablePath instead
   * Note: This method is truly synchronous and only accesses pre-loaded variables
   */
  protected resolveVariablePathSync(path: string, contextManager: ExecutionContextManager): any {
    // Direct variable lookup (handles env.*, sys.*, message.*, etc.)
    const allVars = contextManager.getAllVariables()
    const directValue = allVars[path]
    if (directValue !== undefined) {
      return directValue
    }

    // Try underscore format (e.g., node_id_property instead of node-id.property)
    const underscorePath = path.replace(/\./g, '_')
    const underscoreValue = allVars[underscorePath]
    if (underscoreValue !== undefined) {
      return underscoreValue
    }

    // Handle nested object access (e.g., message.from.email)
    const parts = path.split('.')
    if (parts.length > 1) {
      // Try to get the root object
      const rootKey = parts[0]
      if (rootKey) {
        const rootValue = allVars[rootKey]
        if (rootValue && typeof rootValue === 'object') {
          return this.getNestedProperty(rootValue, parts.slice(1).join('.'))
        }
      }
    }

    // Legacy support for old format paths
    if (path.startsWith('variables.')) {
      const varName = path.substring(10)
      return allVars[varName]
    }

    return undefined
  }

  /**
   * Get nested property from object using dot notation
   */
  protected getNestedProperty(obj: any, path: string): any {
    return path.split('.').reduce((current, prop) => {
      if (current === null || current === undefined) return undefined

      // Handle array access like "items[0]"
      const arrayMatch = prop.match(/^(.+)\[(\d+)\]$/)
      if (arrayMatch) {
        const [, arrayProp, index] = arrayMatch
        if (arrayProp && index !== undefined) {
          const array = current[arrayProp]
          return Array.isArray(array) ? array[parseInt(index, 10)] : undefined
        }
      }

      return current[prop]
    }, obj)
  }

  /**
   * Helper method to get branch connection for switch nodes
   */

  /**
   * Helper method to evaluate expressions with context variables
   */
  protected evaluateExpression(expression: string, contextManager: ExecutionContextManager): any {
    try {
      // Create a safe evaluation context
      const context = {
        variables: contextManager.getAllVariables(),
        message: contextManager.getContext().message,
        triggerData: contextManager.getContext().triggerData,
      }

      // Simple expression evaluation (can be enhanced with a proper expression parser)
      // For now, support basic property access and comparisons
      return this.safeEvaluate(expression, context)
    } catch (error) {
      logger.warn('Expression evaluation failed', {
        expression,
        error: error instanceof Error ? error.message : String(error),
      })
      return false
    }
  }

  /**
   * Safe expression evaluation (basic implementation)
   */
  private safeEvaluate(expression: string, context: any): any {
    // This is a simplified implementation

    // Handle simple property access like "message.subject" or "variables.category"
    if (expression.includes('.')) {
      const parts = expression.split('.')
      let result = context

      for (const part of parts) {
        if (result && typeof result === 'object' && part in result) {
          result = result[part]
        } else {
          return undefined
        }
      }

      return result
    }

    // Handle simple comparisons
    if (expression.includes('===')) {
      const parts = expression.split('===').map((s) => s.trim())
      if (parts.length !== 2 || !parts[0] || !parts[1]) return false
      return this.safeEvaluate(parts[0], context) === this.parseValue(parts[1])
    }

    if (expression.includes('!==')) {
      const parts = expression.split('!==').map((s) => s.trim())
      if (parts.length !== 2 || !parts[0] || !parts[1]) return false
      return this.safeEvaluate(parts[0], context) !== this.parseValue(parts[1])
    }

    if (expression.includes('==')) {
      const parts = expression.split('==').map((s) => s.trim())
      if (parts.length !== 2 || !parts[0] || !parts[1]) return false
      return this.safeEvaluate(parts[0], context) == this.parseValue(parts[1])
    }

    // Handle simple values
    return this.parseValue(expression)
  }

  /**
   * Extract variable IDs from text containing {{variableId}} patterns
   */
  protected extractVariableIds(text: string): string[] {
    const variableIds: string[] = []
    const regex = /\{\{([^}]+)\}\}/g
    let match: RegExpExecArray | null

    while ((match = regex.exec(text)) !== null) {
      if (match[1]) {
        const variableId = match[1].trim()
        if (variableId && !variableIds.includes(variableId)) {
          variableIds.push(variableId)
        }
      }
    }

    return variableIds
  }

  /**
   * Resolve a variable and extract its ID from various input formats.
   * Combines resolveVariableValue() with ID extraction for relation fields.
   *
   * Handles:
   * - Direct ID string: "ticket_123" → "ticket_123"
   * - Resource object: { id: "ticket_123", ... } → "ticket_123"
   * - ResourceReference: { __resourceRef: true, resourceId: "abc123", ... } → "abc123"
   * - Resource reference: { reference: "ticket:123", ... } → "123"
   * - Null/undefined → undefined
   * - Empty string → undefined
   *
   * @param value - The raw value from node config (may be variable path or literal)
   * @param contextManager - The execution context for variable resolution
   * @returns The extracted ID string, or undefined if not extractable
   */
  protected async extractIdFromValue(
    value: any,
    contextManager: ExecutionContextManager
  ): Promise<string | undefined> {
    // First resolve the variable if it's a variable reference
    const resolvedValue = await this.resolveVariableValue(value, contextManager)

    // Handle null/undefined
    if (resolvedValue === null || resolvedValue === undefined) {
      return undefined
    }

    // Handle direct string ID
    if (typeof resolvedValue === 'string') {
      // Treat empty string as undefined
      return resolvedValue.trim() === '' ? undefined : resolvedValue
    }

    // Handle object with id property
    if (typeof resolvedValue === 'object') {
      // Try .id property first (most common)
      if (resolvedValue.id && typeof resolvedValue.id === 'string') {
        return resolvedValue.id.trim() === '' ? undefined : resolvedValue.id
      }

      // Handle ResourceReference objects (__resourceRef marker)
      if (
        resolvedValue.__resourceRef === true &&
        resolvedValue.resourceId &&
        typeof resolvedValue.resourceId === 'string'
      ) {
        return resolvedValue.resourceId.trim() === '' ? undefined : resolvedValue.resourceId
      }

      // Try resource reference format (legacy)
      if (resolvedValue.referenceId && typeof resolvedValue.referenceId === 'string') {
        return resolvedValue.referenceId.trim() === '' ? undefined : resolvedValue.referenceId
      }

      // Try reference string parsing (e.g., "ticket:123")
      if (resolvedValue.reference && typeof resolvedValue.reference === 'string') {
        const parts = resolvedValue.reference.split(':')
        if (parts.length === 2 && parts[1]) {
          return parts[1].trim() === '' ? undefined : parts[1]
        }
      }

      // If we got an object but couldn't extract ID, return undefined
      return undefined
    }

    return undefined
  }

  /**
   * Parse string values to appropriate types
   */
  private parseValue(value: string): any {
    const trimmed = value.trim()

    // String literals
    if (
      (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'"))
    ) {
      return trimmed.slice(1, -1)
    }

    // Numbers
    if (/^\d+$/.test(trimmed)) {
      return parseInt(trimmed, 10)
    }

    if (/^\d+\.\d+$/.test(trimmed)) {
      return parseFloat(trimmed)
    }

    // Booleans
    if (trimmed === 'true') return true
    if (trimmed === 'false') return false
    if (trimmed === 'null') return null
    if (trimmed === 'undefined') return undefined

    // Return as string if no other type matches
    return trimmed
  }
}
