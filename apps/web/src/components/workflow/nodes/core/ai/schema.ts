// apps/web/src/components/workflow/nodes/core/ai/schema.ts

import { z } from 'zod'
import {
  type NodeDefinition,
  NodeCategory,
  type ValidationResult,
} from '~/components/workflow/types'
import { type AiNodeData, PromptRole, AiModelMode } from './types'
import { AiPanel } from './panel'
import { NodeType } from '~/components/workflow/types/node-types'
import { type UnifiedVariable, BaseType } from '~/components/workflow/types'
import { createUnifiedOutputVariable } from '~/components/workflow/utils/variable-conversion'
import { extractVarIdsFromString } from '~/components/workflow/ui/input-editor/tiptap-converters'
import { AI_NODE_CONSTANTS } from '@auxx/lib/workflow-engine/constants'

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
 * Zod schema for AI model
 */
const modelSchema = z.object({
  provider: z.string().min(1),
  name: z.string().min(1),
  mode: z.enum(AiModelMode).default(AiModelMode.CHAT),
  completion_params: completionParamsSchema,
})

/**
 * Zod schema for prompt template
 */
const promptTemplateSchema = z.object({ role: z.enum(PromptRole), text: z.string() })

/**
 * Zod schema for AI context
 */
const contextSchema = z.object({
  enabled: z.boolean().default(false),
  variable_selector: z.array(z.string()).default([]),
})

/**
 * Zod schema for AI vision
 */
const visionSchema = z.object({ enabled: z.boolean().default(false) })

/**
 * Zod schema for structured output
 */
const structuredOutputSchema = z.object({
  enabled: z.boolean().default(false),
  schema: z
    .object({
      type: z.literal('object'),
      properties: z.record(z.string(), z.any()),
      required: z.array(z.string()).optional(),
      additionalProperties: z.boolean().optional(),
    })
    .optional(),
})

/**
 * Main schema for AI node data
 */
export const aiNodeDataSchema = z.object({
  // Base fields
  id: z.string(),
  type: z.literal(NodeType.AI),
  title: z.string().min(1),
  desc: z.string().optional(),
  // AI-specific fields
  model: modelSchema,
  prompt_template: z.array(promptTemplateSchema).min(1),
  context: contextSchema,
  vision: visionSchema,
  structured_output: structuredOutputSchema,
})

/**
 * Main schema for AI configuration (deprecated)
 */
export const aiSchema = z.object({
  title: z.string().min(1),
  desc: z.string().optional(),
  model: modelSchema,
  prompt_template: z.array(promptTemplateSchema).min(1),
  context: contextSchema,
  vision: visionSchema,
  structured_output: structuredOutputSchema,
})

/**
 * Factory function to create a new AI default configuration
 * This ensures each node gets its own deep copy of the config
 */
export const createAiDefaultData = (): Partial<AiNodeData> => ({
  title: 'AI',
  desc: 'AI-powered text generation',
  model: {
    provider: '',
    name: '',
    mode: AiModelMode.CHAT,
    completion_params: { temperature: AI_NODE_CONSTANTS.TEMPERATURE.default },
  },
  prompt_template: [{ role: PromptRole.SYSTEM, text: '' }],
  context: { enabled: false, variable_selector: [] },
  vision: { enabled: false },
  structured_output: { enabled: false },
})

/**
 * Validation function for AI configuration
 */
export const validateAiData = (data: Partial<AiNodeData>): ValidationResult => {
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

  // Validate temperature
  if (
    data.model?.completion_params?.temperature < AI_NODE_CONSTANTS.TEMPERATURE.min ||
    data.model?.completion_params?.temperature > AI_NODE_CONSTANTS.TEMPERATURE.max
  ) {
    errors.push({
      field: 'model.completion_params.temperature',
      message: `Temperature must be between ${AI_NODE_CONSTANTS.TEMPERATURE.min} and ${AI_NODE_CONSTANTS.TEMPERATURE.max}`,
      type: 'error',
    })
  } else if (data.model?.completion_params?.temperature > 0.8) {
    // Add warning for high temperature
    errors.push({
      field: 'model.completion_params.temperature',
      message: 'High temperature (>0.8) may produce more creative but less predictable results',
      type: 'warning',
    })
  }

  // Validate prompt template
  if (!data.prompt_template || data.prompt_template.length === 0) {
    errors.push({
      field: 'prompt_template',
      message: 'At least one prompt template is required',
      type: 'error',
    })
  }

  // Validate each prompt template
  data.prompt_template?.forEach((template, index) => {
    if (!template.role) {
      errors.push({
        field: `prompt_template.${index}.role`,
        message: 'Prompt role is required',
        type: 'error',
      })
    }

    if (!template.text?.trim()) {
      errors.push({
        field: `prompt_template.${index}.text`,
        message: 'Prompt text is required',
        type: 'error',
      })
    }

    // Validate prompt length
    if (template.text && template.text.length > AI_NODE_CONSTANTS.PROMPT.MAX_LENGTH) {
      errors.push({
        field: `prompt_template.${index}.text`,
        message: `Prompt text cannot exceed ${AI_NODE_CONSTANTS.PROMPT.MAX_LENGTH} characters`,
        type: 'error',
      })
    }
  })

  // Check if there are any errors (not warnings)
  const hasErrors = errors.filter((e) => e.type === 'error').length > 0

  return { isValid: !hasErrors, errors }
}

/**
 * Convert JSON Schema to UnifiedVariable recursively
 */
const schemaToUnifiedVariable = (schema: any, nodeId: string, name: string): UnifiedVariable => {
  // Determine the base type
  const getBaseType = (schemaType: string): BaseType => {
    switch (schemaType) {
      case 'string':
        return BaseType.STRING
      case 'number':
      case 'integer':
        return BaseType.NUMBER
      case 'boolean':
        return BaseType.BOOLEAN
      case 'array':
        return BaseType.ARRAY
      case 'object':
        return BaseType.OBJECT
      default:
        return BaseType.STRING
    }
  }

  const variable = createUnifiedOutputVariable({
    nodeId,
    path: name, // Changed from 'name' to 'path'
    type: getBaseType(schema.type || 'string'),
    description: schema.description || name,
  })

  // Handle object properties
  if (schema.type === 'object' && schema.properties) {
    variable.properties = {}

    for (const [propKey, propSchema] of Object.entries(schema.properties as Record<string, any>)) {
      variable.properties[propKey] = schemaToUnifiedVariable(propSchema, nodeId, propKey)
    }
  }

  // Handle array items
  if (schema.type === 'array' && schema.items) {
    variable.items = schemaToUnifiedVariable(schema.items, nodeId, `${name}_item`)
  }

  // Handle enum values
  if (schema.enum) {
    variable.enum = schema.enum
  }

  // Generate children after all properties and items are set
  if (variable.properties || variable.items) {
  }

  return variable
}

/**
 * Define output variables for AI node
 */
const getAiOutputVariables = (data: Partial<AiNodeData>, nodeId: string): UnifiedVariable[] => {
  const outputs: UnifiedVariable[] = []

  // Always output the text response
  outputs.push(
    createUnifiedOutputVariable({
      nodeId,
      path: 'text', // Changed from 'name' to 'path'
      type: BaseType.STRING,
      description: 'The AI-generated response text',
    })
  )

  // Add structured_output if enabled and schema is defined
  if (data.structured_output?.enabled && data.structured_output.schema) {
    const structuredVar = schemaToUnifiedVariable(
      data.structured_output.schema,
      nodeId,
      'structured_output'
    )
    structuredVar.description = 'Structured output based on the defined schema'

    outputs.push(structuredVar)
  }
  return outputs
}

/**
 * Extracts variable IDs from an AI node configuration
 */
export function extractAIVariableIds(data: AiNodeData): string[] {
  const uniqueVariableIds = new Set<string>()

  // Extract from prompt templates
  data.prompt_template?.forEach((template: any) => {
    const ids = extractVarIdsFromString(template.text)
    ids.forEach((id) => {
      uniqueVariableIds.add(id)
    })
  })

  return Array.from(uniqueVariableIds)
}
/**
 * Node definition for AI
 */
export const aiDefinition: NodeDefinition<AiNodeData> = {
  id: NodeType.AI,
  category: NodeCategory.TRANSFORM,
  displayName: 'AI',
  description: 'AI-powered text generation and processing',
  icon: 'brain',
  color: '#8B5CF6', // TRANSFORM category color
  defaultData: createAiDefaultData(),
  schema: aiSchema,
  dataSchema: aiNodeDataSchema,
  // validate: validateAiConfig,
  panel: AiPanel,
  validator: validateAiData,
  canRunSingle: true,
  extractVariables: (data: AiNodeData) => extractAIVariableIds(data),
  outputVariables: getAiOutputVariables as any,
}
