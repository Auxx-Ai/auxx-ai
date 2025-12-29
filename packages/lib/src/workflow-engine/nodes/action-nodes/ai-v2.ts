// packages/lib/src/workflow-engine/nodes/action-nodes/ai-v2.ts

import { BaseAiNodeProcessor, type BaseAiModelConfig } from '../base-ai-node'
import type {
  WorkflowNode,
  NodeExecutionResult,
  ValidationResult,
  Workflow,
} from '../../core/types'
import { NodeRunningStatus, WorkflowNodeType } from '../../core/types'
import type { ExecutionContextManager } from '../../core/execution-context'
import { ToolRegistry } from '../../core/tool-registry'
import { ToolExecutionManager } from '../../core/tool-execution-manager'
import { AIV2ToolExecutor } from './ai-v2-tool-executor'
import type { Message, Tool } from '../../../ai/clients/base/types'
import type {
  StructuredOutputConfig,
  InvokeOrchestratorResponse,
} from '../utils/ai-invocation-utils'
import {
  convertToolsToOrchestratorFormat,
  logUnresolvedVariables,
  type PromptTemplate,
} from '../utils/ai-node-utils'

interface AiModelConfig extends BaseAiModelConfig {
  completion_params?: {
    temperature?: number
    max_tokens?: number
    top_p?: number
    frequency_penalty?: number
    presence_penalty?: number
    // GPT-5 reasoning model parameters
    reasoning_effort?: 'minimal' | 'low' | 'medium' | 'high'
    verbosity?: 'low' | 'medium' | 'high'
    max_completion_tokens?: number
    // Allow any additional parameters to pass through
    [key: string]: any
  }
}

interface AiToolsConfig {
  enabled: boolean
  mode: 'workflow_nodes' | 'built_in' | 'both'
  allowedNodeIds?: string[]
  allowedBuiltInTools?: string[]
  maxConcurrentTools?: number
  autoInvoke?: boolean
  toolCredentials?: Record<string, string> // toolId -> credentialId
  defaultCredentials?: Record<string, string> // nodeType -> credentialId
}

interface AiNodeConfig {
  title?: string
  desc?: string
  model: AiModelConfig
  prompt_template: PromptTemplate[]
  context?: { enabled: boolean; variable_selector?: string[] }
  vision?: { enabled: boolean }
  structured_output?: {
    enabled: boolean
    schema?: {
      type: 'object'
      properties: Record<string, any>
      required?: string[]
      additionalProperties?: boolean
    }
  }
  tools?: AiToolsConfig
  // Legacy support
  prompt?: string
  systemPrompt?: string
  temperature?: number
  maxTokens?: number
  outputVariable?: string
}

/**
 * Enhanced AI node processor that integrates with organization AI configurations
 * Extends BaseAiNodeProcessor for shared AI orchestration logic
 */
export class AIProcessorV2 extends BaseAiNodeProcessor {
  readonly type: WorkflowNodeType = WorkflowNodeType.AI
  private toolRegistry!: ToolRegistry
  private toolExecutionManager!: ToolExecutionManager

  constructor(nodeRegistry?: any) {
    super() // Initializes llmOrchestrator and usageService in base class
    if (nodeRegistry) {
      this.toolRegistry = new ToolRegistry(nodeRegistry)
      this.toolExecutionManager = new ToolExecutionManager(nodeRegistry, this.toolRegistry)
    }
  }

  /**
   * Build messages from prompt templates or legacy format
   * Implements abstract method from BaseAiNodeProcessor
   */
  protected async buildMessages(
    node: WorkflowNode,
    data: any,
    contextManager: ExecutionContextManager,
  ): Promise<Message[]> {
    const config = data as AiNodeConfig
    const messages: Message[] = []

    // Handle new format with prompt_template
    if (config.prompt_template && config.prompt_template.length > 0) {
      // Process all templates in parallel
      const templatePromises = config.prompt_template.map(async (template) => {
        // Text is already preprocessed, just interpolate variables
        const resolvedText = await this.interpolateVariables(template.text, contextManager)

        // Log if any variables were not resolved using utility
        logUnresolvedVariables(resolvedText, contextManager, 'ai-node', template.role)

        return { role: template.role, content: resolvedText }
      })

      messages.push(...(await Promise.all(templatePromises)))
    }
    // Handle legacy format
    else if (config.prompt) {
      // Process system and user prompts in parallel
      const promptPromises: Promise<Message>[] = []

      if (config.systemPrompt) {
        promptPromises.push(
          this.interpolateVariables(config.systemPrompt, contextManager).then((content) => ({
            role: 'system' as const,
            content,
          })),
        )
      }

      promptPromises.push(
        this.interpolateVariables(config.prompt, contextManager).then((content) => ({
          role: 'user' as const,
          content,
        })),
      )

      messages.push(...(await Promise.all(promptPromises)))
    } else {
      throw new Error('No prompt configuration found')
    }

    return messages
  }

  /**
   * Handle AI response
   * Implements abstract method from BaseAiNodeProcessor
   */
  protected async handleResponse(
    node: WorkflowNode,
    data: any,
    contextManager: ExecutionContextManager,
    response: InvokeOrchestratorResponse
  ): Promise<Partial<NodeExecutionResult>> {
    // Base class already stores standard variables, we just return the result
    return {
      status: NodeRunningStatus.Succeeded,
      output: {},
      outputHandle: 'source', // Standard output for action nodes
    }
  }

  /**
   * Get structured output configuration
   * Implements abstract method from BaseAiNodeProcessor
   */
  protected getStructuredOutputConfig(
    node: WorkflowNode,
    data: any
  ): StructuredOutputConfig | undefined {
    const config = data as AiNodeConfig

    if (!config.structured_output?.enabled) {
      return undefined
    }

    return {
      enabled: true,
      schema: config.structured_output.schema,
    }
  }

  /**
   * Get tools for AI to use
   * Overrides optional method from BaseAiNodeProcessor
   */
  protected async getTools(
    node: WorkflowNode,
    data: any,
    workflow: Workflow | undefined,
    contextManager: ExecutionContextManager
  ): Promise<Tool[] | undefined> {
    const config = data as AiNodeConfig

    if (!config.tools?.enabled || !this.toolRegistry || !workflow) {
      return undefined
    }

    const tools = this.toolRegistry.getAvailableToolsForWorkflow(workflow, node.nodeId, {
      mode: config.tools.mode || 'both',
      allowedNodeIds: config.tools.allowedNodeIds,
      allowedBuiltInTools: config.tools.allowedBuiltInTools,
    })

    const availableTools = tools.filter((tool) => tool.enabled)

    if (availableTools.length === 0) {
      return undefined
    }

    contextManager.log('INFO', node.name, 'Tools available for AI', {
      toolCount: availableTools.length,
      toolNames: availableTools.map((t) => t.name),
    })

    // Convert to orchestrator format
    return convertToolsToOrchestratorFormat(availableTools)
  }

  /**
   * Get tool executor for executing tool calls
   * Overrides optional method from BaseAiNodeProcessor
   */
  protected async getToolExecutor(
    node: WorkflowNode,
    data: any,
    workflow: Workflow | undefined,
    contextManager: ExecutionContextManager
  ): Promise<any> {
    if (!this.toolExecutionManager || !workflow) {
      return undefined
    }

    return new AIV2ToolExecutor(this.toolExecutionManager, contextManager, node.nodeId, workflow)
  }

  /**
   * Extract variables from AI prompt templates and context
   */
  protected extractRequiredVariables(node: WorkflowNode): string[] {
    const config = node.data as unknown as AiNodeConfig
    const variables = new Set<string>()

    // Extract from prompt_template
    if (config.prompt_template && Array.isArray(config.prompt_template)) {
      config.prompt_template.forEach((template: PromptTemplate) => {
        if (template.text) {
          this.extractVariableIds(template.text).forEach((v) => variables.add(v))
        }
      })
    }

    // Extract from legacy prompt fields
    if (config.prompt && typeof config.prompt === 'string') {
      this.extractVariableIds(config.prompt).forEach((v) => variables.add(v))
    }

    if (config.systemPrompt && typeof config.systemPrompt === 'string') {
      this.extractVariableIds(config.systemPrompt).forEach((v) => variables.add(v))
    }

    // Extract from context if enabled
    if (config.context?.enabled && config.context.variable_selector) {
      config.context.variable_selector.forEach((v: string) => variables.add(v))
    }

    return Array.from(variables)
  }

  protected async validateNodeConfig(node: WorkflowNode): Promise<ValidationResult> {
    const errors: string[] = []
    const warnings: string[] = []

    // The configuration should be in node.data according to WorkflowNode interface
    const config = node.data as unknown as AiNodeConfig

    if (!config) {
      errors.push('AI node configuration is missing. Expected config in node.data')
      return { valid: false, errors, warnings }
    }

    // Validate prompt configuration - check for common issues
    if (!config.prompt_template?.length && !config.prompt) {
      // Check if prompt might be nested under a different structure
      const possiblePrompt =
        (config as any)?.prompt || (config as any)?.prompts || (config as any)?.messages

      if (!possiblePrompt) {
        errors.push(
          `AI node configuration is invalid. Expected 'prompt_template' array but found: ${Object.keys(config).join(', ')}. This may indicate the node config was not properly saved or loaded.`
        )
      }
    }

    // Validate model configuration
    if (!config.model?.provider && !config.model?.name) {
      // Check if using legacy format
      if (!config.model) {
        warnings.push('Model configuration is missing, will use defaults')
      }
    }

    // Validate completion parameters
    if (config.model?.completion_params?.temperature !== undefined) {
      const temp = config.model.completion_params.temperature
      if (typeof temp !== 'number' || temp < 0 || temp > 2) {
        errors.push('Temperature must be a number between 0 and 2')
      }
    }

    if (config.model?.completion_params?.max_tokens !== undefined) {
      const maxTokens = config.model.completion_params.max_tokens
      if (typeof maxTokens !== 'number' || maxTokens < 1) {
        errors.push('Max tokens must be a positive number')
      }
    }

    // Validate structured output configuration
    if (config.structured_output?.enabled) {
      if (!config.structured_output.schema) {
        errors.push('Structured output is enabled but no schema is defined')
      } else {
        // Validate schema structure
        const schema = config.structured_output.schema
        if (schema.type !== 'object') {
          errors.push('Structured output schema must have type "object"')
        }
        if (!schema.properties || Object.keys(schema.properties).length === 0) {
          errors.push('Structured output schema must define at least one property')
        }
      }
    }

    // Validate tools configuration
    if (config.tools?.enabled) {
      const mode = config.tools.mode || 'both'
      if (!['workflow_nodes', 'built_in', 'both'].includes(mode)) {
        errors.push('Tools mode must be one of: workflow_nodes, built_in, both')
      }

      if (config.tools.maxConcurrentTools !== undefined) {
        const maxTools = config.tools.maxConcurrentTools
        if (typeof maxTools !== 'number' || maxTools < 1) {
          errors.push('Max concurrent tools must be a positive number')
        }
      }

      if (config.tools.allowedNodeIds && !Array.isArray(config.tools.allowedNodeIds)) {
        errors.push('Allowed node IDs must be an array')
      }

      if (config.tools.allowedBuiltInTools && !Array.isArray(config.tools.allowedBuiltInTools)) {
        errors.push('Allowed built-in tools must be an array')
      }
    }

    return { valid: errors.length === 0, errors, warnings }
  }
}
