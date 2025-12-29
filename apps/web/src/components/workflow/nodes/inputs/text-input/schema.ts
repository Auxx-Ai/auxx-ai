// apps/web/src/components/workflow/nodes/inputs/text-input/schema.ts

import { z } from 'zod'
import {
  type NodeDefinition,
  NodeCategory,
  type ValidationResult,
} from '~/components/workflow/types'
import { type TextInputNodeData } from './types'
import { baseNodeDataSchema } from '~/components/workflow/types/node-base'
import { TextInputPanel } from './panel'
import { NodeType } from '~/components/workflow/types/node-types'
import { type UnifiedVariable, BaseType } from '~/components/workflow/types/variable-types'
import { createUnifiedOutputVariable } from '~/components/workflow/utils/variable-conversion'

/**
 * Zod schema for text input node data
 */
export const textInputNodeDataSchema = baseNodeDataSchema.extend({
  label: z.string().min(1, 'Label is required'),
  placeholder: z.string().optional(),
  required: z.boolean().default(false),
  defaultValue: z.string().optional(),
})

/**
 * Create default data for text input node
 */
export const createTextInputDefaultData = (): Partial<TextInputNodeData> => ({
  title: 'Text Input',
  desc: 'Collect text input from user',
  label: 'Enter text',
  placeholder: '',
  required: false,
  defaultValue: '',
})

export const textInputDefaultData = createTextInputDefaultData()

/**
 * Validate text input node data
 */
export function validateTextInputData(data: TextInputNodeData): ValidationResult {
  try {
    textInputNodeDataSchema.parse(data)

    const errors: Array<{ field: string; message: string; type?: 'warning' | 'error' }> = []

    if (!data.label?.trim()) {
      errors.push({ field: 'label', message: 'Label is required', type: 'error' })
    }

    return { isValid: errors.length === 0, errors }
  } catch (error) {
    console.error('Text input validation error:', error)
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
 * Define output variables for text input node
 */
function getTextInputOutputVariables(data: TextInputNodeData, nodeId: string): UnifiedVariable[] {
  const variables: UnifiedVariable[] = []

  // Text value output
  variables.push(
    createUnifiedOutputVariable({
      nodeId,
      path: 'value', // Changed from 'name' to 'path'
      type: BaseType.STRING,
      description: `Text input value for "${data.label}"`,
    })
  )

  // Label for reference
  variables.push(
    createUnifiedOutputVariable({
      nodeId,
      path: 'label', // Changed from 'name' to 'path'
      type: BaseType.STRING,
      description: 'The label of this input field',
    })
  )

  return variables
}

/**
 * Text input node definition
 */
export const textInputDefinition: NodeDefinition<TextInputNodeData> = {
  id: NodeType.TEXT_INPUT,
  category: NodeCategory.INPUT,
  displayName: 'Text Input',
  description: 'Collect text input from user',
  icon: 'type',
  color: '#22C55E',
  schema: textInputNodeDataSchema,
  defaultData: textInputDefaultData,
  canRunSingle: false, // Input nodes don't run individually
  panel: TextInputPanel,
  validator: validateTextInputData,
  outputVariables: getTextInputOutputVariables as any,
  // Removed availableNextNodes and availablePrevNodes - let INPUT category logic handle connections
}
