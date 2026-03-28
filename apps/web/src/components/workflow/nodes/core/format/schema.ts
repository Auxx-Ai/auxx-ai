// apps/web/src/components/workflow/nodes/core/format/schema.ts

import { DEFAULT_OPERATION, FormatOperation } from '@auxx/lib/workflow-engine/constants'
import { z } from 'zod'
import { NodeCategory, type NodeDefinition, NodeType } from '~/components/workflow/types'
import type { ValidationResult } from '~/components/workflow/types/registry'
import { extractFormatVariables } from './extract-variables'
import { computeFormatOutputVariables } from './output-variables'
import type { FormatNodeData } from './types'

/** Zod schema for format node validation */
export const formatNodeSchema = z.object({
  title: z.string().min(1, 'Title is required'),
  desc: z.string().optional(),
  operation: z.nativeEnum(FormatOperation),
  input: z.string().optional(),
})

/** Factory function for default data */
export function createFormatDefaultData(): Partial<FormatNodeData> {
  return {
    title: 'Format',
    desc: 'Format and transform text',
    operation: DEFAULT_OPERATION,
    input: '',
  }
}

/** Validator */
function validateFormatNodeData(data: FormatNodeData): ValidationResult {
  const errors: Array<{ field: string; message: string; type?: 'warning' | 'error' }> = []

  if (!data.operation) {
    errors.push({ field: 'operation', message: 'Operation is required', type: 'error' })
  }

  // Operation-specific validation
  switch (data.operation) {
    case FormatOperation.REPLACE:
      if (!data.replaceConfig?.find) {
        errors.push({
          field: 'replaceConfig.find',
          message: 'Find text is required',
          type: 'warning',
        })
      }
      break
    case FormatOperation.REPLACE_REGEX:
      if (!data.replaceRegexConfig?.pattern) {
        errors.push({
          field: 'replaceRegexConfig.pattern',
          message: 'Regex pattern is required',
          type: 'warning',
        })
      }
      break
    case FormatOperation.REMOVE:
      if (!data.removeConfig?.find) {
        errors.push({
          field: 'removeConfig.find',
          message: 'Find text is required',
          type: 'warning',
        })
      }
      break
    case FormatOperation.REGEX_MATCH:
      if (!data.regexMatchConfig?.pattern) {
        errors.push({
          field: 'regexMatchConfig.pattern',
          message: 'Regex pattern is required',
          type: 'warning',
        })
      }
      break
  }

  return { isValid: errors.filter((e) => e.type === 'error').length === 0, errors }
}

/** Node definition */
export const formatNodeDefinition: NodeDefinition<FormatNodeData> = {
  id: NodeType.FORMAT,
  category: NodeCategory.UTILITY,
  displayName: 'Format',
  description: 'Format and transform text, numbers, and encodings',
  icon: 'text-cursor-input',
  color: '#3B82F6',
  defaultData: createFormatDefaultData(),
  schema: formatNodeSchema,
  validator: validateFormatNodeData,
  canRunSingle: true,
  extractVariables: extractFormatVariables,
  outputVariables: computeFormatOutputVariables,
}
