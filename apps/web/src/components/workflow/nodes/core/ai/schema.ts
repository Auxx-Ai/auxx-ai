// apps/web/src/components/workflow/nodes/core/ai/schema.ts

import { collectVariableIds, isNonEmptyDoc, type TiptapDoc } from '@auxx/lib/tiptap'
import { AI_NODE_CONSTANTS } from '@auxx/lib/workflow-engine/constants'
import { z } from 'zod'
import {
  BaseType,
  NodeCategory,
  type NodeDefinition,
  type UnifiedVariable,
  type ValidationResult,
} from '~/components/workflow/types'
import { NodeType } from '~/components/workflow/types/node-types'
import { extractVarIdsFromString } from '~/components/workflow/ui/input-editor/tiptap-converters'
import { createUnifiedOutputVariable } from '~/components/workflow/utils/variable-conversion'
import { containsVariableReference } from '~/components/workflow/utils/variable-utils'
import { AiModelMode, type AiNodeData, PromptRole } from './types'

const EMPTY_PROMPT_DOC: TiptapDoc = { type: 'doc', content: [{ type: 'paragraph' }] }

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
  useDefault: z.boolean().optional(),
  provider: z.string(),
  name: z.string(),
  mode: z.enum(AiModelMode).default(AiModelMode.CHAT),
  completion_params: completionParamsSchema,
})

/**
 * Zod schema for prompt template. Phase 4 storage shape: a Tiptap doc
 * (`{ type: 'doc', content: [...] }`) — see `PromptTemplate` in `./types.ts`.
 */
const tiptapDocSchema = z
  .object({
    type: z.literal('doc'),
    content: z.array(z.any()).optional(),
  })
  .passthrough()

const promptTemplateSchema = z.object({ role: z.enum(PromptRole), json: tiptapDocSchema })

/**
 * Zod schema for AI files
 */
const filesSchema = z.object({
  enabled: z.boolean().default(false),
  input: z.string().default(''),
  isConstant: z.boolean().default(false),
})

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
 * Zod schema for a single toolset entry on the AI node. Mirrors the shared
 * `ToolsetEntry` from `@auxx/database` so the picker dialog and back-end
 * filter pipeline work without translation.
 */
const toolsetEntrySchema = z.object({
  slug: z.string(),
  enabled: z.boolean(),
  source: z.enum(['manual', 'mention', 'auto_default']),
  config: z.record(z.string(), z.unknown()).default({}),
  appInstallationId: z.string().nullable().optional(),
})

const appAccountsSchema = z.record(z.string(), z.object({ credId: z.string() }))

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
  files: filesSchema,
  structured_output: structuredOutputSchema,
  // Flat tools shape (Phase 3)
  toolsEnabled: z.boolean().optional(),
  toolsets: z.array(toolsetEntrySchema).optional(),
  appAccounts: appAccountsSchema.optional(),
  approvalMode: z.literal('auto').optional(),
  maxIterations: z.number().optional(),
})

/**
 * Main schema for AI configuration (deprecated)
 */
export const aiSchema = z.object({
  title: z.string().min(1),
  desc: z.string().optional(),
  model: modelSchema,
  prompt_template: z.array(promptTemplateSchema).min(1),
  files: filesSchema,
  structured_output: structuredOutputSchema,
  toolsEnabled: z.boolean().optional(),
  toolsets: z.array(toolsetEntrySchema).optional(),
  appAccounts: appAccountsSchema.optional(),
  approvalMode: z.literal('auto').optional(),
  maxIterations: z.number().optional(),
})

/**
 * Factory function to create a new AI default configuration
 * This ensures each node gets its own deep copy of the config
 */
export const createAiDefaultData = (): Partial<AiNodeData> => ({
  title: 'AI',
  desc: 'AI-powered text generation',
  model: {
    useDefault: true,
    provider: '',
    name: '',
    mode: AiModelMode.CHAT,
    completion_params: { temperature: AI_NODE_CONSTANTS.TEMPERATURE.default },
  },
  prompt_template: [{ role: PromptRole.SYSTEM, json: EMPTY_PROMPT_DOC }],
  files: { enabled: false, input: '', isConstant: false },
  structured_output: { enabled: false },
  toolsEnabled: false,
  toolsets: [],
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

  // Validate model — only require provider/name when NOT using default
  if (!data.model?.useDefault) {
    if (!data.model?.provider?.trim()) {
      errors.push({ field: 'model.provider', message: 'Model provider is required', type: 'error' })
    }

    if (!data.model?.name?.trim()) {
      errors.push({ field: 'model.name', message: 'Model name is required', type: 'error' })
    }
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

    if (!template.json || !isNonEmptyDoc(template.json)) {
      errors.push({
        field: `prompt_template.${index}.json`,
        message: 'Prompt text is required',
        type: 'error',
      })
    }
  })

  // Validate structured output — enabling it without a schema only fails at
  // run time otherwise ("Node validation failed"). Surface it in the builder.
  if (data.structured_output?.enabled && !data.structured_output.schema) {
    errors.push({
      field: 'structured_output.schema',
      message: 'Structured output is enabled but no schema is defined',
      type: 'error',
    })
  }

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

  // Extract from prompt templates — chip ids from the Tiptap doc.
  data.prompt_template?.forEach((template) => {
    const ids = collectVariableIds(template.json)
    ids.forEach((id) => {
      uniqueVariableIds.add(id)
    })
  })

  // Extract from file input (only in variable mode)
  if (data.files?.input && !data.files.isConstant) {
    if (containsVariableReference(data.files.input)) {
      const ids = extractVarIdsFromString(data.files.input)
      ids.forEach((id) => uniqueVariableIds.add(id))
    } else {
      uniqueVariableIds.add(data.files.input)
    }
  }

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
  validator: validateAiData,
  canRunSingle: true,
  extractVariables: (data: AiNodeData) => extractAIVariableIds(data),
  outputVariables: getAiOutputVariables as any,
}
