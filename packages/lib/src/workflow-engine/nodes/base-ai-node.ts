// packages/lib/src/workflow-engine/nodes/base-ai-node.ts

import { database as db } from '@auxx/database'
import type { Message, Tool } from '../../ai/clients/base/types'
import { LLMOrchestrator } from '../../ai/orchestrator/llm-orchestrator'
import { UsageTrackingService } from '../../ai/usage/usage-tracking-service'
import { createScopedLogger } from '../../logger'
import type { ExecutionContextManager } from '../core/execution-context'
import type {
  NodeExecutionResult,
  PreprocessedNodeData,
  Workflow,
  WorkflowNode,
} from '../core/types'
import { NodeRunningStatus } from '../core/types'
import { BaseNodeProcessor } from './base-node'
import {
  buildInvocationOptions,
  type InvokeOrchestratorResponse,
  invokeOrchestrator,
  type StructuredOutputConfig,
} from './utils/ai-invocation-utils'
import {
  buildCompletionParams,
  createAICallbacks,
  extractModelConfig,
  extractOrgUserContext,
  resolveModelConfig,
} from './utils/ai-node-utils'

const logger = createScopedLogger('base-ai-node')

/**
 * Model configuration interface shared across AI nodes
 */
export interface BaseAiModelConfig {
  useDefault?: boolean
  provider: string
  name: string
  mode?: 'chat' | 'completion'
  completion_params?: Record<string, any>
}

/**
 * Abstract base class for all AI-powered workflow nodes
 *
 * This class eliminates code duplication across AI nodes by providing:
 * - Shared LLM orchestrator and usage tracking initialization
 * - Common AI invocation flow with proper error handling
 * - Standardized response formatting and variable storage
 * - Template method pattern for customization points
 *
 * Subclasses must implement:
 * - buildMessages(): Convert node config to AI messages
 * - handleResponse(): Process AI response and determine output
 * - getStructuredOutputConfig(): Define structured output schema if needed
 *
 * Subclasses may override:
 * - getDefaultTemperature(): Custom temperature defaults
 * - getTools(): Provide tools for the AI to use
 * - getToolExecutor(): Provide tool execution logic
 * - extractRequiredVariables(): Define what variables the node needs
 */
export abstract class BaseAiNodeProcessor extends BaseNodeProcessor {
  protected llmOrchestrator: LLMOrchestrator
  protected usageService: UsageTrackingService

  constructor() {
    super()

    // Initialize usage tracking service and orchestrator (shared across all AI nodes)
    this.usageService = new UsageTrackingService(db)
    this.llmOrchestrator = new LLMOrchestrator(
      this.usageService,
      db,
      {
        enableUsageTracking: true,
        enableQuotaEnforcement: true,
        defaultProvider: 'openai',
        defaultModel: 'gpt-4o-mini',
      },
      logger
    )
  }

  /**
   * Template method that orchestrates the AI node execution flow
   * This provides the common structure while allowing customization
   */
  protected async executeNode(
    node: WorkflowNode,
    contextManager: ExecutionContextManager,
    preprocessedData?: PreprocessedNodeData
  ): Promise<Partial<NodeExecutionResult>> {
    const startTime = Date.now()

    // Access node configuration
    const data = node.data as any

    if (!data) {
      throw new Error(`AI node configuration is missing. Expected data in node.data`)
    }

    // Get organization and user context
    const { organizationId, userId } = await extractOrgUserContext(contextManager)

    // Get current workflow for tools and context
    const currentWorkflow = (await contextManager.getVariable('sys.workflow')) as Workflow

    contextManager.log('INFO', node.name, 'Starting AI node execution', {
      nodeType: this.type,
      model: data.model,
    })

    try {
      // Step 1: Build messages from node configuration (subclass-specific)
      const messages = await this.buildMessages(node, data, contextManager)

      // Step 2: Get model configuration (resolve useDefault at execution time)
      const modelConfig = data.model as BaseAiModelConfig
      const extracted = extractModelConfig(modelConfig)
      const { provider, model } = await resolveModelConfig(extracted, db, organizationId)

      // Step 3: Build completion parameters with defaults
      const completionParams = buildCompletionParams(modelConfig, {
        temperature: this.getDefaultTemperature(),
      })

      // Step 4: Get structured output configuration if needed
      const structuredOutput = this.getStructuredOutputConfig(node, data)

      // Step 5: Get tools if the node supports them
      const tools = await this.getTools(node, data, currentWorkflow, contextManager)

      // Step 6: Get tool executor if tools are provided
      const toolExecutor =
        tools && tools.length > 0
          ? await this.getToolExecutor(node, data, currentWorkflow, contextManager)
          : undefined

      // Step 7: Create callbacks for logging
      const callbacks = createAICallbacks(contextManager, node.nodeId)

      contextManager.log('DEBUG', node.name, 'Invoking LLM orchestrator', {
        provider,
        model,
        messageCount: messages.length,
        hasTools: !!tools?.length,
        hasStructuredOutput: !!structuredOutput?.enabled,
      })

      // Step 8: Build invocation options
      const invocationOptions = buildInvocationOptions(
        {
          model,
          provider,
          messages,
          parameters: completionParams,
          organizationId,
          userId,
          nodeId: node.nodeId,
          source: `workflow_${this.type}_node`,
          workflowId: currentWorkflow?.id,
          callbacks,
        },
        {
          tools,
          toolExecutor,
          structuredOutput,
          workflow: currentWorkflow,
        }
      )

      // Step 9: Invoke the orchestrator
      const response = await invokeOrchestrator(this.llmOrchestrator, invocationOptions)

      // Step 10: Store standard AI response variables
      this.storeAIResponse(node, contextManager, response, data)

      // Step 11: Let subclass handle response and determine output (subclass-specific)
      const result = await this.handleResponse(node, data, contextManager, response)

      contextManager.log('INFO', node.name, 'AI node execution completed successfully', {
        responseLength: response.content.length,
        hasStructuredOutput: !!response.structured_output,
        toolCallsCount: response.tool_calls?.length || 0,
        usage: response.usage,
        executionTime: Date.now() - startTime,
      })

      // Step 12: Return standardized result with metadata
      return {
        status: result.status || NodeRunningStatus.Succeeded,
        output: {
          text: response.content,
          content: response.content,
          structured_output: response.structured_output,
          tool_calls: response.tool_calls,
          tool_results: response.tool_results,
          model: response.model,
          usage: response.usage,
          ...result.output,
        },
        processData: {
          model: {
            provider,
            name: model,
            temperature: completionParams.temperature,
            maxTokens: completionParams.max_tokens,
          },
          finalPrompts: messages.map((m) => ({ role: m.role, content: m.content })),
          structuredOutput: {
            enabled: structuredOutput?.enabled || false,
            schema: structuredOutput?.schema,
          },
          tokenUsage: response.usage,
          executionTime: Date.now() - startTime,
          ...result.processData,
        },
        metadata: {
          model: response.model,
          provider: response.provider,
          temperature: completionParams.temperature,
          promptTokens: response.usage?.prompt_tokens,
          completionTokens: response.usage?.completion_tokens,
          totalTokens: response.usage?.total_tokens,
          ...result.metadata,
        },
        outputHandle: result.outputHandle || 'source',
        nextNodeId: result.nextNodeId,
      }
    } catch (error) {
      contextManager.log('ERROR', node.name, 'AI node execution failed', {
        error: error instanceof Error ? error.message : String(error),
      })
      throw error
    }
  }

  /**
   * Store AI response in context variables
   * This provides consistent variable naming across all AI nodes
   */
  private storeAIResponse(
    node: WorkflowNode,
    contextManager: ExecutionContextManager,
    response: InvokeOrchestratorResponse,
    data: any
  ): void {
    // Store in custom output variable if specified
    const outputVariable = data.outputVariable || `${node.nodeId}.text`
    contextManager.setVariable(outputVariable, response.content)

    // Store as standard node variables
    contextManager.setNodeVariable(node.nodeId, 'output', response.content)
    contextManager.setNodeVariable(node.nodeId, 'text', response.content)

    // Store structured output if present
    if (response.structured_output) {
      contextManager.setNodeVariable(node.nodeId, 'structured_output', response.structured_output)

      // Store individual fields for easy access
      Object.entries(response.structured_output).forEach(([key, value]) => {
        contextManager.setNodeVariable(node.nodeId, key, value)
      })
    }

    // Store tool results if present
    if (response.tool_results) {
      contextManager.setNodeVariable(node.nodeId, 'tool_results', response.tool_results)

      // Store individual tool results for easy access
      response.tool_results.forEach((result, index) => {
        contextManager.setNodeVariable(node.nodeId, `tool_${index}`, result.output)
        contextManager.setNodeVariable(node.nodeId, `tool_${result.toolName}`, result.output)
      })
    }
  }

  // ===== ABSTRACT METHODS - Subclasses must implement =====

  /**
   * Build messages array from node configuration
   * This is where subclasses convert their specific config format to AI messages
   *
   * @param node - The workflow node
   * @param data - The node configuration data
   * @param contextManager - The execution context
   * @returns Array of messages to send to the AI
   *
   * @example
   * // AI-v2 node with prompt templates
   * protected async buildMessages(node, data, contextManager): Promise<Message[]> {
   *   return data.prompt_template.map(template => ({
   *     role: template.role,
   *     content: await this.interpolateVariables(template.text, contextManager)
   *   }))
   * }
   *
   * @example
   * // Text classifier node with system/user prompts
   * protected async buildMessages(node, data, contextManager): Promise<Message[]> {
   *   return [
   *     { role: 'system', content: this.buildSystemPrompt(data) },
   *     { role: 'user', content: this.buildUserPrompt(data, contextManager) }
   *   ]
   * }
   */
  protected abstract buildMessages(
    node: WorkflowNode,
    data: any,
    contextManager: ExecutionContextManager
  ): Promise<Message[]>

  /**
   * Handle the AI response and determine node output
   * This is where subclasses process the AI response and decide what happens next
   *
   * @param node - The workflow node
   * @param data - The node configuration data
   * @param contextManager - The execution context
   * @param response - The AI response from the orchestrator
   * @returns Partial result with status, output, and routing information
   *
   * @example
   * // AI-v2 node - simple pass-through
   * protected async handleResponse(node, data, contextManager, response) {
   *   return {
   *     status: NodeRunningStatus.Succeeded,
   *     output: { result: response.content },
   *     outputHandle: 'source'
   *   }
   * }
   *
   * @example
   * // Text classifier node - route based on category
   * protected async handleResponse(node, data, contextManager, response) {
   *   const category = response.structured_output?.category
   *   const outputHandle = this.getOutputHandleForCategory(category, data.classes)
   *
   *   return {
   *     status: NodeRunningStatus.Succeeded,
   *     output: { category, confidence: response.structured_output?.confidence },
   *     outputHandle
   *   }
   * }
   */
  protected abstract handleResponse(
    node: WorkflowNode,
    data: any,
    contextManager: ExecutionContextManager,
    response: InvokeOrchestratorResponse
  ): Promise<Partial<NodeExecutionResult>>

  /**
   * Get structured output configuration for this node
   * Return undefined if structured output is not needed
   *
   * @param node - The workflow node
   * @param data - The node configuration data
   * @returns Structured output config or undefined
   *
   * @example
   * // Text classifier with structured output
   * protected getStructuredOutputConfig(node, data): StructuredOutputConfig | undefined {
   *   return {
   *     enabled: true,
   *     schema: {
   *       type: 'object',
   *       properties: {
   *         category: { type: 'string' },
   *         confidence: { type: 'number' }
   *       },
   *       required: ['category']
   *     }
   *   }
   * }
   *
   * @example
   * // AI-v2 with optional structured output from config
   * protected getStructuredOutputConfig(node, data): StructuredOutputConfig | undefined {
   *   if (!data.structured_output?.enabled) return undefined
   *
   *   return {
   *     enabled: true,
   *     schema: data.structured_output.schema
   *   }
   * }
   */
  protected abstract getStructuredOutputConfig(
    node: WorkflowNode,
    data: any
  ): StructuredOutputConfig | undefined

  // ===== OPTIONAL OVERRIDES - Subclasses may customize =====

  /**
   * Get default temperature for this node type
   * Override to provide node-specific defaults
   *
   * @returns Default temperature value (0-2)
   *
   * @example
   * // Classification node with low temperature for consistency
   * protected getDefaultTemperature(): number {
   *   return 0.3
   * }
   *
   * @example
   * // Creative generation node with higher temperature
   * protected getDefaultTemperature(): number {
   *   return 0.9
   * }
   */
  protected getDefaultTemperature(): number {
    return 0.7 // Standard default
  }

  /**
   * Get tools for the AI to use
   * Override if your node supports tools
   *
   * @param node - The workflow node
   * @param data - The node configuration data
   * @param workflow - The current workflow
   * @param contextManager - The execution context
   * @returns Array of tools or undefined
   */
  protected async getTools(
    node: WorkflowNode,
    data: any,
    workflow: Workflow | undefined,
    contextManager: ExecutionContextManager
  ): Promise<Tool[] | undefined> {
    return undefined
  }

  /**
   * Get tool executor for executing tool calls
   * Override if your node supports tools
   *
   * @param node - The workflow node
   * @param data - The node configuration data
   * @param workflow - The current workflow
   * @param contextManager - The execution context
   * @returns Tool executor or undefined
   */
  protected async getToolExecutor(
    node: WorkflowNode,
    data: any,
    workflow: Workflow | undefined,
    contextManager: ExecutionContextManager
  ): Promise<any> {
    return undefined
  }
}
