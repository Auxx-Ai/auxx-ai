// packages/lib/src/workflow-engine/nodes/transform-nodes/text-classifier.ts

import type { Message } from '../../../ai/clients/base/types'
import type { ExecutionContextManager } from '../../core/execution-context'
import type { NodeExecutionResult, ValidationResult, WorkflowNode } from '../../core/types'
import { NodeRunningStatus, WorkflowNodeType } from '../../core/types'
import { type BaseAiModelConfig, BaseAiNodeProcessor } from '../base-ai-node'
import type {
  InvokeOrchestratorResponse,
  StructuredOutputConfig,
} from '../utils/ai-invocation-utils'
import {
  buildClassificationSystemPrompt,
  buildClassificationUserPrompt,
  type Category,
  getOutputHandleForCategory,
  parseClassificationResult,
} from '../utils/ai-response-utils'

/**
 * Text classifier configuration interface
 */
interface TextClassifierConfig {
  title?: string
  desc?: string
  model: BaseAiModelConfig
  text: string // Preprocessed text with {{variables}}
  textEditorContent?: string // Tiptap JSON content
  categories: Category[]
  vision?: { enabled: boolean }
  instruction?: {
    enabled: boolean
    text: string // Preprocessed text
    editorContent?: string // Tiptap JSON
  }
  outputMode?: 'branches' | 'variable'
}

/**
 * Text classifier node processor
 * Extends BaseAiNodeProcessor for shared AI orchestration logic
 */
export class TextClassifierProcessor extends BaseAiNodeProcessor {
  readonly type: WorkflowNodeType = WorkflowNodeType.TEXT_CLASSIFIER

  /**
   * Build messages for classification
   * Implements abstract method from BaseAiNodeProcessor
   */
  protected async buildMessages(
    node: WorkflowNode,
    data: any,
    contextManager: ExecutionContextManager
  ): Promise<Message[]> {
    const config = data as TextClassifierConfig
    const messages: Message[] = []

    // Prepare the text to classify
    const textToClassify = await this.interpolateVariables(config.text, contextManager)

    // Get custom instructions if provided
    let customInstructions: string | undefined
    if (config.instruction?.enabled && config.instruction.text) {
      customInstructions = await this.interpolateVariables(config.instruction.text, contextManager)
    }

    // Build system prompt using utility
    const systemPrompt = buildClassificationSystemPrompt(customInstructions)
    messages.push({ role: 'system', content: systemPrompt })

    // Interpolate category descriptions in parallel
    const categoriesWithInterpolatedDescriptions: Category[] = await Promise.all(
      config.categories.map(async (cat) => ({
        ...cat,
        description: cat.description
          ? await this.interpolateVariables(cat.description, contextManager)
          : undefined,
      }))
    )

    // Build user prompt using utility
    const userPrompt = buildClassificationUserPrompt(
      categoriesWithInterpolatedDescriptions,
      textToClassify
    )
    messages.push({ role: 'user', content: userPrompt })

    return messages
  }

  /**
   * Handle classification response
   * Implements abstract method from BaseAiNodeProcessor
   */
  protected async handleResponse(
    node: WorkflowNode,
    data: any,
    contextManager: ExecutionContextManager,
    response: InvokeOrchestratorResponse
  ): Promise<Partial<NodeExecutionResult>> {
    const config = data as TextClassifierConfig

    // Parse classification result using utility
    const classification = parseClassificationResult(response.content, config.categories)

    // Store additional classification-specific variables (base class already stores standard ones)
    contextManager.setNodeVariable(node.nodeId, 'category', classification.category)
    contextManager.setNodeVariable(node.nodeId, 'confidence', classification.confidence)
    contextManager.setNodeVariable(node.nodeId, 'reasoning', classification.reasoning)

    contextManager.log('INFO', node.name, 'Text classified successfully', {
      category: classification.category,
      confidence: classification.confidence,
    })

    // In variable mode, always route to single 'source' handle
    const outputHandle =
      config.outputMode === 'variable'
        ? 'source'
        : getOutputHandleForCategory(config.categories, classification.category)

    return {
      status: NodeRunningStatus.Succeeded,
      output: {
        category: classification.category,
        confidence: classification.confidence,
        reasoning: classification.reasoning,
      },
      processData: {
        classification,
      },
      outputHandle,
    }
  }

  /**
   * Get structured output configuration for classification
   * Implements abstract method from BaseAiNodeProcessor
   */
  protected getStructuredOutputConfig(
    node: WorkflowNode,
    data: any
  ): StructuredOutputConfig | undefined {
    return {
      enabled: true,
      schema: {
        type: 'object',
        properties: {
          category: { type: 'string' },
          confidence: { type: 'number' },
          reasoning: { type: 'string' },
        },
        required: ['category', 'confidence', 'reasoning'],
      },
    }
  }

  /**
   * Override default temperature for classification
   * Lower temperature for more consistent classifications
   */
  protected getDefaultTemperature(): number {
    return 0.3
  }

  /**
   * Extract variables from text, instruction, and category description fields
   */
  protected extractRequiredVariables(node: WorkflowNode): string[] {
    const config = node.data as unknown as TextClassifierConfig
    const variables = new Set<string>()

    // Extract from text field
    if (config.text) {
      this.extractVariableIds(config.text).forEach((v) => variables.add(v))
    }

    // Extract from instruction field
    if (config.instruction?.enabled && config.instruction.text) {
      this.extractVariableIds(config.instruction.text).forEach((v) => variables.add(v))
    }

    // Extract from category descriptions
    if (config.categories && Array.isArray(config.categories)) {
      config.categories.forEach((category) => {
        if (category.description) {
          this.extractVariableIds(category.description).forEach((v) => variables.add(v))
        }
      })
    }

    return Array.from(variables)
  }

  /**
   * Validate node configuration
   */
  protected async validateNodeConfig(node: WorkflowNode): Promise<ValidationResult> {
    const errors: string[] = []
    const warnings: string[] = []
    const config = node.data as unknown as TextClassifierConfig

    if (!config) {
      errors.push('Configuration is required')
      return { valid: false, errors, warnings }
    }

    // Validate model — only require provider/name when NOT using default
    if (!config.model?.useDefault) {
      if (!config.model?.provider) {
        errors.push('Model provider is required')
      }

      if (!config.model?.name) {
        errors.push('Model name is required')
      }
    }

    // Validate text
    if (!config.text?.trim()) {
      errors.push('Text to classify is required')
    }

    // Validate categories
    if (!config.categories || config.categories.length === 0) {
      errors.push('At least one category is required')
    } else {
      config.categories.forEach((category, index) => {
        if (!category.name?.trim()) {
          errors.push(`Category ${index + 1}: Name is required`)
        }
        // if (!category.description?.trim()) {
        //   // errors.push(`Category ${index + 1}: Description is required`)
        // }
      })
    }

    // Validate temperature if provided
    if (config.model?.completion_params?.temperature !== undefined) {
      const temp = config.model.completion_params.temperature
      if (typeof temp !== 'number' || temp < 0 || temp > 2) {
        errors.push('Temperature must be a number between 0 and 2')
      }
    }

    // Warnings
    if (config.categories.length > 20) {
      warnings.push('Having more than 20 categories may reduce classification accuracy')
    }

    // Note: Connection validation removed - workflow uses edges instead of node.connections
    // The connections field is deprecated and always empty

    return { valid: errors.length === 0, errors, warnings }
  }
}
