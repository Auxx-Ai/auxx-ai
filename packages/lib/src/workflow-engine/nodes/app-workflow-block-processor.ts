// packages/lib/src/workflow-engine/nodes/app-workflow-block-processor.ts

/**
 * App Workflow Block Processor
 *
 * Integrates third-party app workflow blocks into the workflow engine.
 * Handles variable resolution, Lambda execution, output validation, and type coercion.
 *
 * Key features:
 * - Dynamic processor for any app block (type format: "appId:blockId")
 * - Resolves {{variable}} syntax in input fields before execution
 * - Passes full execution context to Lambda executor
 * - Validates and coerces output fields against declared schema
 * - Stores output fields in context manager for downstream nodes
 */

import { createScopedLogger } from '@auxx/logger'
import type { ExecutionContextManager } from '../core/execution-context'
import type {
  NodeExecutionResult,
  PreprocessedNodeData,
  ValidationResult,
  WorkflowNode,
} from '../core/types'
import { NodeRunningStatus } from '../core/types'
import { BaseNodeProcessor } from './base-node'

const logger = createScopedLogger('app-workflow-block-processor')

/**
 * Metadata for a workflow block from an app
 */
export interface WorkflowBlockMetadata {
  id: string
  label: string
  description: string
  category: string
  icon?: string
  color?: string
  schema: {
    inputs: Record<string, FieldDefinition>
    outputs: Record<string, FieldDefinition>
  }
  requiresConnection?: boolean
  connectionType?: string
  timeout?: number
  cacheable?: boolean
  cacheTTL?: number
  hasSideEffects?: boolean
  retries?: number
}

/**
 * Field definition in a workflow block schema
 */
export interface FieldDefinition {
  type: 'string' | 'number' | 'boolean' | 'object' | 'array' | 'date' | 'datetime' | string
  label: string
  description?: string
  required?: boolean
  default?: any
  placeholder?: string
  acceptsVariables?: boolean
  min?: number
  max?: number
  minLength?: number
  maxLength?: number
  pattern?: string
  options?: Array<{ label: string; value: any }>
}

/**
 * Preprocessed data for app workflow block execution
 */
interface AppBlockPreprocessedData extends PreprocessedNodeData {
  appId: string
  blockId: string
  installationId: string
  inputs: Record<string, any> // Resolved input values
  workflowContext: any
}

/**
 * App Workflow Block Processor
 * Processes workflow blocks from third-party apps
 */
export class AppWorkflowBlockProcessor extends BaseNodeProcessor {
  readonly type: string // Format: "appId:blockId"

  constructor(
    private appId: string,
    private blockId: string,
    private blockMetadata: WorkflowBlockMetadata
  ) {
    super()
    this.type = `${appId}:${blockId}`
  }

  /**
   * Preprocess node before execution
   * - Extract app metadata from node
   * - Resolve variables in input fields
   * - Build input object with resolved values
   * - Prepare workflow context for Lambda
   */
  public async preprocessNode(
    node: WorkflowNode,
    contextManager: ExecutionContextManager
  ): Promise<AppBlockPreprocessedData> {
    logger.debug('Preprocessing app workflow block', { nodeId: node.nodeId, type: this.type })

    // 1. Extract app metadata from node data
    let { appId, blockId, installationId } = node.data

    // Parse from type field if not present (fallback for nodes without explicit metadata)
    if (!appId || !blockId) {
      const nodeType = node.type as string
      if (nodeType?.includes(':')) {
        const [parsedAppId, parsedBlockId] = nodeType.split(':')
        appId = appId || parsedAppId
        blockId = blockId || parsedBlockId

        logger.debug('Parsed app metadata from type field', {
          nodeId: node.nodeId,
          nodeType,
          parsedAppId,
          parsedBlockId,
        })
      }
    }

    // Validate we have required fields after parsing
    if (!appId || !blockId) {
      throw new Error(
        `Unable to determine app ID and block ID for node ${node.nodeId}. ` +
          `Type: ${node.type}, Data: ${JSON.stringify(node.data)}`
      )
    }

    // 2. Resolve variables in input fields
    const resolvedInputs: Record<string, any> = {}

    for (const [fieldName, fieldValue] of Object.entries(node.data)) {
      // Skip metadata fields (prefixed with _)
      if (fieldName.startsWith('_')) continue

      // Skip non-input fields
      if (!this.blockMetadata.schema.inputs[fieldName]) continue

      // Resolve {{variable}} syntax to actual values
      const resolved = await this.resolveVariableValue(fieldValue, contextManager)
      resolvedInputs[fieldName] = resolved

      logger.debug('Resolved input field', {
        nodeId: node.nodeId,
        fieldName,
        original: fieldValue,
        resolved,
      })
    }

    // 3. Gather full execution context for Lambda
    const context = contextManager.getContext()
    const workflowContext = {
      workflowId: context.workflowId,
      executionId: context.executionId,
      nodeId: node.nodeId,

      // Enhanced context with full variable access
      variables: contextManager.getAllVariables(),
      environmentVariables: contextManager.getEnvironmentVariables(),
      systemVariables: contextManager.getSystemVariables(),
      triggerData: contextManager.getTriggerData(),

      // Node outputs (entire objects per node)
      nodeOutputs: contextManager.getAllNodeVariables(),

      // User and organization context
      user: {
        id: context.userId || '',
        email: (await contextManager.getVariable('sys.userEmail')) || '',
        name: (await contextManager.getVariable('sys.userName')) || '',
      },
      organization: {
        id: context.organizationId,
        handle: (await contextManager.getVariable('sys.organizationHandle')) || '',
        name: (await contextManager.getVariable('sys.organizationName')) || '',
      },
    }

    return {
      metadata: {
        nodeType: node.type,
        hasConfig: !!node.data,
      },
      appId: appId || this.appId,
      blockId: blockId || this.blockId,
      installationId: installationId,
      inputs: resolvedInputs,
      workflowContext,
    }
  }

  /**
   * Execute the app workflow block
   * - Call Lambda executor with resolved input object
   * - Handle connection requirements
   * - Store output object fields in contextManager
   */
  protected async executeNode(
    node: WorkflowNode,
    contextManager: ExecutionContextManager,
    preprocessedData?: PreprocessedNodeData
  ): Promise<Partial<NodeExecutionResult>> {
    const appData = preprocessedData as AppBlockPreprocessedData
    const { appId, blockId, installationId, inputs, workflowContext } = appData

    logger.info('Executing app workflow block', {
      nodeId: node.nodeId,
      appId,
      blockId,
      installationId,
    })

    // Validate required fields for Lambda execution
    const orgHandle = workflowContext.organization.handle

    if (!orgHandle) {
      throw new Error(
        `Organization handle is required for app workflow block execution. ` +
          `Organization: ${workflowContext.organization.name} (${workflowContext.organization.id})`
      )
    }

    try {
      // 1. Call Lambda executor (connection checking happens inside executeLambda)
      // The Lambda executor will verify connections if required
      const result = await this.executeLambda({
        appId,
        blockId,
        installationId,
        workflowContext,
        workflowInput: inputs,
        timeout: this.blockMetadata.timeout || 30000,
      })

      // 3. Validate outputs against schema (with type coercion)
      const validatedOutputs = this.validateAndCoerceOutputs(
        result.data,
        this.blockMetadata.schema.outputs
      )

      // 4. Store each output field in context for downstream nodes
      for (const [fieldName, fieldValue] of Object.entries(validatedOutputs)) {
        contextManager.setNodeVariable(node.nodeId, fieldName, fieldValue)
        logger.debug('Stored output field', { nodeId: node.nodeId, fieldName, fieldValue })
      }

      return {
        status: NodeRunningStatus.Succeeded,
        output: validatedOutputs,
        metadata: {
          executionTime: result.executionTime,
          logs: result.logs,
        },
      }
    } catch (error) {
      logger.error('App workflow block execution failed', {
        nodeId: node.nodeId,
        appId,
        blockId,
        error: error instanceof Error ? error.message : String(error),
      })

      throw this.createExecutionError(
        error instanceof Error ? error.message : 'Unknown error',
        node,
        {
          appId,
          blockId,
          installationId,
        },
        error instanceof Error ? error : undefined
      )
    }
  }

  /**
   * Extract variables from app block inputs
   */
  protected extractRequiredVariables(node: WorkflowNode): string[] {
    const config = node.data
    const variables = new Set<string>()

    // Extract from all input fields that might contain {{variable}} syntax
    if (config.inputs && typeof config.inputs === 'object') {
      Object.values(config.inputs).forEach((value: any) => {
        if (typeof value === 'string') {
          this.extractVariableIds(value).forEach((v) => variables.add(v))
        } else if (value && typeof value === 'object') {
          // Handle nested objects recursively
          this.extractVariablesFromValue(value, variables)
        }
      })
    }

    return Array.from(variables)
  }

  /**
   * Recursively extract variables from a value
   */
  private extractVariablesFromValue(value: any, variables: Set<string>): void {
    if (typeof value === 'string') {
      this.extractVariableIds(value).forEach((v) => variables.add(v))
    } else if (Array.isArray(value)) {
      value.forEach((item) => this.extractVariablesFromValue(item, variables))
    } else if (value && typeof value === 'object') {
      Object.values(value).forEach((v) => this.extractVariablesFromValue(v, variables))
    }
  }

  /**
   * Validate node configuration
   */
  protected async validateNodeConfig(node: WorkflowNode): Promise<ValidationResult> {
    const errors: string[] = []
    const warnings: string[] = []

    let { appId, blockId, installationId } = node.data

    // Parse from type field if not present (same logic as preprocessNode)
    if (!appId || !blockId) {
      const nodeType = node.type as string
      if (nodeType?.includes(':')) {
        const [parsedAppId, parsedBlockId] = nodeType.split(':')
        appId = appId || parsedAppId
        blockId = blockId || parsedBlockId
      }
    }

    // 1. Check required metadata (after parsing)
    if (!appId) {
      errors.push('App ID not configured and could not be parsed from node type')
    }

    if (!blockId) {
      errors.push('Block ID not configured and could not be parsed from node type')
    }

    // Installation ID is optional during validation - will be resolved at runtime if needed
    if (!installationId) {
      warnings.push('App installation not explicitly configured - will be resolved at runtime')
    }

    // 2. Validate required input fields
    for (const [fieldName, fieldDef] of Object.entries(this.blockMetadata.schema.inputs)) {
      if (fieldDef.required && !node.data[fieldName]) {
        errors.push(`Required input field '${fieldName}' not provided`)
      }
    }

    // 3. Check connection if needed
    if (this.blockMetadata.requiresConnection && !installationId) {
      errors.push(`App ${this.appId} requires connection but installation not configured`)
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    }
  }

  /**
   * Validate and coerce outputs to match declared schema
   * Lenient approach: transform types instead of failing
   */
  private validateAndCoerceOutputs(
    outputs: Record<string, any>,
    schema: Record<string, FieldDefinition>
  ): Record<string, any> {
    // If schema is empty, pass through all outputs (permissive mode)
    // Backend creates blocks with empty schemas as "permissive default" since
    // schemas are only available in the app runtime, not on the backend
    if (Object.keys(schema).length === 0) {
      logger.debug('No output schema defined, passing through all outputs', {
        outputKeys: Object.keys(outputs),
      })
      return outputs
    }

    const validated: Record<string, any> = {}

    for (const [fieldName, fieldDef] of Object.entries(schema)) {
      const value = outputs[fieldName]

      // Check required fields
      if (fieldDef.required && value === undefined) {
        throw new Error(`Required output field '${fieldName}' not returned by app`)
      }

      // Type coercion
      if (value !== undefined) {
        try {
          validated[fieldName] = this.coerceType(value, fieldDef.type)
        } catch (error) {
          logger.warn('Failed to coerce output field', {
            fieldName,
            value,
            expectedType: fieldDef.type,
            error: error instanceof Error ? error.message : String(error),
          })
          // Store original value if coercion fails
          validated[fieldName] = value
        }
      }
    }

    return validated
  }

  /**
   * Type coercion for output fields
   */
  private coerceType(value: any, type: string): any {
    if (value === null || value === undefined) {
      return value
    }

    switch (type) {
      case 'string':
        return String(value)

      case 'number': {
        const num = Number(value)
        if (Number.isNaN(num)) {
          throw new Error(`Cannot coerce "${value}" to number`)
        }
        return num
      }

      case 'boolean':
        // Handle string booleans
        if (typeof value === 'string') {
          const lower = value.toLowerCase()
          if (lower === 'true') return true
          if (lower === 'false') return false
        }
        return Boolean(value)

      case 'object':
        return typeof value === 'object' && !Array.isArray(value) ? value : {}

      case 'array':
        return Array.isArray(value) ? value : []

      case 'date':
      case 'datetime':
        return value instanceof Date ? value : new Date(value)

      default:
        return value
    }
  }

  /**
   * Execute Lambda function for app workflow block
   */
  private async executeLambda(options: {
    appId: string
    blockId: string
    installationId: string
    workflowContext: any
    workflowInput: Record<string, any>
    timeout: number
  }): Promise<{
    data: Record<string, any>
    logs: string[]
    executionTime: number
  }> {
    const { appId, blockId, installationId, workflowContext, workflowInput, timeout } = options

    const startTime = Date.now()

    try {
      // Import services dynamically to avoid circular dependencies
      const { getInstallationBundle } = await import('@auxx/services/app-installations')
      const { resolveAppConnectionForRuntime } = await import('@auxx/services/app-connections')
      const { prepareLambdaContext, invokeLambdaExecutor } = await import(
        '@auxx/services/lambda-execution'
      )

      // 1. Get app installation and bundle
      const installationResult = await getInstallationBundle({
        installationId,
        organizationHandle: workflowContext.organization.handle!,
        appId,
      })

      if (installationResult.isErr()) {
        const error = installationResult.error
        throw new Error(`Failed to get installation bundle: ${error.message}`)
      }

      const { installation, bundle } = installationResult.value

      if (!bundle.serverBundleS3Key) {
        throw new Error('App does not have a server bundle')
      }

      // 2. Resolve app connections
      const connectionsResult = await resolveAppConnectionForRuntime({
        appId,
        organizationId: workflowContext.organization.id,
        userId: workflowContext.user.id,
        versionMajor: installation.currentVersion?.major || 1,
      })

      if (connectionsResult.isErr()) {
        const error = connectionsResult.error
        throw new Error(`Failed to resolve connections: ${error.message}`)
      }

      const connections = connectionsResult.value

      // 3. Prepare Lambda context
      const baseContext = prepareLambdaContext({
        appId,
        installationId: installation.id,
        organizationId: workflowContext.organization.id,
        organizationHandle: workflowContext.organization.handle,
        userId: workflowContext.user.id,
        userEmail: workflowContext.user.email,
        userName: workflowContext.user.name,
        userConnection: connections.userConnection,
        organizationConnection: connections.organizationConnection,
      })

      // 4. Invoke Lambda executor
      const lambdaResult = await invokeLambdaExecutor({
        caller: 'workflow-engine',
        payload: {
          type: 'workflow-block',
          bundleKey: bundle.serverBundleS3Key,
          blockId,
          workflowContext,
          workflowInput,
          context: baseContext,
          timeout,
        },
      })

      if (lambdaResult.isErr()) {
        const error = lambdaResult.error
        throw new Error(`Lambda execution failed: ${error.message}`)
      }

      const result = lambdaResult.value
      const endTime = Date.now()

      // Extract data from result
      const data = result.execution_result?.data || result.execution_result || {}
      const logs =
        result.metadata?.consoleLogs?.map((log: any) => `[${log.level}] ${log.message}`) || []

      return {
        data,
        logs,
        executionTime: endTime - startTime,
      }
    } catch (error) {
      const endTime = Date.now()
      logger.error('Lambda execution failed', {
        appId,
        blockId,
        error: error instanceof Error ? error.message : String(error),
      })

      throw error
    }
  }
}
