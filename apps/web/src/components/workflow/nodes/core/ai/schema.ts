// apps/web/src/components/workflow/nodes/core/ai/schema.ts

import { aiManifest, type NodeManifest } from '@auxx/lib/workflow-engine/client'
import { BaseType, type NodeDefinition, type UnifiedVariable } from '~/components/workflow/types'
import { createUnifiedOutputVariable } from '~/components/workflow/utils/variable-conversion'
import { defineFromManifest } from '../../define-from-manifest'
import type { AiNodeData } from './types'

// The data half (enums, model-config vocabulary, data interface, zod schema,
// defaults, validator, variable extraction) lives in the node catalog
// (`@auxx/lib/workflow-engine/catalog/nodes/ai`). This file is the merge site:
// manifest + the web-only output resolver.

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

/** Node definition for AI */
export const aiDefinition: NodeDefinition<AiNodeData> = defineFromManifest(
  aiManifest as unknown as NodeManifest<AiNodeData>,
  { outputVariables: getAiOutputVariables as any }
)

// Back-compat re-exports so no consumer import churns:
export {
  aiNodeDataSchema,
  extractAIVariableIds,
  validateAiData,
} from '@auxx/lib/workflow-engine/client'

/** Factory function to create a new AI default configuration */
export function createAiDefaultData(): Partial<AiNodeData> {
  return aiManifest.defaultData() as Partial<AiNodeData>
}
