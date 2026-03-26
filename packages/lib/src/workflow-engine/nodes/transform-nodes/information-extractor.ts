// packages/lib/src/workflow-engine/nodes/transform-nodes/information-extractor.ts

import { database as db } from '@auxx/database'
import type { Message } from '../../../ai/clients/base/types'
import { LLMOrchestrator } from '../../../ai/orchestrator/llm-orchestrator'
import type { AICallbacks, LLMInvocationRequest } from '../../../ai/orchestrator/types'
import { UsageTrackingService } from '../../../ai/usage/usage-tracking-service'
import { createScopedLogger } from '../../../logger'
import type { ExecutionContextManager } from '../../core/execution-context'
import type {
  NodeExecutionResult,
  PreprocessedNodeData,
  ValidationResult,
  WorkflowNode,
} from '../../core/types'
import { NodeRunningStatus, WorkflowNodeType } from '../../core/types'
import { BaseNodeProcessor } from '../base-node'
import { extractModelConfig, resolveModelConfig } from '../utils/ai-node-utils'

const logger = createScopedLogger('information-extractor-processor')

/**
 * Information extractor configuration interface
 */
interface InformationExtractorConfig {
  title?: string
  desc?: string
  model: {
    useDefault?: boolean
    provider: string
    name: string
    mode?: 'chat' | 'completion'
    completion_params?: {
      temperature?: number
      max_tokens?: number
      top_p?: number
      frequency_penalty?: number
      presence_penalty?: number
    }
  }
  text: string // Preprocessed text with {{variables}}
  textEditorContent?: string // Tiptap JSON content
  structured_output: {
    enabled: boolean
    schema?: {
      type: 'object'
      properties: Record<string, any>
      required?: string[]
      additionalProperties?: boolean
    }
  }
  vision?: { enabled: boolean }
  instruction?: {
    enabled: boolean
    text: string // Preprocessed text
    editorContent?: string // Tiptap JSON
  }
}

/**
 * Information extractor node processor
 */
export class InformationExtractorProcessor extends BaseNodeProcessor {
  readonly type: WorkflowNodeType = WorkflowNodeType.INFORMATION_EXTRACTOR
  private llmOrchestrator: LLMOrchestrator
  private usageService: UsageTrackingService

  constructor() {
    super()

    // Initialize the usage tracking service and orchestrator
    this.usageService = new UsageTrackingService(db)
    this.llmOrchestrator = new LLMOrchestrator(
      this.usageService,
      db,
      {
        enableUsageTracking: true,
        enableQuotaEnforcement: true,
        defaultTimeouts: {
          request: 120000, // 2 minutes for extraction
          streaming: 300000, // Not used for extraction but required
        },
      },
      logger
    )
  }

  /**
   * Preprocess Information Extractor node - interpolate text, build prompts, prepare AI data
   */
  async preprocessNode(
    node: WorkflowNode,
    contextManager: ExecutionContextManager
  ): Promise<PreprocessedNodeData> {
    const config = node.data as unknown as InformationExtractorConfig

    // Validate required configuration
    if (!config) {
      throw new Error('Information extractor node configuration is missing')
    }

    if (!config.structured_output.enabled || !config.structured_output.schema) {
      throw new Error('Structured output schema is required for information extraction')
    }

    // 1. Process text to extract with variable interpolation
    const textToExtract = await this.interpolateVariables(config.text || '', contextManager)

    if (!textToExtract) {
      throw new Error('No text provided for extraction')
    }

    // 2. Build system prompt from schema (expensive operation - do once)
    const systemPrompt = this.buildExtractionPrompt(config.structured_output.schema)

    // 3. Build messages array with all interpolations resolved
    const messages: Array<{ role: string; content: string }> = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: textToExtract },
    ]

    // 4. Add custom instructions if enabled (with variable interpolation)
    if (config.instruction?.enabled && config.instruction.text) {
      const instruction = await this.interpolateVariables(config.instruction.text, contextManager)
      messages.push({
        role: 'system',
        content: `Additional extraction instructions: ${instruction}`,
      })
    }

    // 5. Prepare completion parameters (resolved once)
    const completionParams = {
      temperature: config.model?.completion_params?.temperature ?? 0.3,
      max_tokens: config.model?.completion_params?.max_tokens,
      top_p: config.model?.completion_params?.top_p,
      frequency_penalty: config.model?.completion_params?.frequency_penalty,
      presence_penalty: config.model?.completion_params?.presence_penalty,
    }

    // 6. Get organization context (required for AI calls)
    const organizationId = (await contextManager.getVariable('sys.organizationId')) as string
    const userId = (await contextManager.getVariable('sys.userId')) as string

    if (!organizationId) {
      throw new Error('Organization ID is required for information extractor node execution')
    }

    // 7. Schema is handled by the orchestrator, no need for provider-specific preparation

    // 8. Resolve model config (handles useDefault flag)
    const extracted = extractModelConfig(config.model)
    const resolvedModel = await resolveModelConfig(extracted, db, organizationId)

    // 9. Extract variable references for debugging
    const usedVariables = new Set<string>()
    this.extractVariableIds(config.text || '').forEach((v) => usedVariables.add(v))
    if (config.instruction?.text) {
      this.extractVariableIds(config.instruction.text).forEach((v) => usedVariables.add(v))
    }

    return {
      inputs: {
        // Core AI inputs (fully processed)
        textToExtract,
        messages,
        completionParams,
        schema: config.structured_output.schema,

        // Model configuration (resolved)
        model: {
          provider: resolvedModel.provider,
          name: resolvedModel.model,
          mode: config.model.mode,
        },

        // Context required for AI calls
        organizationId,
        userId,

        // Original configuration for reference
        originalText: config.text,
        originalInstruction: config.instruction?.text,

        // Processing metadata
        variablesUsed: Array.from(usedVariables),
        schemaFields: Object.keys(config.structured_output.schema.properties || {}),
        hasCustomInstructions: config.instruction?.enabled && !!config.instruction.text,
      },
      metadata: {
        nodeType: 'information-extractor',
        provider: config.model.provider,
        modelName: config.model.name,
        hasSchema: !!config.structured_output.schema,
        hasInstruction: config.instruction?.enabled,
        textLength: textToExtract?.length,
        messageCount: messages.length,
        schemaFields: Object.keys(config.structured_output.schema?.properties || {}),
        schemaFieldCount: Object.keys(config.structured_output.schema?.properties || {}).length,
        variableCount: usedVariables.size,
        preprocessingComplete: true,
      },
    }
  }

  protected async executeNode(
    node: WorkflowNode,
    contextManager: ExecutionContextManager,
    preprocessedData?: PreprocessedNodeData
  ): Promise<Partial<NodeExecutionResult>> {
    const startTime = Date.now()

    // Use preprocessed data if available
    if (preprocessedData?.inputs) {
      const inputs = preprocessedData.inputs

      contextManager.log(
        'INFO',
        node.name,
        'Starting information extraction with preprocessed data',
        {
          model: inputs.model,
          hasSchema: !!inputs.schema,
          hasInstruction: inputs.hasCustomInstructions,
          textLength: inputs.textToExtract?.length,
        }
      )

      try {
        // Call AI with preprocessed, ready-to-use data using orchestrator
        const response = await this.generateExtractionWithOrchestrator(
          inputs.model,
          inputs.messages,
          inputs.completionParams,
          inputs.schema,
          inputs.organizationId,
          inputs.userId,
          contextManager,
          node.nodeId
        )

        // Store extracted data (same as original)
        contextManager.setNodeVariable(node.nodeId, 'raw_extraction', response.content)
        contextManager.setNodeVariable(
          node.nodeId,
          'extracted_data',
          response.structured_output || {}
        )
        contextManager.setNodeVariable(node.nodeId, 'output', response.structured_output || {})

        // Store individual fields for easy access
        if (response.structured_output) {
          Object.entries(response.structured_output).forEach(([key, value]) => {
            contextManager.setNodeVariable(node.nodeId, key, value)
          })
        }

        const executionTime = Date.now() - startTime

        contextManager.log(
          'INFO',
          node.name,
          'Information extraction completed using preprocessed data',
          {
            executionTime,
            extractedFields: Object.keys(response.structured_output || {}),
            usage: response.usage,
            preprocessingBenefit: 'Skip variable interpolation and prompt building',
          }
        )

        return {
          status: NodeRunningStatus.Succeeded,
          output: response.structured_output || {},
          outputHandle: 'source',
          metadata: {
            model: inputs.model.name,
            provider: inputs.model.provider,
            extractedFields: Object.keys(response.structured_output || {}),
            usage: response.usage,
            executionTime,
            usedPreprocessedData: true,
          },
        }
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error)
        logger.error('Information extraction failed with preprocessed data:', error)
        contextManager.log('ERROR', node.name, 'Information extraction failed', {
          error: message,
          usedPreprocessedData: true,
        })
        throw error
      }
    }

    // Fallback to original implementation
    const config = node.data as unknown as InformationExtractorConfig

    if (!config) {
      throw new Error('Information extractor node configuration is missing')
    }

    // Get organization context
    const organizationId = (await contextManager.getVariable('sys.organizationId')) as string
    const userId = (await contextManager.getVariable('sys.userId')) as string

    if (!organizationId) {
      throw new Error('Organization ID is required for information extractor node execution')
    }

    contextManager.log('INFO', node.name, 'Starting information extraction', {
      model: config.model,
      hasSchema: !!config.structured_output.schema,
      hasInstruction: config.instruction?.enabled,
      textLength: config.text?.length,
    })

    try {
      // 1. Prepare the text to extract from
      const textToExtract = await this.interpolateVariables(config.text || '', contextManager)

      if (!textToExtract) {
        throw new Error('No text provided for extraction')
      }

      // 2. Validate schema is configured
      if (!config.structured_output.enabled || !config.structured_output.schema) {
        throw new Error('Structured output schema is required for information extraction')
      }

      // 3. Build extraction prompt
      const systemPrompt = this.buildExtractionPrompt(config.structured_output.schema)

      // 4. Build messages for AI
      const messages: Array<{ role: string; content: string }> = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: textToExtract },
      ]

      // Add custom instructions if enabled
      if (config.instruction?.enabled && config.instruction.text) {
        const instruction = await this.interpolateVariables(config.instruction.text, contextManager)
        messages.push({
          role: 'system',
          content: `Additional extraction instructions: ${instruction}`,
        })
      }

      // 5. Get completion parameters
      const completionParams = {
        temperature: config.model?.completion_params?.temperature ?? 0.3, // Lower temp for extraction
        max_tokens: config.model?.completion_params?.max_tokens,
        top_p: config.model?.completion_params?.top_p,
        frequency_penalty: config.model?.completion_params?.frequency_penalty,
        presence_penalty: config.model?.completion_params?.presence_penalty,
      }

      // 5.5. Resolve model config (handles useDefault flag)
      const extracted = extractModelConfig(config.model)
      const resolvedModel = await resolveModelConfig(extracted, db, organizationId)
      const resolvedModelConfig = {
        provider: resolvedModel.provider,
        name: resolvedModel.model,
        mode: config.model.mode,
      }

      // 6. Call AI with structured output using orchestrator
      const response = await this.generateExtractionWithOrchestrator(
        resolvedModelConfig,
        messages,
        completionParams,
        config.structured_output.schema,
        organizationId,
        userId,
        contextManager,
        node.nodeId
      )

      // 7. Store extracted data
      // Store raw extraction result
      contextManager.setNodeVariable(node.nodeId, 'raw_extraction', response.content)

      // Store structured output
      contextManager.setNodeVariable(
        node.nodeId,
        'extracted_data',
        response.structured_output || {}
      )
      contextManager.setNodeVariable(node.nodeId, 'output', response.structured_output || {})

      // Store individual fields for easy access
      if (response.structured_output) {
        Object.entries(response.structured_output).forEach(([key, value]) => {
          contextManager.setNodeVariable(node.nodeId, key, value)
        })
      }

      const executionTime = Date.now() - startTime
      contextManager.log('INFO', node.name, 'Information extraction completed', {
        executionTime,
        extractedFields: Object.keys(response.structured_output || {}),
        usage: response.usage,
      })

      return {
        status: NodeRunningStatus.Succeeded,
        output: response.structured_output || {},
        outputHandle: 'source', // Standard output for transform nodes
        metadata: {
          model: config.model.name,
          provider: config.model.provider,
          extractedFields: Object.keys(response.structured_output || {}),
          usage: response.usage,
          executionTime,
        },
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      logger.error('Information extraction failed:', error)
      contextManager.log('ERROR', node.name, 'Information extraction failed', {
        error: message,
      })

      throw error
    }
  }

  /**
   * Generate information extraction using the LLM Orchestrator
   */
  private async generateExtractionWithOrchestrator(
    modelConfig: any,
    messages: Array<{ role: string; content: string }>,
    completionParams: any,
    schema: any,
    organizationId: string,
    userId: string,
    contextManager: ExecutionContextManager,
    nodeId: string
  ): Promise<{
    content: string
    structured_output?: Record<string, any>
    usage?: any
  }> {
    const provider = modelConfig.provider
    const model = modelConfig.name

    contextManager.log('DEBUG', nodeId, 'Using LLM orchestrator for information extraction', {
      provider,
      model,
      organizationId,
      schemaFields: Object.keys(schema.properties || {}),
    })

    try {
      // Convert messages to orchestrator format
      const orchestratorMessages: Message[] = messages.map((msg) => ({
        role: msg.role as any,
        content: msg.content,
      }))

      // Set up callbacks for extraction-specific logging
      const callbacks: AICallbacks = {
        beforeInvoke: async (context) => {
          contextManager.log('DEBUG', nodeId, 'Starting information extraction with orchestrator', {
            provider: context.provider,
            model: context.model,
            schemaFields: Object.keys(schema.properties || {}),
          })
        },
        afterInvoke: async (response) => {
          contextManager.log('INFO', nodeId, 'Information extraction completed successfully', {
            usage: response.usage,
            contentLength: response.content.length,
          })
        },
        onError: async (error) => {
          contextManager.log('ERROR', nodeId, 'Information extraction failed', {
            error: error.message,
          })
        },
      }

      // Get workflowId from context if available
      const workflowId = (await contextManager.getVariable('sys.workflowId')) as string | undefined

      // Create invocation request
      const invocationRequest: LLMInvocationRequest = {
        model,
        provider,
        messages: orchestratorMessages,
        parameters: {
          temperature: completionParams.temperature || 0.3, // Lower for extraction
          max_tokens: completionParams.max_tokens,
          top_p: completionParams.top_p,
          frequency_penalty: completionParams.frequency_penalty,
          presence_penalty: completionParams.presence_penalty,
        },
        organizationId,
        userId,
        context: {
          source: 'workflow',
          nodeId,
          workflowId,
        },
        structuredOutput: {
          enabled: true,
          schema: schema,
        },
        callbacks,
      }

      // Invoke orchestrator
      const response = await this.llmOrchestrator.invoke(invocationRequest)

      return {
        content: response.content,
        structured_output: response.structured_output,
        usage: response.usage,
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)

      contextManager.log('ERROR', nodeId, 'Orchestrator extraction failed', {
        error: errorMessage,
        provider,
        model,
      })

      throw error
    }
  }

  /**
   * Build extraction prompt from schema
   */
  private buildExtractionPrompt(schema: any): string {
    const fields = Object.entries(schema.properties || {})
      .map(([key, prop]: [string, any]) => {
        const required = schema.required?.includes(key) ? '(required)' : '(optional)'
        const type = prop.type || 'string'
        const description = prop.description ? `: ${prop.description}` : ''
        return `- ${key} (${type}) ${required}${description}`
      })
      .join('\n')

    return `You are an information extraction assistant. Extract the following information from the provided text according to this schema:

${fields}

IMPORTANT INSTRUCTIONS:
1. Return ONLY a valid JSON object matching the schema
2. Extract information exactly as found in the text
3. For required fields that cannot be found, use null
4. For optional fields that cannot be found, omit them from the output
5. Do not infer or make up information not present in the text
6. Maintain the exact data types specified in the schema`
  }

  /**
   * Extract variables from text and instruction fields
   */
  protected extractRequiredVariables(node: WorkflowNode): string[] {
    const config = node.data as unknown as InformationExtractorConfig
    const variables = new Set<string>()

    // Extract from text field
    if (config.text) {
      this.extractVariableIds(config.text).forEach((v) => variables.add(v))
    }

    // Extract from instruction field
    if (config.instruction?.enabled && config.instruction.text) {
      this.extractVariableIds(config.instruction.text).forEach((v) => variables.add(v))
    }

    return Array.from(variables)
  }

  /**
   * Validate node configuration
   */
  validateNode(node: WorkflowNode): ValidationResult {
    const config = node.data as unknown as InformationExtractorConfig

    if (!config) {
      return {
        valid: false,
        errors: ['Information extractor node configuration is missing'],
        warnings: [],
      }
    }

    if (!config.model?.useDefault && (!config.model?.provider || !config.model?.name)) {
      return {
        valid: false,
        errors: ['Please select an AI model'],
        warnings: [],
      }
    }

    if (!config.text) {
      return {
        valid: false,
        errors: ['Please provide text to extract information from'],
        warnings: [],
      }
    }

    if (!config.structured_output.enabled || !config.structured_output.schema) {
      return {
        valid: false,
        errors: ['Please configure the extraction schema'],
        warnings: [],
      }
    }

    return { valid: true, errors: [], warnings: [] }
  }
}
