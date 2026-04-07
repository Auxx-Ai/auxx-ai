// packages/lib/src/workflow-engine/nodes/utils/ai-node-utils.ts

import type { Message, Tool } from '../../../ai/clients/base/types'
import type { AICallbacks } from '../../../ai/orchestrator/types'
import { ModelType } from '../../../ai/providers/types'
import { getCachedDefaultModel } from '../../../cache/org-cache-helpers'
import type { ExecutionContextManager } from '../../core/execution-context'

/**
 * Prompt template interface used by AI nodes
 */
export interface PromptTemplate {
  role: 'system' | 'user' | 'assistant'
  text: string
}

/**
 * Model configuration interface
 */
export interface ModelConfig {
  provider: string
  name: string
  completion_params?: Record<string, any>
}

/**
 * Organization and user context
 */
export interface OrgUserContext {
  organizationId: string
  userId: string
}

/**
 * Extract organization and user IDs from execution context
 * Async function - throws if required values are missing
 *
 * @param contextManager - The execution context
 * @returns Organization and user IDs
 * @throws Error if organizationId or userId is missing
 */
export async function extractOrgUserContext(
  contextManager: ExecutionContextManager
): Promise<OrgUserContext> {
  const organizationId = (await contextManager.getVariable('sys.organizationId')) as string
  const userId = (await contextManager.getVariable('sys.userId')) as string

  if (!organizationId) {
    throw new Error('Organization ID is required for AI node execution')
  }

  if (!userId) {
    throw new Error('User ID is required for AI node execution')
  }

  return { organizationId, userId }
}

/**
 * Extract model provider and name from config.
 * When useDefault is true, returns empty strings — call resolveModelConfig() before invocation.
 *
 * @param modelConfig - The model configuration
 * @returns Provider, model name, and useDefault flag
 */
export function extractModelConfig(modelConfig: any): {
  provider: string
  model: string
  useDefault: boolean
} {
  if (modelConfig?.useDefault) {
    return { provider: '', model: '', useDefault: true }
  }
  return {
    provider: modelConfig?.provider || '',
    model: modelConfig?.name || '',
    useDefault: false,
  }
}

/**
 * Resolve the actual model provider and name.
 * When useDefault is true, fetches the org's system default for the given model type.
 *
 * @param modelConfig - Output from extractModelConfig()
 * @param organizationId - The organization ID
 * @param modelType - The model type to resolve defaults for (defaults to 'llm')
 * @returns Resolved provider and model name
 * @throws Error if no default is configured and useDefault is true
 */
export async function resolveModelConfig(
  modelConfig: { provider: string; model: string; useDefault: boolean },
  organizationId: string,
  modelType: ModelType = ModelType.LLM
): Promise<{ provider: string; model: string }> {
  if (modelConfig.useDefault || (!modelConfig.provider && !modelConfig.model)) {
    const defaultModel = await getCachedDefaultModel(organizationId, modelType)
    if (defaultModel) {
      return defaultModel
    }
    throw new Error(
      `No default ${modelType} model configured for organization. ` +
        'Please set a default model in AI Settings or select a specific model on the node.'
    )
  }

  if (!modelConfig.provider || !modelConfig.model) {
    throw new Error('Model provider and name are required when useDefault is not set.')
  }

  return { provider: modelConfig.provider, model: modelConfig.model }
}

/**
 * Build completion parameters from model config with defaults
 * Pure function - merges config params with legacy params and defaults
 *
 * @param modelConfig - The model configuration
 * @param legacyParams - Optional legacy parameters (temperature, maxTokens)
 * @param defaultParams - Optional default parameters
 * @returns Merged completion parameters
 */
export function buildCompletionParams(
  modelConfig: any,
  legacyParams?: { temperature?: number; maxTokens?: number },
  defaultParams?: Record<string, any>
): Record<string, any> {
  const params: Record<string, any> = {
    // Start with defaults
    ...(defaultParams || {}),
    // Apply completion_params from config
    ...(modelConfig?.completion_params || {}),
  }

  // Apply legacy parameters only if not already present
  if (legacyParams?.temperature !== undefined && params.temperature === undefined) {
    params.temperature = legacyParams.temperature
  }

  if (legacyParams?.maxTokens !== undefined && params.max_tokens === undefined) {
    params.max_tokens = legacyParams.maxTokens
  }

  // Set default temperature if nothing provided it
  if (params.temperature === undefined) {
    params.temperature = 0.7
  }

  return params
}

/**
 * Extract variable IDs from a text string
 * Pure function - scans for {{variable}} patterns
 *
 * @param text - The text to scan
 * @returns Array of variable IDs found in the text
 */
export function extractVariableIdsFromText(text: string): string[] {
  const variablePattern = /\{\{([^}]+)\}\}/g
  const variables: string[] = []
  let match

  while ((match = variablePattern.exec(text)) !== null) {
    variables.push(match[1].trim())
  }

  return variables
}

/**
 * Extract variable IDs from prompt templates
 * Pure function - scans all templates for {{variable}} patterns
 *
 * @param templates - Array of prompt templates
 * @returns Array of unique variable IDs
 */
export function extractVariableIdsFromTemplates(templates: PromptTemplate[]): string[] {
  const variableIds = new Set<string>()

  for (const template of templates) {
    const ids = extractVariableIdsFromText(template.text)
    ids.forEach((id) => variableIds.add(id))
  }

  return Array.from(variableIds)
}

/**
 * Find unresolved variables in a text string
 * Pure function - finds {{variable}} patterns that remain after interpolation
 *
 * @param text - The text to check (after interpolation)
 * @returns Array of unresolved variable IDs
 */
export function findUnresolvedVariables(text: string): string[] {
  return extractVariableIdsFromText(text)
}

/**
 * Interpolate variables in text from optimized context
 * Pure function - replaces {{variable}} patterns with values from Map
 *
 * @param text - The text with {{variable}} patterns
 * @param context - Map of variable IDs to values
 * @returns Text with variables replaced
 */
export function interpolateVariablesFromContext(
  text: string,
  context: Map<string, unknown>
): string {
  return text.replace(/\{\{([^}]+)\}\}/g, (match, varId) => {
    const value = context.get(varId.trim())
    if (value === undefined) return match
    return typeof value === 'object' ? JSON.stringify(value) : String(value)
  })
}

/**
 * Build messages from prompt templates using ExecutionContextManager
 * Uses the contextManager's interpolateVariables method for consistency
 * NOW ASYNC to support lazy loading
 *
 * @param templates - Array of prompt templates
 * @param contextManager - The execution context
 * @param interpolateFn - Async function to interpolate variables (from BaseNodeProcessor)
 * @returns Array of messages with variables resolved
 */
export async function buildMessagesFromTemplates(
  templates: PromptTemplate[],
  contextManager: ExecutionContextManager,
  interpolateFn: (text: string, contextManager: ExecutionContextManager) => Promise<string>
): Promise<Message[]> {
  const messages: Message[] = []

  // Process all templates in parallel
  const messagePromises = templates.map(async (template) => {
    const resolvedText = await interpolateFn(template.text, contextManager)

    return {
      role: template.role,
      content: resolvedText,
    }
  })

  return await Promise.all(messagePromises)
}

/**
 * Build messages with optimized context (Phase 5 integration)
 * Only includes variables referenced in the templates
 * This reduces token usage by 90%+ for AI prompts
 *
 * @param templates - Array of prompt templates
 * @param contextManager - The execution context
 * @param buildOptimizedContextFn - Function to build optimized context (from BaseNodeProcessor)
 * @returns Array of messages with optimized context
 */
export function buildMessagesWithOptimizedContext(
  templates: PromptTemplate[],
  contextManager: ExecutionContextManager,
  buildOptimizedContextFn: (requiredVariables: string[]) => Map<string, unknown>
): Message[] {
  // Extract variable IDs from all templates
  const requiredVariables = extractVariableIdsFromTemplates(templates)

  // Build optimized context with only required variables (Phase 5)
  const optimizedContext = buildOptimizedContextFn(requiredVariables)

  // Build messages using optimized context
  return templates.map((template) => {
    const content = interpolateVariablesFromContext(template.text, optimizedContext)
    return {
      role: template.role,
      content,
    }
  })
}

/**
 * Convert workflow tools to orchestrator Tool format
 * Pure function - transforms tool definitions
 *
 * @param workflowTools - Array of workflow tool definitions
 * @returns Array of orchestrator-compatible tools
 */
export function convertToolsToOrchestratorFormat(workflowTools: any[]): Tool[] {
  return workflowTools.map((tool) => ({
    type: 'function' as const,
    function: {
      name: tool.name,
      description: tool.description || `Execute ${tool.name} tool`,
      parameters: tool.parameters ||
        tool.schema || {
          type: 'object',
          properties: {},
        },
    },
  }))
}

/**
 * Create AI callbacks for logging during AI invocation
 * Factory function - creates callback object with context
 *
 * @param contextManager - The execution context for logging
 * @param nodeId - The node ID for logging context
 * @returns AICallbacks object with logging functions
 */
export function createAICallbacks(
  contextManager: ExecutionContextManager,
  nodeId: string
): AICallbacks {
  return {
    beforeInvoke: async (context) => {
      contextManager.log('DEBUG', nodeId, 'Starting AI invocation with orchestrator', context)
    },
    onChunk: async (chunk) => {
      contextManager.log('DEBUG', nodeId, 'Received streaming chunk', {
        delta: chunk.delta,
        chunkIndex: chunk.metadata?.chunkIndex,
      })
    },
    afterInvoke: async (response) => {
      contextManager.log('INFO', nodeId, 'AI invocation completed successfully', {
        usage: response.usage,
        contentLength: response.content.length,
        hasToolCalls: !!response.tool_calls?.length,
      })
    },
    onError: async (error) => {
      contextManager.log('ERROR', nodeId, 'AI invocation failed', {
        error: error.message,
      })
    },
    onToolCall: async (toolCall) => {
      contextManager.log('DEBUG', nodeId, 'Tool call triggered', {
        toolId: toolCall.id,
        toolName: toolCall.function.name,
      })
    },
    onToolResult: async (result) => {
      contextManager.log('INFO', nodeId, 'Tool execution completed', {
        toolName: result.toolName,
        success: result.success,
        executionTime: result.executionTime,
      })
    },
  }
}

/**
 * Validate model configuration
 * Pure function - checks for required fields and valid values
 *
 * @param config - The model configuration to validate
 * @returns Validation result with errors and warnings
 */
export function validateModelConfig(config: any): { valid: boolean; errors: string[] } {
  const errors: string[] = []

  if (!config) {
    errors.push('Model configuration is required')
    return { valid: false, errors }
  }

  if (!config.useDefault) {
    if (!config.provider) {
      errors.push('Model provider is required')
    }

    if (!config.name) {
      errors.push('Model name is required')
    }
  }

  // Validate temperature if provided
  if (config.completion_params?.temperature !== undefined) {
    const temp = config.completion_params.temperature
    if (typeof temp !== 'number' || temp < 0 || temp > 2) {
      errors.push('Temperature must be a number between 0 and 2')
    }
  }

  // Validate max_tokens if provided
  if (config.completion_params?.max_tokens !== undefined) {
    const maxTokens = config.completion_params.max_tokens
    if (typeof maxTokens !== 'number' || maxTokens < 1) {
      errors.push('Max tokens must be a positive number')
    }
  }

  // Validate top_p if provided
  if (config.completion_params?.top_p !== undefined) {
    const topP = config.completion_params.top_p
    if (typeof topP !== 'number' || topP < 0 || topP > 1) {
      errors.push('Top P must be a number between 0 and 1')
    }
  }

  return { valid: errors.length === 0, errors }
}

/**
 * Validate prompt templates array
 * Pure function - checks for required fields and valid structure
 *
 * @param templates - Array of prompt templates
 * @returns Validation result with errors
 */
export function validatePromptTemplates(templates: any): {
  valid: boolean
  errors: string[]
  warnings: string[]
} {
  const errors: string[] = []
  const warnings: string[] = []

  if (!templates || !Array.isArray(templates)) {
    errors.push('Prompt templates must be an array')
    return { valid: false, errors, warnings }
  }

  if (templates.length === 0) {
    errors.push('At least one prompt template is required')
    return { valid: false, errors, warnings }
  }

  templates.forEach((template, index) => {
    if (!template.role) {
      errors.push(`Template ${index + 1}: Role is required`)
    } else if (!['system', 'user', 'assistant'].includes(template.role)) {
      errors.push(`Template ${index + 1}: Role must be system, user, or assistant`)
    }

    if (!template.text) {
      errors.push(`Template ${index + 1}: Text is required`)
    } else if (typeof template.text !== 'string') {
      errors.push(`Template ${index + 1}: Text must be a string`)
    }
  })

  // Warnings
  if (templates.length > 50) {
    warnings.push('Having more than 50 templates may impact performance')
  }

  return { valid: errors.length === 0, errors, warnings }
}

/**
 * Build default completion parameters for classification tasks
 * Pure function - returns optimal defaults for classification
 *
 * @param overrides - Optional parameter overrides
 * @returns Completion parameters optimized for classification
 */
export function buildClassificationCompletionParams(
  overrides?: Record<string, any>
): Record<string, any> {
  return {
    temperature: 0.3, // Lower temp for classification
    max_tokens: 500, // Sufficient for classification response
    ...overrides,
  }
}

/**
 * Log unresolved variables as warnings
 * Side effect function - logs to context manager
 *
 * @param text - The interpolated text
 * @param contextManager - The execution context
 * @param nodeId - The node ID for logging
 * @param role - The template role (for context)
 */
export function logUnresolvedVariables(
  text: string,
  contextManager: ExecutionContextManager,
  nodeId: string,
  role?: string
): void {
  const unresolvedVars = findUnresolvedVariables(text)
  if (unresolvedVars.length > 0) {
    contextManager.log('WARN', nodeId, 'Unresolved variables in prompt', {
      role: role || 'unknown',
      unresolved: unresolvedVars,
    })
  }
}
