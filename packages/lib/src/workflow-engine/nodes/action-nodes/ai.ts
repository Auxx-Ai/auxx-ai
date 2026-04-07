// packages/lib/src/workflow-engine/nodes/action-nodes/ai.ts

import { configService } from '@auxx/credentials'
import OpenAI from 'openai'
import { OPENAI_MODELS } from '../../../ai/providers/openai/openai-defaults'
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
 * AI node that generates content using AI models
 */
export class AIProcessor extends BaseNodeProcessor {
  readonly type: WorkflowNodeType = WorkflowNodeType.AI
  private openai: OpenAI

  constructor() {
    super()
    // Initialize OpenAI client - in production this should use the organization's API key
    this.openai = new OpenAI({ apiKey: configService.get<string>('OPENAI_API_KEY') || '' })
  }

  /**
   * Preprocess AI node - interpolate prompts, validate configuration, prepare API data
   */
  async preprocessNode(
    node: WorkflowNode,
    contextManager: ExecutionContextManager
  ): Promise<PreprocessedNodeData> {
    const data = node.data as any

    // Validate required fields
    if (!data.prompt) {
      throw this.createProcessingError('Prompt is required for AI node', node, {
        nodeData: data,
        missingField: 'prompt',
      })
    }

    // 1. Interpolate prompts with variables (expensive operation - do once)
    const resolvedPrompt = await this.interpolateVariables(data.prompt || '', contextManager)
    const resolvedSystemPrompt = data.systemPrompt
      ? await this.interpolateVariables(data.systemPrompt, contextManager)
      : 'You are a helpful assistant.'

    // 2. Prepare model configuration with validation
    const modelConfig = {
      model: data.model || 'gpt-5.4-nano',
      temperature: this.validateTemperature(data.temperature ?? 0.7),
      max_tokens: this.validateMaxTokens(data.maxTokens),
      top_p: data.top_p,
      frequency_penalty: data.frequency_penalty,
      presence_penalty: data.presence_penalty,
    }

    // Validate model
    if (modelConfig.model && !this.isValidModel(modelConfig.model)) {
      throw this.createProcessingError(`Unsupported model: ${modelConfig.model}`, node, {
        modelConfig,
        providedModel: modelConfig.model,
        supportedModels: this.getSupportedModels(),
      })
    }

    // 3. Build messages array (ready for API call)
    const messages = [
      { role: 'system', content: resolvedSystemPrompt },
      { role: 'user', content: resolvedPrompt },
    ]

    // 4. Prepare output configuration
    const outputVariable = data.outputVariable || `${node.nodeId}.text`

    // 5. Get organization context for API keys
    const organizationId = (await contextManager.getVariable('sys.organizationId')) as string
    const userId = (await contextManager.getVariable('sys.userId')) as string

    // 6. Estimate token usage for monitoring
    const estimatedTokens = this.estimateTokenUsage(resolvedPrompt, resolvedSystemPrompt)

    return {
      inputs: {
        // Ready-to-use API data
        messages,
        modelConfig,
        outputVariable,

        // Context for API calls
        organizationId,
        userId,

        // Processed prompts
        resolvedPrompt,
        resolvedSystemPrompt,

        // Original data for reference
        originalPrompt: data.prompt,
        originalSystemPrompt: data.systemPrompt,

        // Processing metadata
        isValidConfiguration: true,
      },
      metadata: {
        nodeType: 'ai',
        model: modelConfig.model,
        promptLength: resolvedPrompt.length,
        systemPromptLength: resolvedSystemPrompt.length,
        hasCustomSystemPrompt: !!data.systemPrompt,
        estimatedTokens,
        configurationValid: true,
        preprocessingComplete: true,
        // Cost estimation
        estimatedCost: this.estimateCost(estimatedTokens, modelConfig.model),
      },
    }
  }

  protected async executeNode(
    node: WorkflowNode,
    contextManager: ExecutionContextManager,
    preprocessedData?: PreprocessedNodeData
  ): Promise<Partial<NodeExecutionResult>> {
    // Use preprocessed data if available
    if (preprocessedData?.inputs) {
      const inputs = preprocessedData.inputs

      contextManager.log('INFO', node.name, 'Generating AI response with preprocessed data', {
        model: inputs.modelConfig.model,
        temperature: inputs.modelConfig.temperature,
        promptLength: inputs.resolvedPrompt.length,
        estimatedTokens: preprocessedData.metadata?.estimatedTokens,
        estimatedCost: preprocessedData.metadata?.estimatedCost,
      })

      try {
        // Use preprocessed messages and config directly
        const completion = await this.callAIWithPreprocessedData(inputs)

        const generatedContent = completion.choices[0]?.message?.content || ''

        // Store the generated content (same as original)
        contextManager.setVariable(inputs.outputVariable, generatedContent)
        contextManager.setNodeVariable(node.nodeId, 'output', generatedContent)
        contextManager.setNodeVariable(node.nodeId, 'text', generatedContent)

        contextManager.log(
          'INFO',
          node.name,
          'AI response generated successfully with preprocessed data',
          {
            outputVariable: inputs.outputVariable,
            responseLength: generatedContent.length,
            usage: completion.usage,
            usedPreprocessedData: true,
            preprocessingBenefit: 'Skipped prompt interpolation and validation',
          }
        )

        return {
          status: NodeRunningStatus.Succeeded,
          output: {
            content: generatedContent,
            model: inputs.modelConfig.model,
            usage: completion.usage,
          },
          metadata: {
            model: inputs.modelConfig.model,
            temperature: inputs.modelConfig.temperature,
            promptTokens: completion.usage?.prompt_tokens,
            completionTokens: completion.usage?.completion_tokens,
            totalTokens: completion.usage?.total_tokens,
            usedPreprocessedData: true,
            actualCost: this.calculateActualCost(completion.usage, inputs.modelConfig.model),
            estimatedVsActualTokens: {
              estimated: preprocessedData.metadata?.estimatedTokens,
              actual: completion.usage?.total_tokens,
            },
          },
          outputHandle: 'source',
        }
      } catch (error) {
        contextManager.log(
          'ERROR',
          node.name,
          'Failed to generate AI response with preprocessed data',
          {
            error: error instanceof Error ? error.message : String(error),
            usedPreprocessedData: true,
          }
        )
        throw error
      }
    }

    // Fallback to original implementation
    return this.originalExecuteNode(node, contextManager)
  }

  /**
   * Original execution logic for fallback when no preprocessed data
   */
  private async originalExecuteNode(
    node: WorkflowNode,
    contextManager: ExecutionContextManager
  ): Promise<Partial<NodeExecutionResult>> {
    // Access flattened data directly from node.data
    const data = node.data as any
    const prompt = data.prompt
    const model = data.model || 'gpt-5.4-nano'
    const temperature = data.temperature ?? 0.7
    const maxTokens = data.maxTokens

    if (!prompt) {
      throw this.createExecutionError('No prompt specified for AI node', node, {
        nodeData: data,
        resolvedPrompt: prompt,
        executionPhase: 'prompt_validation',
      })
    }

    contextManager.log('INFO', node.name, 'Generating AI response', {
      model,
      temperature,
      promptLength: prompt.length,
    })

    try {
      // Resolve variables in the prompt
      const resolvedPrompt = await this.interpolateVariables(prompt, contextManager)

      // Generate completion
      const completion = await this.openai.chat.completions.create({
        model,
        messages: [
          { role: 'system', content: data.systemPrompt || 'You are a helpful assistant.' },
          { role: 'user', content: resolvedPrompt },
        ],
        temperature,
        max_tokens: maxTokens,
      })

      const generatedContent = completion.choices[0]?.message?.content || ''

      // Store the generated content in a variable
      const outputVariable = data.outputVariable || `${node.nodeId}.text`
      contextManager.setVariable(outputVariable, generatedContent)

      // Also store as standard node output
      contextManager.setNodeVariable(node.nodeId, 'output', generatedContent)
      contextManager.setNodeVariable(node.nodeId, 'text', generatedContent)

      contextManager.log('INFO', node.name, 'AI response generated successfully', {
        outputVariable,
        responseLength: generatedContent.length,
        usage: completion.usage,
      })

      return {
        status: NodeRunningStatus.Succeeded,
        output: { content: generatedContent, model, usage: completion.usage },
        metadata: {
          model,
          temperature,
          promptTokens: completion.usage?.prompt_tokens,
          completionTokens: completion.usage?.completion_tokens,
          totalTokens: completion.usage?.total_tokens,
        },
        outputHandle: 'source', // Standard output for action nodes
      }
    } catch (error) {
      contextManager.log('ERROR', node.name, 'Failed to generate AI response', {
        error: error instanceof Error ? error.message : String(error),
      })

      // Wrap in execution error with AI-specific context
      throw this.createExecutionError(
        `AI model execution failed: ${error instanceof Error ? error.message : String(error)}`,
        node,
        {
          model,
          temperature,
          maxTokens,
          promptLength: resolvedPrompt?.length,
          errorType: error.constructor.name,
          originalError: error instanceof Error ? error.message : String(error),
          executionPhase: 'ai_api_call',
        },
        error
      )
    }
  }

  /**
   * Call OpenAI with preprocessed data - optimized execution
   */
  private async callAIWithPreprocessedData(inputs: any): Promise<any> {
    // Direct API call with preprocessed data
    return await this.openai.chat.completions.create({
      model: inputs.modelConfig.model,
      messages: inputs.messages, // Already processed
      temperature: inputs.modelConfig.temperature,
      max_tokens: inputs.modelConfig.max_tokens,
      top_p: inputs.modelConfig.top_p,
      frequency_penalty: inputs.modelConfig.frequency_penalty,
      presence_penalty: inputs.modelConfig.presence_penalty,
    })
  }

  /**
   * Validate temperature parameter
   */
  private validateTemperature(temperature: number): number {
    if (typeof temperature !== 'number' || temperature < 0 || temperature > 2) {
      throw new Error('Temperature must be a number between 0 and 2')
    }
    return temperature
  }

  /**
   * Validate max tokens parameter
   */
  private validateMaxTokens(maxTokens: number | undefined): number | undefined {
    if (maxTokens !== undefined) {
      if (typeof maxTokens !== 'number' || maxTokens < 1) {
        throw new Error('Max tokens must be a positive number')
      }
    }
    return maxTokens
  }

  /**
   * Estimate token usage for cost monitoring
   */
  private estimateTokenUsage(prompt: string, systemPrompt: string): number {
    // Rough estimation: 1 token ≈ 4 characters
    const promptTokens = Math.ceil(prompt.length / 4)
    const systemTokens = Math.ceil(systemPrompt.length / 4)

    // Add small buffer for response tokens (completion)
    const estimatedResponseTokens = Math.min(promptTokens * 0.5, 500)

    return promptTokens + systemTokens + estimatedResponseTokens
  }

  /**
   * Estimate API cost based on model and tokens
   */
  private estimateCost(tokens: number, model: string): number {
    const modelCaps = OPENAI_MODELS[model]
    const pricing = modelCaps?.costPer1kTokens ?? { input: 0.0002, output: 0.00125 }

    const inputCost = ((tokens * 0.7) / 1000) * pricing.input // 70% input tokens
    const outputCost = ((tokens * 0.3) / 1000) * pricing.output // 30% output tokens

    return inputCost + outputCost
  }

  /**
   * Calculate actual cost based on usage
   */
  private calculateActualCost(usage: any, model: string): number {
    if (!usage) return 0

    const modelCaps = OPENAI_MODELS[model]
    const pricing = modelCaps?.costPer1kTokens ?? { input: 0.0002, output: 0.00125 }

    const inputCost = (usage.prompt_tokens / 1000) * pricing.input
    const outputCost = (usage.completion_tokens / 1000) * pricing.output

    return inputCost + outputCost
  }

  /**
   * Extract variables from AI prompt and system prompt
   */
  protected extractRequiredVariables(node: WorkflowNode): string[] {
    const data = node.data as any
    const variables = new Set<string>()

    // Extract from prompt
    if (data.prompt) {
      this.extractVariableIds(data.prompt).forEach((v) => variables.add(v))
    }

    // Extract from system prompt
    if (data.systemPrompt) {
      this.extractVariableIds(data.systemPrompt).forEach((v) => variables.add(v))
    }

    // Extract from prompt_template if it exists (alternative format)
    if (data.prompt_template) {
      data.prompt_template.forEach((template: any) => {
        if (template.text) {
          this.extractVariableIds(template.text).forEach((v) => variables.add(v))
        }
      })
    }

    // Extract from context if enabled
    if (data.context?.enabled && data.context.variable_selector) {
      data.context.variable_selector.forEach((v: string) => variables.add(v))
    }

    return Array.from(variables)
  }

  protected async validateNodeConfig(node: WorkflowNode): Promise<ValidationResult> {
    const errors: string[] = []
    const warnings: string[] = []
    // Access flattened data directly from node.data
    const data = node.data as any

    if (!data.prompt) {
      errors.push('Prompt is required')
    }

    if (data.model && !this.isValidModel(data.model)) {
      warnings.push(`Unsupported model: ${data.model}`)
    }

    if (data.temperature !== undefined) {
      if (typeof data.temperature !== 'number' || data.temperature < 0 || data.temperature > 2) {
        errors.push('Temperature must be a number between 0 and 2')
      }
    }

    if (data.maxTokens !== undefined) {
      if (typeof data.maxTokens !== 'number' || data.maxTokens < 1) {
        errors.push('Max tokens must be a positive number')
      }
    }

    // Note: Connection validation removed - workflow uses edges instead of node.connections
    // The connections field is deprecated and always empty

    return { valid: errors.length === 0, errors, warnings }
  }

  private isValidModel(model: string): boolean {
    return model in OPENAI_MODELS
  }
}
