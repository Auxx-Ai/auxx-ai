// apps/web/src/components/workflow/nodes/core/text-classifier/schema.ts

import { AI_NODE_CONSTANTS } from '@auxx/lib/workflow-engine/constants'
import { z } from 'zod'
import {
  BaseType,
  NodeCategory,
  type NodeDefinition,
  type ValidationResult,
} from '~/components/workflow/types'
import { NodeType } from '~/components/workflow/types/node-types'
import { extractVarIdsFromString } from '~/components/workflow/ui/input-editor/tiptap-converters'
import { createUnifiedOutputVariable } from '~/components/workflow/utils/variable-conversion'
import { TextClassifierPanel } from './panel'
import { AiModelMode, type TextClassifierNodeData } from './types'

/**
 * Zod schema for AI model completion parameters
 */
const completionParamsSchema = z.object({
  temperature: z
    .number()
    .min(AI_NODE_CONSTANTS.TEMPERATURE.min)
    .max(AI_NODE_CONSTANTS.TEMPERATURE.max)
    .default(AI_NODE_CONSTANTS.TEMPERATURE.default),
  max_tokens: z
    .number()
    .min(AI_NODE_CONSTANTS.MAX_TOKENS.min)
    .max(AI_NODE_CONSTANTS.MAX_TOKENS.max)
    .optional(),
  top_p: z.number().min(AI_NODE_CONSTANTS.TOP_P.min).max(AI_NODE_CONSTANTS.TOP_P.max).optional(),
  frequency_penalty: z
    .number()
    .min(AI_NODE_CONSTANTS.FREQUENCY_PENALTY.min)
    .max(AI_NODE_CONSTANTS.FREQUENCY_PENALTY.max)
    .optional(),
  presence_penalty: z
    .number()
    .min(AI_NODE_CONSTANTS.PRESENCE_PENALTY.min)
    .max(AI_NODE_CONSTANTS.PRESENCE_PENALTY.max)
    .optional(),
})

/**
 * Zod schema for model configuration
 */
const modelSchema = z.object({
  provider: z.string().min(1),
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
  // editorContent: z.string().optional(), // Tiptap JSON
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
  // editorContent: z.string().optional(), // Tiptap JSON
})

/**
 * Main schema for text classifier configuration
 */
export const textClassifierSchema = z.object({
  title: z.string().default('Text Classifier'),
  desc: z.string().optional(),
  model: modelSchema,
  text: z.string().default(''), // Preprocessed text
  // textEditorContent: z.string().optional(), // Tiptap JSON
  categories: z.array(categorySchema).min(1),
  vision: visionSchema,
  instruction: instructionSchema,
})

/**
 * Factory function to create a new text classifier default data
 * This ensures each node gets its own deep copy of the data
 */
export const createTextClassifierDefaultData = (): Partial<TextClassifierNodeData> => ({
  title: 'Text Classifier',
  desc: 'Classify text into predefined categories',
  model: {
    provider: '',
    name: '',
    mode: AiModelMode.CHAT,
    completion_params: { temperature: AI_NODE_CONSTANTS.TEMPERATURE.default },
  },
  text: '',
  // textEditorContent: '',
  categories: [
    {
      id: crypto.randomUUID?.() || Math.random().toString(36).substring(2, 11),
      name: 'Category 1',
      description: '',
      text: '',
      // editorContent: '',
    },
  ],
  vision: { enabled: false },
  instruction: { enabled: false, text: '' },
})

/**
 * Validation function for text classifier data
 */
export const validateTextClassifierData = (data: TextClassifierNodeData): ValidationResult => {
  const errors: Array<{ field: string; message: string; type?: 'warning' | 'error' }> = []
  // Validate title
  if (!data.title?.trim()) {
    errors.push({ field: 'title', message: 'Title is required', type: 'error' })
  }

  // Validate model
  if (!data.model?.provider?.trim()) {
    errors.push({ field: 'model.provider', message: 'Model provider is required', type: 'error' })
  }

  if (!data.model?.name?.trim()) {
    errors.push({ field: 'model.name', message: 'Model name is required', type: 'error' })
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
const extractTextClassifierVariables = (data: TextClassifierNodeData): string[] => {
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
 * Define output variables for text classifier node
 */
const getTextClassifierOutputVariables = (data: TextClassifierNodeData, nodeId: string): any[] => {
  // Create enum type from categories
  const categoryNames = data?.categories?.map((c) => c.name) || []

  return [
    createUnifiedOutputVariable({
      nodeId,
      path: 'category', // Changed from 'name' to 'path'
      type: BaseType.STRING,
      description: 'The matched category name',
      enum: categoryNames.length > 0 ? categoryNames : undefined,
    }),
    createUnifiedOutputVariable({
      nodeId,
      path: 'confidence', // Changed from 'name' to 'path'
      type: BaseType.NUMBER,
      description: 'Confidence score of the classification (0-1)',
    }),
    createUnifiedOutputVariable({
      nodeId,
      path: 'reasoning', // Changed from 'name' to 'path'
      type: BaseType.STRING,
      description: 'AI explanation for the classification',
    }),
  ]
}

/**
 * Node definition for text classifier
 */
export const textClassifierDefinition: NodeDefinition<TextClassifierNodeData> = {
  id: NodeType.TEXT_CLASSIFIER,
  category: NodeCategory.CONDITION,
  displayName: 'Text Classifier',
  description: 'Classify text into predefined categories using AI',
  icon: 'tags',
  color: '#f59e0b', // CONDITION category color
  defaultData: createTextClassifierDefaultData(),
  schema: textClassifierSchema,
  panel: TextClassifierPanel,
  validator: validateTextClassifierData,
  canRunSingle: true,
  extractVariables: extractTextClassifierVariables,
  outputVariables: getTextClassifierOutputVariables as any,
}
