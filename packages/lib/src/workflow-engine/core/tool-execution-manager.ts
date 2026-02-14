// packages/lib/src/workflow-engine/core/tool-execution-manager.ts

import { createScopedLogger } from '@auxx/logger'
import { v4 as uuidv4 } from 'uuid'
import type { ExecutionContextManager } from './execution-context'
import type { NodeProcessorRegistry } from './node-processor-registry'
import type { ToolDefinition, ToolExecutionResult, ToolRegistry } from './tool-registry'
import type { NodeData, NodeExecutionResult, Workflow, WorkflowNode } from './types'
import { NodeRunningStatus } from './types'

const logger = createScopedLogger('tool-execution-manager')

/**
 * Tool execution context
 */
export interface ToolExecutionContext {
  toolId: string
  parentNodeId: string
  executionId: string
  workflowId: string
  inputs: Record<string, any>
  startTime: number
  credentialId?: string
  aiNodeData?: any // AI node data containing tool credentials
}

/**
 * Manages execution of tools within AI nodes
 */
export class ToolExecutionManager {
  private nodeRegistry: NodeProcessorRegistry
  private toolRegistry: ToolRegistry
  private activeExecutions = new Map<string, ToolExecutionContext>()

  constructor(nodeRegistry: NodeProcessorRegistry, toolRegistry: ToolRegistry) {
    this.nodeRegistry = nodeRegistry
    this.toolRegistry = toolRegistry
  }

  /**
   * Execute a tool with the given inputs
   */
  async executeTool(
    toolId: string,
    inputs: Record<string, any>,
    contextManager: ExecutionContextManager,
    parentNodeId: string,
    workflow: Workflow,
    aiNodeData?: any
  ): Promise<ToolExecutionResult> {
    const executionId = uuidv4()
    const startTime = Date.now()

    // Resolve credential for this tool
    const credentialId = this.resolveToolCredential(toolId, aiNodeData)

    // Create execution context
    const toolContext: ToolExecutionContext = {
      toolId,
      parentNodeId,
      executionId,
      workflowId: workflow.workflowId,
      inputs,
      startTime,
      credentialId,
      aiNodeData,
    }

    this.activeExecutions.set(executionId, toolContext)

    try {
      logger.debug('Starting tool execution', {
        toolId,
        parentNodeId,
        executionId,
        inputs: Object.keys(inputs),
      })

      // Get tool definition
      const tool = this.toolRegistry.getTool(toolId, workflow)
      if (!tool) {
        throw new Error(`Tool not found: ${toolId}`)
      }

      // Validate inputs against tool schema
      this.validateToolInputs(inputs, tool)

      // Create a temporary workflow node for execution
      const toolNode = this.createToolNode(tool, inputs, parentNodeId, credentialId)

      // Get the appropriate node processor
      const processor = await this.nodeRegistry.getProcessor(tool.nodeType)
      if (!processor) {
        throw new Error(`No processor found for node type: ${tool.nodeType}`)
      }

      // Create isolated context for tool execution
      const toolContextManager = this.createToolContext(contextManager, toolNode, inputs)

      // Execute the tool through the node processor
      logger.debug('Executing tool through processor', {
        toolId,
        nodeType: tool.nodeType,
        processorType: processor.constructor.name,
      })

      const result = await processor.execute(toolNode, toolContextManager)

      // Map the result back to tool format
      const toolResult = this.mapNodeResultToToolResult(result, tool)

      const executionTime = Date.now() - startTime

      logger.info('Tool execution completed', {
        toolId,
        parentNodeId,
        executionId,
        status: result.status,
        executionTime,
      })

      return {
        success: result.status === NodeRunningStatus.Succeeded,
        output: toolResult,
        executionTime,
        metadata: {
          toolId,
          nodeType: tool.nodeType,
          executionId,
          parentNodeId,
        },
      }
    } catch (error) {
      const executionTime = Date.now() - startTime
      const errorMessage = error instanceof Error ? error.message : String(error)

      logger.error('Tool execution failed', {
        toolId,
        parentNodeId,
        executionId,
        error: errorMessage,
        executionTime,
      })

      return {
        success: false,
        output: {},
        error: errorMessage,
        executionTime,
        metadata: {
          toolId,
          parentNodeId,
          executionId,
        },
      }
    } finally {
      // Clean up execution context
      this.activeExecutions.delete(executionId)
    }
  }

  /**
   * Get currently active tool executions
   */
  getActiveExecutions(): ToolExecutionContext[] {
    return Array.from(this.activeExecutions.values())
  }

  /**
   * Cancel a tool execution (if supported by the processor)
   */
  async cancelExecution(executionId: string): Promise<boolean> {
    const context = this.activeExecutions.get(executionId)
    if (!context) {
      return false
    }

    logger.info('Cancelling tool execution', { executionId, toolId: context.toolId })

    // Note: Individual processors would need to implement cancellation support
    // For now, we just remove it from tracking
    this.activeExecutions.delete(executionId)
    return true
  }

  /**
   * Create a temporary workflow node for tool execution
   */
  private createToolNode(
    tool: ToolDefinition,
    inputs: Record<string, any>,
    parentNodeId: string,
    credentialId?: string
  ): WorkflowNode {
    const nodeId = `tool_${tool.id}_${Date.now()}`

    // Merge tool's pre-configured data with runtime inputs
    const nodeData: NodeData = {
      id: nodeId,
      type: tool.nodeType,
      title: `Tool: ${tool.name}`,
      desc: `Tool execution for ${tool.description}`,
      selected: false,
      ...tool.nodeConfig, // Pre-configured settings from the tool definition
      ...inputs, // Runtime inputs from AI
      // Add credential if provided
      ...(credentialId && { credentialId }),
      // Metadata to identify this as a tool execution
      _isToolExecution: true,
      _toolId: tool.id,
      _parentNodeId: parentNodeId,
    }

    return {
      id: nodeId,
      workflowId: `tool_execution_${Date.now()}`,
      nodeId,
      type: tool.nodeType,
      name: tool.name,
      description: tool.description,
      data: nodeData,
    }
  }

  /**
   * Create an isolated execution context for tool execution
   */
  private createToolContext(
    parentContext: ExecutionContextManager,
    toolNode: WorkflowNode,
    inputs: Record<string, any>
  ): ExecutionContextManager {
    // Create a new context that inherits from parent but is isolated
    const toolContext = parentContext.createChildContext(`tool_${toolNode.nodeId}`)

    // Set tool inputs as variables in the isolated context
    Object.entries(inputs).forEach(([key, value]) => {
      toolContext.setVariable(`input.${key}`, value)
      toolContext.setVariable(key, value) // Also set without prefix for compatibility
    })

    // Set special tool variables
    toolContext.setVariable('tool.nodeId', toolNode.nodeId)
    toolContext.setVariable('tool.name', toolNode.name)

    logger.debug('Created tool execution context', {
      toolNodeId: toolNode.nodeId,
      inputKeys: Object.keys(inputs),
      availableVariables: toolContext.getAllVariableNames().length,
    })

    return toolContext
  }

  /**
   * Validate tool inputs against the tool's input schema
   */
  private validateToolInputs(inputs: Record<string, any>, tool: ToolDefinition): void {
    const schema = tool.inputSchema

    // Basic validation - check required fields
    if (schema.required) {
      for (const field of schema.required) {
        if (!(field in inputs)) {
          throw new Error(`Missing required field: ${field}`)
        }
      }
    }

    // Type validation for properties
    if (schema.properties) {
      for (const [field, value] of Object.entries(inputs)) {
        const fieldSchema = schema.properties[field]
        if (fieldSchema && !this.validateFieldType(value, fieldSchema)) {
          throw new Error(`Invalid type for field ${field}: expected ${fieldSchema.type}`)
        }
      }
    }

    // Check for unexpected fields if additionalProperties is false
    if (schema.additionalProperties === false && schema.properties) {
      const allowedFields = Object.keys(schema.properties)
      const unexpectedFields = Object.keys(inputs).filter((field) => !allowedFields.includes(field))
      if (unexpectedFields.length > 0) {
        throw new Error(`Unexpected fields: ${unexpectedFields.join(', ')}`)
      }
    }

    logger.debug('Tool inputs validated successfully', {
      toolId: tool.id,
      inputFields: Object.keys(inputs),
    })
  }

  /**
   * Basic type validation for a field
   */
  private validateFieldType(value: any, schema: any): boolean {
    switch (schema.type) {
      case 'string':
        return typeof value === 'string'
      case 'number':
        return typeof value === 'number' && !Number.isNaN(value)
      case 'boolean':
        return typeof value === 'boolean'
      case 'object':
        return typeof value === 'object' && value !== null && !Array.isArray(value)
      case 'array':
        return Array.isArray(value)
      default:
        return true // Unknown type, allow it
    }
  }

  /**
   * Map node execution result to tool result format
   */
  private mapNodeResultToToolResult(
    result: NodeExecutionResult,
    tool: ToolDefinition
  ): Record<string, any> {
    // Start with the raw output
    const output = result.output || {}

    // Apply tool-specific mapping based on node type
    switch (tool.nodeType) {
      case 'http':
        return {
          data: output.data || output.response || output,
          status: output.status || output.statusCode || 200,
          headers: output.headers || {},
        }

      case 'crud':
        return {
          result: output.result || output.data || output,
          affected: output.affected || output.count || 0,
        }

      case 'find':
        return {
          results: output.results || output.data || output,
          count: output.count || output.total || 0,
        }

      case 'text-classifier':
        return {
          classification: output.classification || output.result || output,
          confidence: output.confidence || output.score || 0,
        }

      case 'information-extractor':
        return {
          extracted: output.extracted || output.result || output,
        }

      case 'var-assign':
        return {
          assigned: output.assigned || output.variables || output,
        }

      case 'code':
        return {
          result: output.result || output.output || output,
        }

      case 'date-time':
        return {
          result: output.result || output.formatted || output,
        }

      default:
        // Generic mapping - return the output as-is
        return output
    }
  }

  /**
   * Resolve credential ID for a specific tool
   */
  private resolveToolCredential(toolId: string, aiNodeData?: any): string | undefined {
    if (!aiNodeData?.tools) {
      return undefined
    }

    const toolCredentials = aiNodeData.tools.toolCredentials
    const defaultCredentials = aiNodeData.tools.defaultCredentials

    // First try tool-specific credential
    if (toolCredentials?.[toolId]) {
      logger.debug('Using tool-specific credential', {
        toolId,
        credentialId: toolCredentials[toolId],
      })
      return toolCredentials[toolId]
    }

    // Try default credential based on tool type
    // For built-in tools, use the tool ID as the key
    // For workflow nodes, we'd need the node type (handled in calling code)
    if (defaultCredentials) {
      // Try direct tool ID first (for built-in tools)
      if (defaultCredentials[toolId]) {
        logger.debug('Using default credential for tool', {
          toolId,
          credentialId: defaultCredentials[toolId],
        })
        return defaultCredentials[toolId]
      }

      // For workflow nodes, the calling code should pass the node type
      // This is a simplified implementation
    }

    logger.debug('No credential configured for tool', { toolId })
    return undefined
  }

  /**
   * Enhanced method to resolve credential with node type support
   */
  private resolveToolCredentialWithNodeType(
    toolId: string,
    nodeType?: string,
    aiNodeData?: any
  ): string | undefined {
    if (!aiNodeData?.tools) {
      return undefined
    }

    const toolCredentials = aiNodeData.tools.toolCredentials
    const defaultCredentials = aiNodeData.tools.defaultCredentials

    // First try tool-specific credential
    if (toolCredentials?.[toolId]) {
      return toolCredentials[toolId]
    }

    // Try default credential for node type (for workflow nodes)
    if (defaultCredentials && nodeType && defaultCredentials[nodeType]) {
      return defaultCredentials[nodeType]
    }

    return undefined
  }
}
