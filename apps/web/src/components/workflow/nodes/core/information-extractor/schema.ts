// apps/web/src/components/workflow/nodes/core/information-extractor/schema.ts

import { AI_NODE_CONSTANTS } from '@auxx/lib/workflow-engine/constants'
import { z } from 'zod'
import {
  NodeCategory,
  type NodeDefinition,
  type ValidationResult,
} from '~/components/workflow/types'
import { NodeType } from '~/components/workflow/types/node-types'
import { BaseType, type UnifiedVariable } from '~/components/workflow/types/variable-types'
import { extractVarIdsFromString } from '~/components/workflow/ui/input-editor/tiptap-converters'
import { schemaToUnifiedVariable } from '~/components/workflow/utils/schema-to-variable'
import { createUnifiedOutputVariable } from '~/components/workflow/utils/variable-conversion'
import type { InformationExtractorNodeData } from './types'

/**
 * Zod schema for AI model completion parameters
 * Reused from AI node
 */
export const completionParamsSchema = z.object({
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
  mode: z.enum(['chat', 'completion']).default('chat'),
  completion_params: completionParamsSchema.optional(),
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
 * Zod schema for structured output configuration
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
 * Main schema for information extractor configuration
 */
export const informationExtractorSchema = z.object({
  title: z.string().default('Information Extractor'),
  desc: z.string().optional(),
  model: modelSchema,
  text: z.string().default(''), // Preprocessed text
  textEditorContent: z.string().optional(), // Tiptap JSON
  structured_output: structuredOutputSchema,
  vision: visionSchema,
  instruction: instructionSchema,
})

/**
 * Factory function to create default data
 */
export const createInformationExtractorDefaultData = (defaultModel?: {
  provider: string
  model: string
  mode: 'chat' | 'completion'
  completionParams: Record<string, any>
}): Partial<InformationExtractorNodeData> => ({
  title: 'Information Extractor',
  desc: 'Extract structured information from text using AI',
  model: defaultModel
    ? {
        provider: defaultModel.provider,
        name: defaultModel.model,
        mode: defaultModel.mode,
        completion_params: {
          temperature: 0.3, // Lower temperature for extraction - override default
          ...defaultModel.completionParams,
        },
      }
    : { provider: '', name: '', mode: 'chat', completion_params: { temperature: 0.3 } },
  text: '',
  // textEditorContent: undefined,
  structured_output: { enabled: false, schema: undefined },
  vision: { enabled: false },
  instruction: { enabled: false, text: '' },
})

/**
 * Validation function for information extractor data
 */
export function validateInformationExtractor(data: InformationExtractorNodeData): ValidationResult {
  try {
    informationExtractorSchema.parse(data)

    // Additional validation
    if (!data.model.provider || !data.model.name) {
      return {
        isValid: false,
        errors: [{ field: 'model', message: 'Please select an AI model', type: 'error' as const }],
      }
    }

    if (!data.text.trim()) {
      return {
        isValid: false,
        errors: [
          {
            field: 'text',
            message: 'Please provide text to extract information from',
            type: 'error' as const,
          },
        ],
      }
    }

    if (data.structured_output.enabled && !data.structured_output.schema) {
      return {
        isValid: false,
        errors: [
          {
            field: 'structured_output',
            message: 'Please configure the extraction schema',
            type: 'error' as const,
          },
        ],
      }
    }

    // Validate schema field count if enabled
    if (data.structured_output.enabled && data.structured_output.schema?.properties) {
      const fieldCount = Object.keys(data.structured_output.schema.properties).length
      if (fieldCount > AI_NODE_CONSTANTS.INFO_EXTRACTOR.MAX_FIELDS) {
        return {
          isValid: false,
          errors: [
            {
              field: 'structured_output',
              message: `Cannot exceed ${AI_NODE_CONSTANTS.INFO_EXTRACTOR.MAX_FIELDS} fields in the extraction schema`,
              type: 'error' as const,
            },
          ],
        }
      }
    }

    return { isValid: true, errors: [] }
  } catch (error) {
    if (error instanceof z.ZodError) {
      return {
        isValid: false,
        errors: error.issues.map((e) => ({
          field: e.path.join('.'),
          message: e.message,
          type: 'error' as const,
        })),
      }
    }
    return {
      isValid: false,
      errors: [{ field: 'general', message: 'Invalid configuration', type: 'error' as const }],
    }
  }
}

/**
 * Extract variables from data for single run
 */
export function extractInformationExtractorVariables(data: InformationExtractorNodeData): string[] {
  const uniqueVariables = new Set<string>()

  // Extract from main text
  extractVarIdsFromString(data.text).forEach((varId) => {
    uniqueVariables.add(varId)
  })

  // Extract from instruction if enabled
  if (data.instruction.enabled) {
    extractVarIdsFromString(data.instruction.text).forEach((varId) => {
      uniqueVariables.add(varId)
    })
  }

  return Array.from(uniqueVariables)
}

/**
 * Define output variables for information extractor node
 * Follows the same pattern as the AI node's getAiOutputVariables
 */
const getInformationExtractorOutputVariables = (
  data: InformationExtractorNodeData,
  nodeId: string
): UnifiedVariable[] => {
  const outputs: UnifiedVariable[] = []

  // Always include raw extraction result
  outputs.push(
    createUnifiedOutputVariable({
      nodeId,
      path: 'raw_extraction',
      type: BaseType.STRING,
      description: 'Raw extraction result as text',
    })
  )

  // Add extracted_data if structured output is enabled and schema is defined
  if (data.structured_output.enabled && data.structured_output.schema) {
    const extractedData = schemaToUnifiedVariable(
      data.structured_output.schema,
      nodeId,
      'extracted_data'
    )
    extractedData.label = 'Extracted Data'
    extractedData.description = 'Structured data extracted from the input'

    outputs.push(extractedData)
  }

  return outputs
}

/**
 * Node definition for information extractor
 */
export const informationExtractorDefinition: NodeDefinition<InformationExtractorNodeData> = {
  id: NodeType.INFORMATION_EXTRACTOR,
  category: NodeCategory.TRANSFORM,
  displayName: 'Information Extractor',
  description: 'Extract structured information from text using AI with custom schemas',
  icon: 'file-json', // More appropriate icon for extraction
  color: '#8B5CF6', // TRANSFORM category color
  schema: informationExtractorSchema,
  defaultData: createInformationExtractorDefaultData(),
  canRunSingle: true,
  validator: validateInformationExtractor,
  extractVariables: extractInformationExtractorVariables,
  outputVariables: getInformationExtractorOutputVariables,
}
