// packages/lib/src/workflow-engine/catalog/nodes/code.ts

import { z } from 'zod'
import { BaseType } from '../../core/types'
import type { UnifiedVariable } from '../../types/unified-variable'
import type { BaseNodeData } from '../node-base'
import { NodeCategory, type NodeManifest, type NodeValidationResult } from '../types'
import { createUnifiedOutputVariable } from '../variable-conversion'

/**
 * The code node's catalog manifest.
 *
 * Drift fixed during the move (plan §6): the persisted `outputs[].type` is a
 * `BaseType` string (that is what the output editor writes and `defaultData`
 * seeds), but the old output resolver read `output.type?.type` — an object
 * shape only the LEGACY `CodeOutput` map ever used — so every code-node output
 * silently resolved as STRING. `normalizeCodeOutputType` below is the one
 * read: `BaseType` string first, the legacy `{ type }` object tolerated. The
 * deprecated duplicate `codeSchema` (zero consumers) was deleted.
 */

/** Variable input for code execution */
export interface CodeVariable {
  variable: string
  value_selector: string[]
}

/** Output definition for code node */
export interface CodeNodeOutput {
  name: string
  type: BaseType
  description?: string
}

/** Legacy output format */
export interface CodeOutput {
  [key: string]: { type: 'string' | 'number' | 'object' | 'array'; children?: any }
}

/** Input definition for code node */
export interface CodeNodeInput {
  name: string
  variableId: string
}

/** Node data for code nodes (flattened structure) */
export interface CodeNodeData extends BaseNodeData {
  variables?: CodeVariable[]
  code_language: 'python3' | 'javascript'
  code: string
  inputs?: CodeNodeInput[]
  outputs?: CodeNodeOutput[]
  legacyOutputs?: CodeOutput
}

/**
 * Zod schema for code node data (flattened structure).
 * `outputs[].type` was `z.any()` — now the `BaseType` the editor writes, with
 * the legacy `{ type }` object shape tolerated on old rows.
 */
export const codeNodeDataSchema = z.object({
  // Base node properties
  id: z.string(),
  type: z.literal('code'),
  selected: z.boolean().default(false),

  // Flattened config properties
  title: z.string().min(1),
  desc: z.string().optional(),
  code_language: z.enum(['javascript', 'python3']).default('javascript'),
  code: z.string(),
  inputs: z.array(z.object({ name: z.string(), variableId: z.string() })).optional(),
  outputs: z
    .array(
      z.object({
        name: z.string(),
        type: z.union([z.enum(BaseType), z.object({ type: z.string() }).passthrough()]),
        description: z.string().optional(),
      })
    )
    .optional(),

  // Other node data properties
  isValid: z.boolean().optional(),
  errors: z.array(z.string()).optional(),
  disabled: z.boolean().optional(),
  outputVariables: z.array(z.string()).optional(),
})

/**
 * Resolve a persisted `outputs[].type` to a `BaseType`.
 * Current rows hold a `BaseType` string; legacy rows may hold the
 * `CodeOutput`-style `{ type }` object. Anything else falls back to STRING.
 */
export function normalizeCodeOutputType(raw: unknown): BaseType {
  const candidate =
    raw && typeof raw === 'object' && 'type' in raw ? (raw as { type: unknown }).type : raw
  if (typeof candidate === 'string' && (Object.values(BaseType) as string[]).includes(candidate)) {
    return candidate as BaseType
  }
  return BaseType.STRING
}

/** Validation function for code configuration */
export const validateCodeConfig = (data: CodeNodeData): NodeValidationResult => {
  const errors: Array<{ field: string; message: string; type?: 'warning' | 'error' }> = []

  // Validate title
  if (!data.title?.trim()) {
    errors.push({ field: 'title', message: 'Title is required', type: 'error' })
  }

  // Validate code content
  if (!data.code?.trim()) {
    errors.push({ field: 'code', message: 'Code is required', type: 'error' })
  }

  // Basic syntax check for JavaScript
  if (data.code_language === 'javascript') {
    try {
      new Function(data.code)

      // Check for main function definition
      if (data.code && !data.code.includes('main')) {
        errors.push({
          field: 'code',
          message: 'Code must define a main() function',
          type: 'error',
        })
      }

      // Add warnings for potentially unsafe patterns
      if (data.code?.includes('eval(')) {
        errors.push({
          field: 'code',
          message: 'Using eval() is potentially unsafe and should be avoided',
          type: 'warning',
        })
      }

      if (data.code?.includes('innerHTML')) {
        errors.push({
          field: 'code',
          message: 'Direct innerHTML manipulation can lead to XSS vulnerabilities',
          type: 'warning',
        })
      }
    } catch (error) {
      errors.push({
        field: 'code',
        message: `JavaScript syntax error: ${error instanceof Error ? error.message : 'Unknown error'}`,
        type: 'error',
      })
    }
  }

  const hasErrors = errors.filter((e) => e.type === 'error').length > 0
  return { isValid: !hasErrors, errors }
}

/** Extract referenced variable IDs from code node data */
export function extractCodeVariables(data: CodeNodeData): string[] {
  const uniqueVariables = new Set<string>()

  data.inputs?.forEach((input) => {
    if (input.variableId) {
      uniqueVariables.add(input.variableId)
    }
  })

  return Array.from(uniqueVariables)
}

/**
 * Define output variables for code node.
 *
 * Drift fix (node-catalog Phase 1, plan §6): this used to read
 * `output.type?.type` — an object shape only the legacy `CodeOutput` map ever
 * used — while the output editor writes a plain `BaseType` string, so every
 * output resolved as STRING regardless of what the user picked.
 * `normalizeCodeOutputType` reads the string first and tolerates the legacy
 * object shape. User-visible: code-node outputs now show their configured type
 * in the variable picker.
 */
const getCodeOutputVariables = (data: CodeNodeData, nodeId: string): UnifiedVariable[] => {
  const outputs: UnifiedVariable[] = []

  // Use new outputs format if available
  if (data.outputs && Array.isArray(data.outputs)) {
    data.outputs.forEach((output) => {
      outputs.push(
        createUnifiedOutputVariable({
          nodeId,
          path: output.name,
          type: normalizeCodeOutputType(output.type),
          description: output.description || `Output: ${output.name}`,
        })
      )
    })
  } else {
    // Default output if no outputs defined
    outputs.push(
      createUnifiedOutputVariable({
        nodeId,
        path: 'output1',
        type: BaseType.OBJECT,
        description: 'Result from code execution',
      })
    )
  }

  return outputs
}

/**
 * Code node manifest
 */
export const codeManifest: NodeManifest<CodeNodeData> = {
  id: 'code',
  category: NodeCategory.TRANSFORM,
  displayName: 'Code',
  description: 'Execute custom code to transform data',
  icon: 'code',
  color: '#8B5CF6', // TRANSFORM category color
  defaultData: () => ({
    title: 'Code',
    desc: 'Transform data with code',
    variables: [],
    code_language: 'javascript',
    code: `const main = async () => {
  // You can use input variables here if defined
  return {
    output1: undefined
  }
}`,
    inputs: [],
    outputs: [
      {
        name: 'output1',
        type: BaseType.STRING,
        description: 'First output from the code execution',
      },
    ],
  }),
  configSchema: codeNodeDataSchema as unknown as z.ZodType<CodeNodeData>,
  validate: validateCodeConfig,
  extractVariables: extractCodeVariables,
  resolveOutputs: getCodeOutputVariables,
  connection: {
    canRunSingle: true,
  },
  agent: {
    authorable: true,
    usage:
      'Write `code` defining an async main() that returns an object; declare each returned key in ' +
      '`outputs` with its `name` and `type` (BaseType) so downstream nodes can reference ' +
      '`{{<node>.<name>}}`. Wire upstream values through `inputs` ({ name, variableId }) and read ' +
      'them as variables inside main(). The full result is also exposed as `{{<node>.result}}`.',
    examples: [
      {
        description: 'Compute an order total from an upstream list',
        config: {
          code_language: 'javascript',
          code: 'const main = async () => {\n  return { total: items.reduce((sum, i) => sum + i.price, 0) }\n}',
          inputs: [{ name: 'items', variableId: 'find-1.orders' }],
          outputs: [{ name: 'total', type: 'number', description: 'Sum of order prices' }],
        },
      },
    ],
  },
}
