// packages/lib/src/workflow-engine/catalog/nodes/if-else.ts

import { generateId } from '@auxx/utils/generateId'
import { z } from 'zod'
import { ALL_OPERATOR_KEYS, type Operator } from '../../../conditions/client'
import type { BaseNodeData, TargetBranch } from '../node-base'
import {
  type NodeBranch,
  NodeCategory,
  type NodeManifest,
  type NodeValidationResult,
} from '../types'
import { extractVarIdsFromString } from '../variable-inference'

/**
 * Condition for if-else nodes.
 * `value` admits any JSON shape — the builder's rich editor persists a Tiptap
 * doc (an object) for variable-bearing values; apps/web narrows that member to
 * its `TiptapJSON` type.
 */
export interface NodeCondition {
  id: string
  /** Variable this condition reads. Empty until the user picks one. */
  variableId?: string
  comparison_operator?: Operator
  value?: string | number | boolean | any[] | Record<string, any>
  /** Whether the right-hand value is a literal rather than a variable reference */
  isConstant?: boolean
  /** Sub-key inside a structured variable (e.g. an address part) */
  key?: string
  /** Declared value type — drives which value editor is rendered (BaseType) */
  varType?: string
  /** How this condition joins the previous one inside its case */
  logical_operator?: 'and' | 'or'
}

// Extended condition interface for if-else nodes
export interface IfElseCondition extends Omit<NodeCondition, 'value'> {
  file_var?: any
  conditions?: IfElseCondition[]
  value?: string | number | boolean | string[] | Record<string, any>
}

/**
 * Case definition for if-else nodes
 */
export interface NodeCase {
  id: string
  case_id: string
  logical_operator: 'and' | 'or'
  conditions: IfElseCondition[]
}

/**
 * Node data for if-else nodes (flattened structure)
 */
export interface IfElseNodeData extends BaseNodeData {
  cases: NodeCase[]
  _targetBranches?: TargetBranch[]
}

/**
 * Zod schema for if-else condition
 */
const conditionSchema = z.object({
  id: z.string(),
  variableId: z.string(), // Use variableId for internal reference
  comparison_operator: z.enum(ALL_OPERATOR_KEYS as unknown as [string, ...string[]]).optional(),
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
 * Zod schema for if-else node data (flattened structure)
 */
export const ifElseNodeDataSchema = z.object({
  // Base node properties
  id: z.string(),
  type: z.literal('if-else'),
  // .default(false) aligns with baseNodeDataSchema — the node factory sets it
  selected: z.boolean().default(false),

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
 * Assigns display names to a node's outgoing branches.
 *
 * Two branches read as IF/ELSE; three or more read as CASE n/ELSE. The `false`
 * branch is always the ELSE. Generic over the branch shape so callers that carry
 * extra fields (e.g. `type`) keep them on the result.
 * (Relocated from apps/web utils/branch-name-correct.ts, which re-exports it.)
 */
export const branchNameCorrect = <T extends { id: string; name: string }>(branches: T[]): T[] => {
  const branchLength = branches.length
  if (branchLength < 2) throw new Error('if-else node branch number must than 2')

  if (branchLength === 2) {
    return branches.map((branch) => {
      return { ...branch, name: branch.id === 'false' ? 'ELSE' : 'IF' }
    })
  }

  return branches.map((branch, index) => {
    return { ...branch, name: branch.id === 'false' ? 'ELSE' : `CASE ${index + 1}` }
  })
}

/**
 * Validation function for if-else configuration
 */
export const validateIfElseConfig = (data: IfElseNodeData): NodeValidationResult => {
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

export function extractIfElseVariableIds(data: IfElseNodeData): string[] {
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
 * If-else node manifest
 */
export const ifElseManifest: NodeManifest<IfElseNodeData> = {
  id: 'if-else',
  category: NodeCategory.CONDITION,
  displayName: 'IF/ELSE',
  description: 'Branch workflow based on conditions',
  icon: 'git-branch',
  color: '#f59e0b', // CONDITION category color
  defaultData: () => ({
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
  }),
  configSchema: ifElseNodeDataSchema as unknown as z.ZodType<IfElseNodeData>,
  validate: validateIfElseConfig,
  extractVariables: extractIfElseVariableIds,
  connection: {
    canRunSingle: true,
    /**
     * One branch per case (edge sourceHandle = the case's `case_id`) plus the
     * reserved `false` ELSE branch. Mirrors the IF_ELSE arm of the canvas's
     * `calculateTargetBranches` (workflow-initializer.ts), which stays the
     * derived-state writer until the remaining branch-deriving types
     * (text-classifier, http, crud) migrate and both converge here.
     */
    branches: (config): NodeBranch[] =>
      branchNameCorrect([
        ...(config.cases || []).map((c) => ({ id: c.case_id, name: '' })),
        { id: 'false', name: '' },
      ]).map((b) => ({ ...b, kind: 'default' as const })),
  },
  agent: {
    authorable: true,
    usage:
      'Each entry in `cases` is one branch: `case_id` is the edge handle, conditions join via ' +
      '`logical_operator`. Every condition reads a `variableId` (bare dotted path) with a ' +
      '`comparison_operator` from the shared operator registry. The ELSE branch handle is ' +
      "always 'false'. Wire edges by branch id.",
    examples: [
      {
        description: 'Branch on a high-priority ticket',
        config: {
          cases: [
            {
              id: 'c1',
              case_id: 'true',
              logical_operator: 'and',
              conditions: [
                {
                  id: 'cond1',
                  variableId: 'trigger-1.ticket.priority',
                  comparison_operator: 'is',
                  value: 'high',
                },
              ],
            },
          ],
        },
      },
    ],
  },
}
