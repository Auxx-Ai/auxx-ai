// packages/lib/src/workflow-engine/catalog/nodes/text-classifier.ts

import { generateId } from '@auxx/utils/generateId'
import { z } from 'zod'
import { AI_NODE_CONSTANTS } from '../../constants'
import type { BaseNodeData, TargetBranch } from '../node-base'
import {
  type NodeBranch,
  NodeCategory,
  type NodeManifest,
  type NodeValidationResult,
} from '../types'
import { extractVarIdsFromString } from '../variable-inference'
import { AiModelMode, completionParamsSchema } from './ai'

/**
 * The text-classifier node's catalog manifest. `AiModelMode` and
 * `completionParamsSchema` come from the ai node's manifest — re-exported, not
 * redeclared, because TS enums are nominal and the AI nodes share these at
 * every boundary.
 */

export type TextClassifierOutputMode = 'branches' | 'variable'

/**
 * Model configuration interface
 */
export interface ModelConfig {
  useDefault?: boolean
  provider: string
  name: string
  mode: AiModelMode
  completion_params?: CompletionParams
}

/**
 * Completion parameters interface
 */
export interface CompletionParams {
  temperature?: number
  max_tokens?: number
  top_p?: number
  frequency_penalty?: number
  presence_penalty?: number
}

/**
 * Category interface for classification
 */
export interface Category {
  id: string
  name: string
  description?: string // Preprocessed text with {{variables}}
  text: string
}

/**
 * Vision configuration interface
 */
export interface VisionConfig {
  enabled: boolean
}

/**
 * Instruction configuration interface
 */
export interface InstructionConfig {
  enabled: boolean
  text: string // Preprocessed text
}

/**
 * Classification result interface (for backend processing)
 */
export interface ClassificationResult {
  category: string
  confidence: number
  reasoning: string
}

/**
 * Text Classifier node data interface - flattened structure
 */
export interface TextClassifierNodeData extends BaseNodeData {
  model: ModelConfig
  text: string // Preprocessed text
  categories: Category[]
  vision: VisionConfig
  instruction: InstructionConfig
  outputMode?: TextClassifierOutputMode
  _targetBranches?: TargetBranch[]
}

/**
 * Zod schema for model configuration
 */
const modelSchema = z.object({
  useDefault: z.boolean().optional(),
  provider: z.string(),
  name: z.string(),
  mode: z.enum(AiModelMode).default(AiModelMode.CHAT),
  completion_params: completionParamsSchema.optional(),
})

/**
 * Zod schema for category
 */
const categorySchema = z.object({
  id: z.string(),
  name: z.string().max(AI_NODE_CONSTANTS.TEXT_CLASSIFIER.CATEGORY_NAME_MAX_LENGTH),
  description: z
    .string()
    .max(AI_NODE_CONSTANTS.TEXT_CLASSIFIER.CATEGORY_DESCRIPTION_MAX_LENGTH)
    .optional(), // Preprocessed text
  text: z.string().default(''), // Preprocessed text
})

/**
 * Zod schema for vision configuration
 */
const visionSchema = z.object({ enabled: z.boolean().default(false) })

/**
 * Zod schema for instruction configuration
 */
const instructionSchema = z.object({
  enabled: z.boolean().default(false),
  text: z.string().default(''), // Preprocessed text
})

/**
 * Main schema for text classifier configuration
 */
export const textClassifierSchema = z.object({
  title: z.string().default('Text Classifier'),
  desc: z.string().optional(),
  model: modelSchema,
  text: z.string().default(''), // Preprocessed text
  categories: z.array(categorySchema).min(1),
  vision: visionSchema,
  instruction: instructionSchema,
  outputMode: z.enum(['branches', 'variable']).default('branches'),
})

/**
 * Validation function for text classifier data
 */
export const validateTextClassifierData = (data: TextClassifierNodeData): NodeValidationResult => {
  const errors: Array<{ field: string; message: string; type?: 'warning' | 'error' }> = []
  // Validate title
  if (!data.title?.trim()) {
    errors.push({ field: 'title', message: 'Title is required', type: 'error' })
  }

  // Validate model — only require provider/name when NOT using default
  if (!data.model?.useDefault) {
    if (!data.model?.provider?.trim()) {
      errors.push({ field: 'model.provider', message: 'Model provider is required', type: 'error' })
    }

    if (!data.model?.name?.trim()) {
      errors.push({ field: 'model.name', message: 'Model name is required', type: 'error' })
    }
  }

  // Validate text to classify
  if (!data.text?.trim()) {
    errors.push({ field: 'text', message: 'Text to classify is required', type: 'error' })
  }

  // Validate categories
  if (!data.categories || data.categories.length === 0) {
    errors.push({
      field: 'categories',
      message: 'At least one category is required',
      type: 'error',
    })
  } else if (data.categories.length < AI_NODE_CONSTANTS.TEXT_CLASSIFIER.MIN_CATEGORIES) {
    errors.push({
      field: 'categories',
      message: `At least ${AI_NODE_CONSTANTS.TEXT_CLASSIFIER.MIN_CATEGORIES} categories are required`,
      type: 'error',
    })
  } else if (data.categories.length > AI_NODE_CONSTANTS.TEXT_CLASSIFIER.MAX_CATEGORIES) {
    errors.push({
      field: 'categories',
      message: `Cannot exceed ${AI_NODE_CONSTANTS.TEXT_CLASSIFIER.MAX_CATEGORIES} categories`,
      type: 'error',
    })
  }

  // Validate each category
  data.categories?.forEach((category, index) => {
    if (!category.name?.trim()) {
      errors.push({
        field: `categories.${index}.name`,
        message: 'Category name is required',
        type: 'error',
      })
    } else if (category.name.length > AI_NODE_CONSTANTS.TEXT_CLASSIFIER.CATEGORY_NAME_MAX_LENGTH) {
      errors.push({
        field: `categories.${index}.name`,
        message: `Category name cannot exceed ${AI_NODE_CONSTANTS.TEXT_CLASSIFIER.CATEGORY_NAME_MAX_LENGTH} characters`,
        type: 'error',
      })
    }

    // Category description is required
    if (!category.description?.trim()) {
      errors.push({
        field: `categories.${index}.description`,
        message: 'Category description is recommended for better classification',
        type: 'warning',
      })
    } else if (
      category.description.length >
      AI_NODE_CONSTANTS.TEXT_CLASSIFIER.CATEGORY_DESCRIPTION_MAX_LENGTH
    ) {
      errors.push({
        field: `categories.${index}.description`,
        message: `Category description cannot exceed ${AI_NODE_CONSTANTS.TEXT_CLASSIFIER.CATEGORY_DESCRIPTION_MAX_LENGTH} characters`,
        type: 'error',
      })
    }
  })

  // Add warnings for optional fields
  if (!data.desc?.trim()) {
    errors.push({
      field: 'desc',
      message: 'Consider adding a description for better documentation',
      type: 'warning',
    })
  }

  return { isValid: errors.filter((e) => e.type === 'error').length === 0, errors }
}

/**
 * Extract variables from text classifier data
 */
export const extractTextClassifierVariables = (data: TextClassifierNodeData): string[] => {
  const uniqueVariables = new Set<string>()

  // Extract from main text
  extractVarIdsFromString(data.text).forEach((varId) => {
    uniqueVariables.add(varId)
  })

  // Extract from category descriptions
  data.categories?.forEach((category) => {
    extractVarIdsFromString(category.text).forEach((varId) => {
      uniqueVariables.add(varId)
    })
  })

  // Extract from instructions if enabled
  if (data.instruction?.enabled) {
    extractVarIdsFromString(data.instruction.text).forEach((varId) => {
      uniqueVariables.add(varId)
    })
  }

  return Array.from(uniqueVariables)
}

/**
 * Text classifier node manifest
 */
export const textClassifierManifest: NodeManifest<TextClassifierNodeData> = {
  id: 'text-classifier',
  category: NodeCategory.CONDITION,
  displayName: 'Text Classifier',
  description: 'Classify text into predefined categories using AI',
  icon: 'tags',
  color: '#f59e0b', // CONDITION category color
  defaultData: () => ({
    title: 'Text Classifier',
    desc: 'Classify text into predefined categories',
    model: {
      useDefault: true,
      provider: '',
      name: '',
      mode: AiModelMode.CHAT,
      completion_params: { temperature: AI_NODE_CONSTANTS.TEMPERATURE.default },
    },
    text: '',
    categories: [
      {
        id: generateId(),
        name: 'Category 1',
        description: '',
        text: '',
      },
    ],
    vision: { enabled: false },
    instruction: { enabled: false, text: '' },
    outputMode: 'branches' as const,
  }),
  configSchema: textClassifierSchema as unknown as z.ZodType<TextClassifierNodeData>,
  validate: validateTextClassifierData,
  extractVariables: extractTextClassifierVariables,
  connection: {
    canRunSingle: true,
    /**
     * Variable mode routes everything through 'source'; branches mode (the
     * default) exposes one handle per category id plus the reserved
     * 'unmatched'. Mirrors the TEXT_CLASSIFIER arm of the canvas's
     * `calculateTargetBranches` (workflow-initializer.ts, which returns
     * undefined — no handles — for a node with no categories), the last
     * branch-deriving arm besides crud still living there.
     */
    branches: (config): NodeBranch[] => {
      if (config.outputMode === 'variable') {
        return [{ id: 'source', name: '', kind: 'default' }]
      }
      if (!config.categories?.length) return []
      return [
        ...config.categories.map((cat) => ({
          id: cat.id,
          name: cat.name,
          kind: 'default' as const,
        })),
        { id: 'unmatched', name: 'Unmatched', kind: 'default' as const },
      ]
    },
  },
  agent: {
    authorable: true,
    usage:
      "Each entry in `categories` becomes a wirable branch handle (edge sourceHandle = the category's " +
      "`id`), plus the reserved 'unmatched' handle. Set `outputMode: 'variable'` to skip branching and " +
      'read `{{<node>.category}}` instead. `text` is the input to classify and may contain {{…}} refs; ' +
      'category `description` guides the model. Leave `model.useDefault: true` unless the user names a model.',
    examples: [
      {
        description: 'Route tickets by intent',
        config: {
          model: { useDefault: true, provider: '', name: '', mode: 'chat' },
          text: '{{trigger-1.message.body}}',
          categories: [
            { id: 'cat-refund', name: 'Refund', description: 'Asks for money back', text: '' },
            {
              id: 'cat-shipping',
              name: 'Shipping',
              description: 'Asks where an order is',
              text: '',
            },
          ],
          vision: { enabled: false },
          instruction: { enabled: false, text: '' },
          outputMode: 'branches',
        },
      },
    ],
  },
}
