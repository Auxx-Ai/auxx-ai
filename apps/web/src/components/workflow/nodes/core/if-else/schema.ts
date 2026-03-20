// apps/web/src/components/workflow/nodes/core/if-else/schema.ts

import { ALL_OPERATOR_KEYS } from '@auxx/lib/conditions/client'
import { generateId } from '@auxx/utils/generateId'
import { z } from 'zod'
import {
  BaseType,
  NodeCategory,
  type NodeDefinition,
  NodeType,
  type ValidationResult,
} from '~/components/workflow/types'
import { extractVarIdsFromString } from '~/components/workflow/ui/input-editor/tiptap-converters'
import { createUnifiedOutputVariable } from '../../../utils/variable-conversion'
import type { IfElseNodeData } from './types'

/**
 * Zod schema for if-else condition
 */
const conditionSchema = z.object({
  id: z.string(),
  variableId: z.string(), // Use variableId for internal reference
  comparison_operator: z.enum(ALL_OPERATOR_KEYS as [string, ...string[]]).optional(),
  value: z
    .union([z.string(), z.number(), z.boolean(), z.array(z.any()), z.record(z.string(), z.any())])
    .optional(),
})

/**
 * Zod schema for if-else case
 */
const caseSchema = z.object({
  id: z.string(),
  case_id: z.string(),
  logical_operator: z.enum(['and', 'or']),
  conditions: z.array(conditionSchema),
})

/**
 * Main schema for if-else configuration
 * @deprecated Use ifElseNodeDataSchema instead
 */
export const ifElseSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  cases: z.array(caseSchema).min(1),
  _targetBranches: z
    .array(
      z.object({
        id: z.string(),
        name: z.string(),
        type: z.enum(['default', 'fail']).default('default'),
      })
    )
    .optional(),
})

/**
 * Zod schema for if-else node data (flattened structure)
 */
export const ifElseNodeDataSchema = z.object({
  // Base node properties
  id: z.string(),
  type: z.literal(NodeType.IF_ELSE),
  selected: z.boolean(),

  // Flattened config properties
  title: z.string().min(1),
  desc: z.string().optional(),
  cases: z.array(caseSchema).min(1),
  _targetBranches: z
    .array(
      z.object({
        id: z.string(),
        name: z.string(),
        type: z.enum(['default', 'fail']).default('default'),
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
 * Default data for new if-else nodes (flattened)
 */
export const ifElseDefaultData: Partial<IfElseNodeData> = {
  title: 'IF/ELSE',
  desc: 'Branch based on conditions',
  cases: [
    {
      id: generateId(),
      case_id: 'true',
      logical_operator: 'and',
      conditions: [],
    },
  ],
  _targetBranches: [
    { id: 'true', name: 'IF', type: 'default' },
    { id: 'false', name: 'ELSE', type: 'default' },
  ],
}

/**
 * Validation function for if-else configuration
 */
export const validateIfElseConfig = (data: IfElseNodeData): ValidationResult => {
  const errors: Array<{ field: string; message: string; type?: 'warning' | 'error' }> = []

  // Support both old config format and new flattened format
  const dataToValidate = 'config' in data ? (data as any).config : data

  // Validate title
  if (!dataToValidate.title?.trim()) {
    errors.push({ field: 'title', message: 'Title is required', type: 'error' })
  }

  // Validate cases
  if (!dataToValidate.cases || dataToValidate.cases.length === 0) {
    errors.push({ field: 'cases', message: 'At least one case is required', type: 'error' })
  }

  // Validate each case
  dataToValidate.cases?.forEach((caseItem: any, index: number) => {
    if (!caseItem.case_id?.trim()) {
      errors.push({
        field: `cases.${index}.case_id`,
        message: 'Case ID is required',
        type: 'error',
      })
    }

    if (caseItem.conditions.length === 0) {
      errors.push({
        field: `cases.${index}.conditions`,
        message: 'At least one condition is required',
        type: 'error',
      })
    }

    // Validate conditions
    caseItem.conditions.forEach((condition: any, condIndex: number) => {
      if (!condition.variableId) {
        errors.push({
          field: `cases.${index}.conditions.${condIndex}.variable_selector`,
          message: 'Variable selector is required',
        })
      }

      if (!condition.comparison_operator) {
        errors.push({
          field: `cases.${index}.conditions.${condIndex}.comparison_operator`,
          message: 'Comparison operator is required',
        })
      }
    })
  })

  // Add warning for missing else branch description
  if (!dataToValidate.desc?.trim()) {
    errors.push({
      field: 'desc',
      message: 'Consider adding a description for better documentation',
      type: 'warning',
    })
  }

  return { isValid: errors.filter((e) => e.type === 'error').length === 0, errors }
}

function extractIfElseVariableIds(data: IfElseNodeData): string[] {
  const uniqueVariableIds = new Set<string>()

  // Support both old config format and new flattened format
  const dataToUse = 'config' in data ? (data as any).config : data

  // Extract from all conditions in all cases
  dataToUse.cases?.forEach((caseItem: any) => {
    caseItem.conditions?.forEach((condition: any) => {
      // Add variable ID from condition
      if (condition.variableId) {
        uniqueVariableIds.add(condition.variableId)
      }
      // Extract variable IDs from condition.value editor content
      if (condition.value) {
        extractVarIdsFromString(condition.value).forEach((id) => {
          uniqueVariableIds.add(id)
        })
      }
    })
  })
  return Array.from(uniqueVariableIds)
}

/**
 * Node definition for if-else
 */
export const ifElseDefinition: NodeDefinition<IfElseNodeData> = {
  id: NodeType.IF_ELSE,
  category: NodeCategory.CONDITION,
  displayName: 'IF/ELSE',
  description: 'Branch workflow based on conditions',
  icon: 'git-branch',
  color: '#f59e0b', // CONDITION category color
  defaultData: ifElseDefaultData,
  schema: ifElseNodeDataSchema,
  validator: validateIfElseConfig as any,
  canRunSingle: true,
  extractVariables: extractIfElseVariableIds as any,
  outputVariables: getIfElseOutputVariables as any,
}

/**
 * Define output variables for if-else node
 */
function getIfElseOutputVariables(data: IfElseNodeData, nodeId: string): any[] {
  return [
    createUnifiedOutputVariable({
      nodeId,
      path: 'matched_condition', // Changed from 'name' to 'path'
      type: BaseType.STRING,
      description: 'Which condition was matched (case ID)',
    }),
    createUnifiedOutputVariable({
      nodeId,
      path: 'condition_index', // Changed from 'name' to 'path'
      type: BaseType.NUMBER,
      description: 'Index of the matched condition (0-based)',
    }),
    createUnifiedOutputVariable({
      nodeId,
      path: 'branch_taken', // Changed from 'name' to 'path'
      type: BaseType.STRING,
      description: 'Which branch was taken (true/false)',
      enum: ['true', 'false'],
    }),
  ]
}
