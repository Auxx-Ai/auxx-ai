// packages/lib/src/workflow-engine/catalog/nodes/information-extractor.ts

import { z } from 'zod'
import { AI_NODE_CONSTANTS } from '../../constants'
import { BaseType } from '../../core/types'
import type { UnifiedVariable } from '../../types/unified-variable'
import type { BaseNodeData } from '../node-base'
import { schemaToUnifiedVariable } from '../schema-to-variable'
import { NodeCategory, type NodeManifest, type NodeValidationResult } from '../types'
import { createUnifiedOutputVariable } from '../variable-conversion'
import { extractVarIdsFromString } from '../variable-inference'
import { completionParamsSchema, structuredOutputSchema } from './ai'

/**
 * The information-extractor node's catalog manifest.
 * `completionParamsSchema` / `structuredOutputSchema` are the ai node's —
 * shared, not redeclared. The structured-output schema member is typed loosely
 * (`type: string`) so apps/web can narrow it to its `SchemaRoot` (whose `type`
 * is a string enum member, not the literal 'object') without a cast.
 */

/**
 * Model configuration
 */
export interface InformationExtractorModel {
  useDefault?: boolean
  provider: string
  name: string
  mode: 'chat' | 'completion'
  completion_params?: {
    temperature: number
    max_tokens?: number
    top_p?: number
    frequency_penalty?: number
    presence_penalty?: number
  }
}

/**
 * Vision configuration
 */
export interface InformationExtractorVision {
  enabled: boolean
}

/**
 * Instruction configuration
 */
export interface InformationExtractorInstruction {
  enabled: boolean
  text: string
}

/**
 * Node data interface - flattened structure
 */
export interface InformationExtractorNodeData extends BaseNodeData {
  model: InformationExtractorModel
  text: string // Preprocessed text with variables
  structured_output: {
    enabled: boolean
    schema?: {
      type: string // always 'object'; string so web's SchemaRoot narrows cleanly
      properties: Record<string, any>
      required?: string[]
      additionalProperties?: boolean | Record<string, any>
    }
  }
  vision: InformationExtractorVision
  instruction: InformationExtractorInstruction
}

/**
 * Zod schema for model configuration
 */
const modelSchema = z.object({
  useDefault: z.boolean().optional(),
  provider: z.string(),
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
export const createInformationExtractorDefaultData = (): Partial<InformationExtractorNodeData> => ({
  title: 'Information Extractor',
  desc: 'Extract structured information from text using AI',
  model: {
    useDefault: true,
    provider: '',
    name: '',
    mode: 'chat',
    completion_params: { temperature: 0.3 }, // Lower temperature for extraction
  },
  text: '',
  structured_output: { enabled: false, schema: undefined },
  vision: { enabled: false },
  instruction: { enabled: false, text: '' },
})

/**
 * Validation function for information extractor data
 */
export function validateInformationExtractor(
  data: InformationExtractorNodeData
): NodeValidationResult {
  try {
    informationExtractorSchema.parse(data)

    // Validate model — only require provider/name when NOT using default
    if (!data.model.useDefault && (!data.model.provider || !data.model.name)) {
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
function getInformationExtractorOutputVariables(
  data: InformationExtractorNodeData,
  nodeId: string
): UnifiedVariable[] {
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
 * Information extractor node manifest
 */
export const informationExtractorManifest: NodeManifest<InformationExtractorNodeData> = {
  id: 'information-extractor',
  category: NodeCategory.TRANSFORM,
  displayName: 'Information Extractor',
  description: 'Extract structured information from text using AI with custom schemas',
  icon: 'file-json',
  color: '#8B5CF6', // TRANSFORM category color
  defaultData: createInformationExtractorDefaultData,
  configSchema: informationExtractorSchema as unknown as z.ZodType<InformationExtractorNodeData>,
  validate: validateInformationExtractor,
  extractVariables: extractInformationExtractorVariables,
  resolveOutputs: getInformationExtractorOutputVariables,
  connection: {
    canRunSingle: true,
  },
  agent: {
    authorable: true,
    usage:
      'Define the fields to pull out as a JSON schema in `structured_output.schema` (enable it) — ' +
      'each top-level key becomes `{{<node>.extracted_data.<key>}}`; the raw model answer is at ' +
      '`{{<node>.raw_extraction}}`. `text` is the input and may contain {{…}} refs. Leave ' +
      '`model.useDefault: true` unless the user names a model.',
    examples: [
      {
        description: 'Pull an order number and sentiment out of a message',
        config: {
          model: { useDefault: true, provider: '', name: '', mode: 'chat' },
          text: '{{trigger-1.message.body}}',
          structured_output: {
            enabled: true,
            schema: {
              type: 'object',
              properties: {
                orderNumber: { type: 'string', description: 'Order reference if mentioned' },
                sentiment: { type: 'string', enum: ['positive', 'neutral', 'negative'] },
              },
            },
          },
          vision: { enabled: false },
          instruction: { enabled: false, text: '' },
        },
      },
    ],
  },
}
