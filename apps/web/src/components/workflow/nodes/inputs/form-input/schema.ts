// apps/web/src/components/workflow/nodes/inputs/form-input/schema.ts

import { z } from 'zod'
import {
  type NodeDefinition,
  NodeCategory,
  type ValidationResult,
} from '~/components/workflow/types'
import { type FormInputNodeData } from './types'
import { baseNodeDataSchema } from '~/components/workflow/types/node-base'
import { FormInputPanel } from './panel'
import { NodeType } from '~/components/workflow/types/node-types'
import { getFormInputOutputVariables } from './output-variables'
import { BaseType } from '~/components/workflow/types/unified-types'
import { VAR_TYPE_ICON_MAP } from '~/components/workflow/utils/icon-helper'

/**
 * Zod schema for enum option
 */
const enumOptionSchema = z.object({
  label: z.string(),
  value: z.string(),
})

/**
 * Zod schema for type options
 */
const typeOptionsSchema = z
  .object({
    enum: z.array(enumOptionSchema).optional(),
    file: z
      .object({
        allowMultiple: z.boolean(),
        maxFiles: z.number().optional(),
        maxFileSize: z.number().optional(),
        allowedTypes: z.array(z.string()).optional(),
      })
      .optional(),
    currency: z
      .object({
        currencyCode: z.string(),
        decimalPlaces: z.enum(['two-places', 'no-decimal']),
        displayType: z.enum(['symbol', 'name', 'code']),
        groups: z.enum(['default', 'no-groups']),
      })
      .optional(),
    address: z
      .object({
        components: z.array(z.string()),
      })
      .optional(),
    boolean: z
      .object({
        variant: z.enum(['switch', 'button-group']).optional(),
      })
      .optional(),
  })
  .optional()

/**
 * Zod schema for form-input node data
 */
export const formInputNodeDataSchema = baseNodeDataSchema.extend({
  label: z.string().min(1, 'Label is required'),
  inputType: z.nativeEnum(BaseType).default(BaseType.STRING),
  placeholder: z.string().optional(),
  required: z.boolean().default(false),
  defaultValue: z.any().optional(),
  hint: z.string().max(500, 'Hint must be 500 characters or less').optional(),
  typeOptions: typeOptionsSchema,
})

/**
 * Create default data for form-input node
 */
export const createFormInputDefaultData = (): Partial<FormInputNodeData> => ({
  title: 'Form Input',
  desc: 'Collect input from user',
  label: '',
  inputType: BaseType.STRING,
  placeholder: '',
  required: false,
})

export const formInputDefaultData = createFormInputDefaultData()

/**
 * Validate form-input node data
 */
export function validateFormInputData(data: FormInputNodeData): ValidationResult {
  const errors: Array<{ field: string; message: string; type?: 'warning' | 'error' }> = []

  if (!data.label?.trim()) {
    errors.push({ field: 'label', message: 'Label is required', type: 'error' })
  }

  // Type-specific validation
  const inputType = data.inputType || BaseType.STRING

  if (inputType === BaseType.ENUM) {
    if (!data.typeOptions?.enum?.length) {
      errors.push({
        field: 'typeOptions.enum',
        message: 'At least one option is required',
        type: 'warning',
      })
    }
  }

  return {
    isValid: errors.filter((e) => e.type === 'error').length === 0,
    errors,
  }
}

/**
 * Form Input node definition
 */
export const formInputDefinition: NodeDefinition<FormInputNodeData> = {
  id: NodeType.FORM_INPUT,
  category: NodeCategory.INPUT,
  displayName: 'Form Input',
  description: 'Collect input from user (text, number, date, file, etc.)',
  icon: 'text-cursor-input',
  getIcon: (data: FormInputNodeData) => {
    const inputType = data.inputType || BaseType.STRING
    return VAR_TYPE_ICON_MAP[inputType] || 'text-cursor-input'
  },
  color: '#22C55E',
  schema: formInputNodeDataSchema,
  defaultData: formInputDefaultData,
  canRunSingle: false,
  panel: FormInputPanel,
  validator: validateFormInputData,
  outputVariables: getFormInputOutputVariables as any,
}
