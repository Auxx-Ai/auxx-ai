// packages/lib/src/workflow-engine/catalog/nodes/if-else.ts

import { generateId } from '@auxx/utils/generateId'
import { z } from 'zod'
import { ALL_OPERATOR_KEYS, type Operator } from '../../../conditions/client'
import { BaseType } from '../../core/types'
import type { BaseNodeData } from '../node-base'
import {
  type NodeBranch,
  NodeCategory,
  type NodeManifest,
  type NodeValidationResult,
} from '../types'
import { createUnifiedOutputVariable } from '../variable-conversion'
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
  // `_targetBranches` is DERIVED state — see catalog/derived-keys.ts.

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
 *
 * TOTAL — never throws. It used to throw `if-else node branch number must than
 * 2` for fewer than two branches, which is exactly what a `cases: []` config
 * produces (the manifest appends only the reserved ELSE). Both production call
 * sites read it from a READ path (`validateGraphStructure`, which `readDraft`
 * runs, and `resolveConnectionSpec`), so a config-shape mistake 500'd
 * `get_workflow`, `get_node`, `validate_workflow` and every mutation at once —
 * the agent could not even read the workflow to see what it had done
 * (plan 21 §2.5). A degenerate config now degrades to the branches it can
 * name; the validator is what reports it.
 */
export const branchNameCorrect = <T extends { id: string; name: string }>(branches: T[]): T[] => {
  if (branches.length < 3) {
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
  const errors: NodeValidationResult['errors'] = []

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
  const seenCaseIds = new Set<string>()
  dataToValidate.cases?.forEach((caseItem: any, index: number) => {
    const caseId = typeof caseItem.case_id === 'string' ? caseItem.case_id.trim() : ''
    if (!caseId) {
      errors.push({
        field: `cases.${index}.case_id`,
        message: 'Case ID is required',
        type: 'error',
      })
    } else if (caseId === 'false') {
      // `false` is the reserved ELSE handle this node ALWAYS appends. A case
      // claiming it does not create a second branch — it collapses into ELSE
      // (`WorkflowGraphBuilder.getNodeHandles` sets one Map entry per case_id
      // and then unconditionally sets `false`), so at run time a matched case
      // and a nothing-matched fall-through leave on the SAME edge with nothing
      // distinguishing them. That is a silent mis-route, which is why this
      // blocks authoring rather than merely warning (plan 21 §2.3/§2.4: the
      // logged turn wrote `case_id: 'false'` because the old usage string read
      // as an instruction to).
      errors.push({
        field: `cases.${index}.case_id`,
        message:
          `case_id "false" is not allowed — "false" is the reserved ELSE handle this node ` +
          `always exposes. Name the case for what it matches instead (e.g. "carrier-ups").`,
        type: 'error',
        blocksAuthoring: true,
      })
    } else if (seenCaseIds.has(caseId)) {
      // Duplicate ids are *members* of the allowed handle set, so the
      // structural handle check passes them; the collision only shows up at
      // run time as two cases sharing one edge.
      errors.push({
        field: `cases.${index}.case_id`,
        message:
          `Duplicate case_id "${caseId}" — every case needs its own id, because case_id IS ` +
          `the branch handle edges leave on. Two cases sharing one id share one branch.`,
        type: 'error',
        blocksAuthoring: true,
      })
    }
    if (caseId) seenCaseIds.add(caseId)

    if (!caseItem.conditions || caseItem.conditions.length === 0) {
      errors.push({
        field: `cases.${index}.conditions`,
        message: 'At least one condition is required',
        type: 'error',
      })
    }

    // Validate conditions
    caseItem.conditions?.forEach((condition: any, condIndex: number) => {
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

/**
 * Strip one surrounding `{{ }}` from a condition's `variableId`.
 *
 * `variableId` is a BARE dotted path — the only such field in the whole builder
 * vocabulary, where every other reference is `{{Title.path}}`. An author who
 * writes the form they were taught everywhere else used to get a quadruple-brace
 * error naming neither the field nor the rule (plan 21 §3.4), so the braced form
 * is accepted here and unwrapped. The graph-edit normalizer does the same on the
 * WRITE path and reports a warning; this is the read-side net under graphs that
 * never went through it (templates, hand-written `replace_graph` payloads).
 */
export function unwrapBracedVariableId(variableId: string): string {
  const match = /^\s*\{\{\s*([^{}]+?)\s*\}\}\s*$/.exec(variableId)
  return match?.[1] ?? variableId
}

export function extractIfElseVariableIds(data: IfElseNodeData): string[] {
  const uniqueVariableIds = new Set<string>()

  // Support both old config format and new flattened format
  const dataToUse = 'config' in data ? (data as any).config : data

  // Extract from all conditions in all cases
  dataToUse.cases?.forEach((caseItem: any) => {
    caseItem.conditions?.forEach((condition: any) => {
      // Add variable ID from condition
      if (typeof condition.variableId === 'string' && condition.variableId) {
        uniqueVariableIds.add(unwrapBracedVariableId(condition.variableId))
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
 * Define output variables for if-else node
 */
function getIfElseOutputVariables(_data: IfElseNodeData, nodeId: string): any[] {
  return [
    createUnifiedOutputVariable({
      nodeId,
      path: 'matched_condition',
      type: BaseType.STRING,
      description: 'Which condition was matched (case ID)',
    }),
    createUnifiedOutputVariable({
      nodeId,
      path: 'condition_index',
      type: BaseType.NUMBER,
      description: 'Index of the matched condition (0-based)',
    }),
    createUnifiedOutputVariable({
      nodeId,
      path: 'branch_taken',
      type: BaseType.STRING,
      description: 'Which branch was taken (true/false)',
      enum: ['true', 'false'],
    }),
  ]
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
  // `list_node_types` is a substring search, and none of the words a model
  // actually reaches for hit `if-else` / `IF/ELSE` / `condition`. A logged turn
  // burned four iterations on "condition if else branch", "flow_control" and
  // "if" before finding this type (plan 21 §3.3).
  synonyms: ['if else', 'switch', 'branch', 'route', 'routing', 'conditional', 'case', 'else'],
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
  resolveOutputs: getIfElseOutputVariables,
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
      'Each entry in `cases` is one branch, and `case_id` IS that branch\u2019s address: it is the ' +
      'edge handle, it is what you pass as `branch` to `connect_nodes`/`add_node`, and because ' +
      'YOU author it you already know it before the node exists \u2014 so you can create the node and ' +
      'wire its branches in the same batch. Name each case for what it matches ' +
      '(e.g. "carrier-fedex", "priority-high"), never "true"/"false". Every `case_id` must be ' +
      'UNIQUE, and none may be "false": this node ALWAYS exposes a reserved "false" ELSE branch ' +
      'for "nothing matched", and a case claiming that id collapses into it, so a matched case ' +
      'and a fall-through leave on the same edge. Conditions inside a case join via ' +
      '`logical_operator`. Every condition reads a `variableId` \u2014 a BARE dotted path such as ' +
      '"Check Order.record.carrier", the one field in this vocabulary that is NOT wrapped in ' +
      '{{\u2026}} \u2014 with a `comparison_operator` from the shared operator registry.',
    examples: [
      {
        description: 'Route by carrier — one case per carrier, ELSE catches the rest',
        config: {
          cases: [
            {
              id: 'c1',
              case_id: 'carrier-fedex',
              logical_operator: 'and',
              conditions: [
                {
                  id: 'cond1',
                  variableId: 'Carrier.value',
                  comparison_operator: 'is',
                  value: 'fedex',
                },
              ],
            },
            {
              id: 'c2',
              case_id: 'carrier-ups',
              logical_operator: 'and',
              conditions: [
                {
                  id: 'cond2',
                  variableId: 'Carrier.value',
                  comparison_operator: 'is',
                  value: 'ups',
                },
              ],
            },
          ],
        },
      },
      {
        description: 'Single condition — wire the match on "priority-high", the rest on "false"',
        config: {
          cases: [
            {
              id: 'c1',
              case_id: 'priority-high',
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
