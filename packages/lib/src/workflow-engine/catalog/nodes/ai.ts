// packages/lib/src/workflow-engine/catalog/nodes/ai.ts

import { z } from 'zod'
import type { ToolsetEntry } from '../../../agents/client'
import { collectVariableIds, isNonEmptyDoc, type TiptapDoc } from '../../../tiptap'
import { AI_NODE_CONSTANTS } from '../../constants'
import { BaseType } from '../../core/types'
import type { UnifiedVariable } from '../../types/unified-variable'
import {
  type ErrorDefaultValue,
  ErrorStrategy,
  errorDefaultValueSchema,
  errorHandlingBranches,
  errorStrategySchema,
} from '../error-handling'
import type { BaseNodeData } from '../node-base'
import {
  type NodeBranch,
  NodeCategory,
  type NodeManifest,
  type NodeValidationResult,
} from '../types'
import { createUnifiedOutputVariable } from '../variable-conversion'
import { containsVariableReference, extractVarIdsFromString } from '../variable-inference'

/**
 * The ai node's catalog manifest — and the home of the model-config vocabulary
 * (`PromptRole`, `AiModelMode`, `AiCompletionParams`, `completionParamsSchema`,
 * `structuredOutputSchema`) that text-classifier and information-extractor
 * share. `AiModelMode` in particular must exist ONCE: TS enums are nominal, so
 * a second declaration with identical members is a different, incompatible
 * type at every boundary the AI nodes share.
 *
 * The deprecated duplicate `aiSchema` (zero consumers; the old definition
 * pointed at it while the flattened `aiNodeDataSchema` was the real shape) was
 * deleted during the move.
 */

/**
 * Prompt roles for AI conversation
 */
export enum PromptRole {
  SYSTEM = 'system',
  USER = 'user',
  ASSISTANT = 'assistant',
}

/**
 * AI model modes
 */
export enum AiModelMode {
  CHAT = 'chat',
  COMPLETION = 'completion',
}

/**
 * AI model providers
 */
export enum AiModelProvider {
  OPENAI = 'openai',
  ANTHROPIC = 'anthropic',
  GOOGLE = 'google',
  MISTRAL = 'mistral',
}

/**
 * AI model completion parameters
 */
export interface AiCompletionParams {
  temperature: number
  max_tokens?: number
  top_p?: number
  frequency_penalty?: number
  presence_penalty?: number
}

/**
 * AI model configuration
 */
export interface AiModel {
  useDefault?: boolean
  provider: string
  name: string
  mode: AiModelMode
  completion_params: AiCompletionParams
}

/**
 * Prompt template item. Storage shape after Phase 4: the prompt body is a
 * Tiptap doc (`{ type: 'doc', content: [...] }`) so `variable-node` and
 * `reference` chips round-trip without lossy text serialization.
 *
 * Phase 5 reads `.json` directly via `docToText({ variables, references })`.
 * The legacy `text: string` field is gone — no production users (see
 * `project_no_production_users.md`), hard cut.
 */
export interface PromptTemplate {
  role: PromptRole
  json: TiptapDoc
}

/**
 * Files configuration for AI node
 */
export interface AiFiles {
  enabled: boolean
  input: string // single file reference (variable ref or file:id constant)
  isConstant: boolean // true = constant file picker, false = variable reference
}

export interface StructuredOutputConfig {
  enabled: boolean
  schema?: {
    type: 'object'
    properties: Record<string, any>
    required?: string[]
    additionalProperties?: boolean
  }
}

/**
 * Node data for AI nodes — flat tools shape (Phase 3). The legacy
 * `tools: AiToolsConfig` nested block is gone; see the Phase 3 plan.
 * `toolsets` mirrors `Agent.toolsets` so the agent-framework picker dialog and
 * the back-end `filterToolsByToolsets` pipeline work without translation.
 */
export interface AiNodeData extends BaseNodeData {
  model: AiModel
  prompt_template: PromptTemplate[]
  files: AiFiles
  structured_output: StructuredOutputConfig

  /** Master gate for the entire tool surface on this node. */
  toolsEnabled?: boolean
  /** Per-toolset enablement. Mirrors `Agent.toolsets`. */
  toolsets?: ToolsetEntry[]
  /** Per-app explicit credential pin. Mirrors `Agent.appAccounts`. */
  appAccounts?: Record<string, { credId: string }>
  /** Approval mode reserved for future use; v1 is always `auto`. */
  approvalMode?: 'auto'
  /** Default 10 for AI node; agent default is 30. */
  maxIterations?: number

  /**
   * What happens when the model call fails — `fail`, `continue`, or `default`
   * (substitute {@link AiNodeData.default_values} and carry on). Optional: no
   * node persisted before plan 21 step 4 carries the key.
   */
  error_strategy?: ErrorStrategy
  /**
   * Substitute output variables applied when `error_strategy` is `default`.
   * Keys are the node's own output names — `text`, `content`,
   * `structured_output` — so `{{<node>.text}}` still resolves downstream
   * ("if the classifier times out, use `unknown`", plan 21 §16.3).
   *
   * Named `default_values` to match crud rather than http's `default_value`;
   * the two keys are a known wart and plan 24 owns the rename, so a third type
   * joins the majority spelling instead of adding a third.
   */
  default_values?: ErrorDefaultValue[]
}

export const EMPTY_PROMPT_DOC: TiptapDoc = { type: 'doc', content: [{ type: 'paragraph' }] }

/**
 * Zod schema for AI model completion parameters.
 * Shared by text-classifier and information-extractor.
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
 * (`{ type: 'doc', content: [...] }`) — see `PromptTemplate` above.
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
 * Zod schema for structured output.
 * Shared by information-extractor.
 */
export const structuredOutputSchema = z.object({
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
  type: z.literal('ai'),
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
  // Failure policy — see `catalog/error-handling.ts`.
  error_strategy: errorStrategySchema.optional(),
  default_values: z.array(errorDefaultValueSchema).optional(),
})

/**
 * Validation function for AI configuration
 */
export const validateAiData = (data: Partial<AiNodeData>): NodeValidationResult => {
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

  // Validate temperature (an unset temperature falls back to the provider default)
  const temperature = data.model?.completion_params?.temperature
  if (temperature !== undefined) {
    if (
      temperature < AI_NODE_CONSTANTS.TEMPERATURE.min ||
      temperature > AI_NODE_CONSTANTS.TEMPERATURE.max
    ) {
      errors.push({
        field: 'model.completion_params.temperature',
        message: `Temperature must be between ${AI_NODE_CONSTANTS.TEMPERATURE.min} and ${AI_NODE_CONSTANTS.TEMPERATURE.max}`,
        type: 'error',
      })
    } else if (temperature > 0.8) {
      // Add warning for high temperature
      errors.push({
        field: 'model.completion_params.temperature',
        message: 'High temperature (>0.8) may produce more creative but less predictable results',
        type: 'warning',
      })
    }
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
 * Convert a JSON Schema fragment into a `UnifiedVariable`, recursively.
 *
 * @param schema - The JSON Schema fragment
 * @param nodeId - The node this output belongs to
 * @param path - Full path of this fragment **relative to the node**, e.g.
 *   `structured_output.order.lines[*].sku`. Nested fragments only carry their own key,
 *   so without the enclosing path the variable ID collapses to `<nodeId>.<key>` and the
 *   picker hands out a path the engine can't resolve. At run time the AI node stores the
 *   whole object once, at `<nodeId>.structured_output` (see `storeAIResponse` in
 *   `base-ai-node.ts`), and reads walk into it by prefix — only the TOP-LEVEL keys get a
 *   flat copy, so anything deeper must be addressed through `structured_output`.
 * @param key - Leaf key, used only as the description fallback
 */
const schemaToUnifiedVariable = (
  schema: any,
  nodeId: string,
  path: string,
  key: string
): UnifiedVariable => {
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
    path,
    type: getBaseType(schema.type || 'string'),
    description: schema.description || key,
  })

  // Handle object properties
  if (schema.type === 'object' && schema.properties) {
    variable.properties = {}

    for (const [propKey, propSchema] of Object.entries(schema.properties as Record<string, any>)) {
      variable.properties[propKey] = schemaToUnifiedVariable(
        propSchema,
        nodeId,
        `${path}.${propKey}`,
        propKey
      )
    }
  }

  // Handle array items. The item IS the array at `[*]`, so it claims that path outright
  // rather than appending a synthetic name to the parent.
  if (schema.type === 'array' && schema.items) {
    variable.items = schemaToUnifiedVariable(schema.items, nodeId, `${path}[*]`, key)
  }

  // Handle enum values
  if (schema.enum) {
    variable.enum = schema.enum
  }

  return variable
}

/**
 * Build the `tool_results` picker entry — the array the engine stores at
 * `<nodeId>.tool_results` once the turn made at least one tool call
 * (`ai-v2.ts` on the tools path, `base-ai-node.ts` on the plain path; the two
 * write the identical shape). Item fields mirror `AiToolResult`.
 *
 * Only the array is addressable. Per-call aliases are deliberately absent: the
 * tool a model chooses is a run-time fact, so `tool_<toolName>` cannot be
 * advertised ahead of the run, and `tool_<index>` is unbounded.
 */
const toolResultsVariable = (nodeId: string): UnifiedVariable => {
  const itemPath = 'tool_results[*]'
  const field = (key: string, type: BaseType, description: string) =>
    createUnifiedOutputVariable({ nodeId, path: `${itemPath}.${key}`, type, description })

  const item = createUnifiedOutputVariable({
    nodeId,
    path: itemPath,
    type: BaseType.OBJECT,
    description: 'A single tool call and its result',
  })
  item.properties = {
    toolCallId: field('toolCallId', BaseType.STRING, 'Provider id for this tool call'),
    toolName: field('toolName', BaseType.STRING, 'Name of the tool that was called'),
    success: field('success', BaseType.BOOLEAN, 'Whether the tool call succeeded'),
    output: field('output', BaseType.OBJECT, 'Value the tool returned'),
    error: field('error', BaseType.STRING, 'Error message when the tool call failed'),
  }

  const variable = createUnifiedOutputVariable({
    nodeId,
    path: 'tool_results',
    type: BaseType.ARRAY,
    description: 'Every tool call the AI made this run, in call order',
  })
  variable.items = item
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
      path: 'text',
      type: BaseType.STRING,
      description: 'The AI-generated response text',
    })
  )

  // Tool results exist only when the node can call tools.
  if (data.toolsEnabled) {
    outputs.push(toolResultsVariable(nodeId))
  }

  // Add structured_output if enabled and schema is defined
  if (data.structured_output?.enabled && data.structured_output.schema) {
    const structuredVar = schemaToUnifiedVariable(
      data.structured_output.schema,
      nodeId,
      'structured_output',
      'structured_output'
    )
    structuredVar.description = 'Structured output based on the defined schema'

    outputs.push(structuredVar)
  }
  return outputs
}

/**
 * AI node manifest
 */
export const aiManifest: NodeManifest<AiNodeData> = {
  id: 'ai',
  category: NodeCategory.TRANSFORM,
  displayName: 'AI',
  description: 'AI-powered text generation and processing',
  icon: 'brain',
  color: '#8B5CF6', // TRANSFORM category color
  defaultData: () => ({
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
    // Written on create for the same reason http/crud write it: `fail` is what
    // an unset node ALREADY does, so the processor emits `outputHandle: 'fail'`
    // on failure either way — persisting it is the node telling the truth about
    // the handle it emits (plan 21 §14.4). Existing rows keep no key.
    error_strategy: ErrorStrategy.fail,
    default_values: [],
    _targetBranches: [
      { id: 'source', name: '', type: 'default' },
      { id: 'fail', name: 'Fail', type: 'fail' },
    ],
  }),
  configSchema: aiNodeDataSchema as unknown as z.ZodType<AiNodeData>,
  validate: validateAiData,
  extractVariables: extractAIVariableIds,
  resolveOutputs: getAiOutputVariables,
  connection: {
    canRunSingle: true,
    /**
     * Successful runs leave via `source`; the `fail` branch comes from the
     * shared helper, the single site that turns `error_strategy: 'fail'` into
     * a handle (plan 21 §15.4).
     */
    branches: (config): NodeBranch[] => [
      { id: 'source', name: '', kind: 'default' },
      ...errorHandlingBranches(config),
    ],
  },
  /**
   * All three policies (Markus, plan 21 §18.1). A model call fails transiently
   * far more often than a transform does, and unlike the RAG cluster the AI
   * node HAS an output shape worth substituting — `text` is a plain string, so
   * "if the classifier times out, use `unknown`" is expressible.
   *
   * Scoped to the `ai` type only. `answer`, `information-extractor` and
   * `text-classifier` are AI-backed too but were never decided; they stay out
   * until they are.
   */
  errorHandling: {
    strategies: [ErrorStrategy.fail, ErrorStrategy.continue, ErrorStrategy.default],
    defaultStrategy: ErrorStrategy.fail,
  },
  agent: {
    authorable: true,
    usage:
      'Each `prompt_template` entry is { role, json } where `json` is a Tiptap doc — the Phase 3 ' +
      'normalizer converts plain text with {{…}} refs into that shape; do not author raw Tiptap. ' +
      'Leave `model.useDefault: true` unless the user names a model. Enable `structured_output` ' +
      'with a JSON schema to get typed outputs at `{{<node>.structured_output.<key>}}`; the plain ' +
      'response is always at `{{<node>.text}}`. ' +
      '`error_strategy` is fail (the default — exposes a wirable "fail" branch handle), ' +
      'continue (succeed on "source" carrying the error) or default (substitute ' +
      '`default_values`, a list of { key, type, value } keyed by this node’s own outputs, ' +
      'e.g. key "text").',
    examples: [
      {
        description: 'Summarize an inbound message with the org default model',
        config: {
          model: {
            useDefault: true,
            provider: '',
            name: '',
            mode: 'chat',
            completion_params: { temperature: 0.7 },
          },
          prompt_template: [
            {
              role: 'system',
              json: {
                type: 'doc',
                content: [
                  {
                    type: 'paragraph',
                    content: [
                      { type: 'text', text: 'Summarize the customer message in two sentences: ' },
                      { type: 'variable-node', attrs: { variableId: 'trigger-1.message.body' } },
                    ],
                  },
                ],
              },
            },
          ],
        },
      },
    ],
  },
}
