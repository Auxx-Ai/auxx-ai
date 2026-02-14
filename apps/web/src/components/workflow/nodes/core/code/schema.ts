// apps/web/src/components/workflow/nodes/core/code/schema.ts

import { z } from 'zod'
import {
  BaseType,
  NodeCategory,
  type NodeDefinition,
  NodeType,
  type UnifiedVariable,
  type ValidationResult,
} from '~/components/workflow/types'
import { createUnifiedOutputVariable } from '~/components/workflow/utils/variable-conversion'
import { CodePanel } from './panel'
import type { CodeNodeData } from './types'

/**
 * Zod schema for code configuration
 * @deprecated Use codeNodeDataSchema instead
 */
export const codeSchema = z.object({
  title: z.string().min(1),
  desc: z.string().optional(),
  // variables: z
  //   .array(z.object({ variable: z.string(), value_selector: z.array(z.string()) }))
  //   .default([]),
  code_language: z.enum(['javascript', 'python3']).default('javascript'),
  code: z.string(),
  inputs: z.array(z.object({ name: z.string(), variableId: z.string() })).optional(),
  outputs: z
    .array(z.object({ name: z.string(), type: z.any(), description: z.string().optional() }))
    .optional(),
  // legacyOutputs: z.record(z.string(), z.any()).optional(),
})

/**
 * Zod schema for code node data (flattened structure)
 */
export const codeNodeDataSchema = z.object({
  // Base node properties
  id: z.string(),
  type: z.literal(NodeType.CODE),
  selected: z.boolean(),

  // Flattened config properties
  title: z.string().min(1),
  desc: z.string().optional(),
  code_language: z.enum(['javascript', 'python3']).default('javascript'),
  code: z.string(),
  inputs: z.array(z.object({ name: z.string(), variableId: z.string() })).optional(),
  outputs: z
    .array(z.object({ name: z.string(), type: z.any(), description: z.string().optional() }))
    .optional(),
  // legacyOutputs: z.record(z.string(), z.any()).optional(),

  // Other node data properties
  isValid: z.boolean().optional(),
  errors: z.array(z.string()).optional(),
  disabled: z.boolean().optional(),
  outputVariables: z.array(z.string()).optional(),
})

/**
 * Default data for new code nodes (flattened)
 */
export const codeDefaultData: Partial<CodeNodeData> = {
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
    { name: 'output1', type: BaseType.STRING, description: 'First output from the code execution' },
  ],
}

/**
 * Validation function for code configuration
 */
export const validateCodeConfig = (data: CodeNodeData): ValidationResult => {
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
      if (data.code && data.code.includes('eval(')) {
        errors.push({
          field: 'code',
          message: 'Using eval() is potentially unsafe and should be avoided',
          type: 'warning',
        })
      }

      if (data.code && data.code.includes('innerHTML')) {
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

/**
 * Define output variables for code node
 */
const getCodeOutputVariables = (data: CodeNodeData, nodeId: string): UnifiedVariable[] => {
  const outputs: UnifiedVariable[] = []

  // Use new outputs format if available
  if (data.outputs && Array.isArray(data.outputs)) {
    data.outputs.forEach((output: any) => {
      const baseType = (output.type?.type as BaseType) || BaseType.STRING

      outputs.push(
        createUnifiedOutputVariable({
          nodeId,
          path: output.name, // Changed from 'name' to 'path'
          type: baseType,
          description: output.description || `Output: ${output.name}`,
        })
      )
    })
  } else {
    // Default output if no outputs defined
    outputs.push(
      createUnifiedOutputVariable({
        nodeId,
        path: 'output1', // Changed from 'name' to 'path'
        type: BaseType.OBJECT,
        description: 'Result from code execution',
      })
    )
  }

  return outputs
}

export function extractCodeVariables(data: CodeNodeData): string[] {
  const uniqueVariables = new Set<string>()

  data.inputs?.forEach((input: any) => {
    if (input.variableId) {
      uniqueVariables.add(input.variableId)
    }
  })

  return Array.from(uniqueVariables)
}

/**
 * Node definition for code
 */
export const codeDefinition: NodeDefinition<CodeNodeData> = {
  id: NodeType.CODE,
  category: NodeCategory.TRANSFORM,
  displayName: 'Code',
  description: 'Execute custom code to transform data',
  icon: 'code',
  color: '#8B5CF6', // TRANSFORM category color
  defaultData: codeDefaultData,
  schema: codeNodeDataSchema,
  panel: CodePanel,
  validator: validateCodeConfig as any,
  canRunSingle: true,
  extractVariables: extractCodeVariables as any,
  outputVariables: getCodeOutputVariables as any,
}
