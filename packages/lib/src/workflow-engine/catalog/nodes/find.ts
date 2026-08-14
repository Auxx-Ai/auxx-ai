// packages/lib/src/workflow-engine/catalog/nodes/find.ts

import { generateId } from '@auxx/utils/generateId'
import { z } from 'zod'
import {
  type Condition,
  type ConditionGroup,
  conditionGroupSchema,
  conditionSchema,
} from '../../../conditions/client'
import { isCustomResourceId } from '../../../resources/client'
import { generateFindNodeVariablesFromFields } from '../../../resources/variable-generators'
import type { UnifiedVariable } from '../../types/unified-variable'
import type { BaseNodeData } from '../node-base'
import type { OutputContext } from '../output-context'
import { resolveResourceGeneratorInputs } from '../resource-meta'
import { NodeCategory, type NodeManifest, type NodeValidationResult } from '../types'
import { extractVarIdsFromString } from '../variable-inference'

/**
 * The find node's catalog manifest — resource-backed, same `resolveOutputs`
 * shape as resource-trigger. `conditions`/`conditionGroups` reuse the shared
 * condition schema (`conditions/client`) instead of re-declaring its shape —
 * the field-level web schema this replaced required `isConstant` on every
 * condition where the shared schema makes it optional, a pure widening (a
 * persisted condition the old schema accepted still parses).
 */

/**
 * Node data for find nodes (flattened structure)
 */
export interface FindNodeData extends BaseNodeData {
  // Find-specific configuration
  resourceType: string // Dynamic selection (contact, ticket, entity_vendors, etc.)
  findMode: 'findOne' | 'findMany'
  conditions: Condition[] // For backward compatibility
  conditionGroups: ConditionGroup[] // Primary grouping system

  // Advanced settings
  orderBy?: {
    field: string
    direction: 'asc' | 'desc'
  }
  limit?: number | string // Can be number (constant) or string (variable reference)

  // Field modes for VarEditor (true = constant mode, false = variable mode)
  fieldModes?: Record<string, boolean>
}

/**
 * Zod schema for validation
 */
export const findNodeDataSchema = z.object({
  // Base properties
  id: z.string(),
  type: z.literal('find'),
  // .default(false) aligns with baseNodeDataSchema — the node factory sets it
  selected: z.boolean().default(false),

  // Config properties
  title: z.string().min(1),
  desc: z.string().optional(),
  description: z.string().optional(),

  // Find configuration
  resourceType: z.string(), // Dynamic resource selection - validated as TableId at runtime
  findMode: z.enum(['findOne', 'findMany']),
  conditions: z.array(conditionSchema),
  conditionGroups: z.array(conditionGroupSchema),

  // Advanced settings
  orderBy: z
    .object({
      field: z.string(),
      direction: z.enum(['asc', 'desc']),
    })
    .optional(),
  limit: z.union([z.number().min(1).max(1000), z.string()]).optional(), // number for constant, string for variable

  // Field modes for VarEditor
  fieldModes: z.record(z.string(), z.boolean()).optional(),

  // Standard properties
  isValid: z.boolean().optional(),
  errors: z.array(z.string()).optional(),
  disabled: z.boolean().optional(),
  outputVariables: z.array(z.string()).optional(),
})

/**
 * Default data creation function
 */
export function createFindNodeDefaultData(): Partial<FindNodeData> {
  return {
    title: 'Find',
    desc: 'Search for records',
    resourceType: 'contact', // Default to contact
    findMode: 'findMany',
    conditions: [], // Keep for backward compatibility
    conditionGroups: [
      {
        id: generateId(),
        conditions: [],
        logicalOperator: 'OR',
        order: 0,
        metadata: { name: 'Group' },
      },
    ],
    orderBy: undefined,
    limit: 10, // Default limit of 10 records
    fieldModes: {
      limit: true, // Default to constant mode
    },
  }
}

/**
 * Validation function following the same pattern as other nodes.
 *
 * Deliberately does **not** check field references. This function only receives
 * `data`, so the only vocabulary available to it is the static
 * `FIND_RESOURCE_CONFIGS[type].filterableFields` — which cannot see the org's
 * `CustomField` rows, and therefore rejects fields the panel itself offers.
 * (A ~180-line commented-out attempt at exactly that lived here until
 * 2026-08-01; it was removed rather than revived, because reviving it would
 * reintroduce a third field vocabulary alongside the panel's merged
 * `fieldDefinitions` and the server's canonicalized refs.)
 *
 * Field validation belongs to `FindProcessor.validateNodeConfig`, which reads
 * the same canonical references the query builders do.
 */
export const validateFindNodeConfig = (data: FindNodeData): NodeValidationResult => {
  const errors: Array<{ field: string; message: string; type?: 'warning' | 'error' }> = []

  // Additional custom validation
  if (!data.title?.trim()) {
    errors.push({ field: 'title', message: 'Title is required', type: 'error' })
  }

  // Check if title is too long
  if (data.title && data.title.length > 100) {
    errors.push({
      field: 'title',
      message: 'Title is too long (max 100 characters)',
      type: 'warning',
    })
  }

  // Validate description length if provided
  if (data.description && data.description.length > 500) {
    errors.push({
      field: 'description',
      message: 'Description is too long (max 500 characters)',
      type: 'warning',
    })
  }

  // Validate resource type
  if (!data.resourceType) {
    errors.push({ field: 'resourceType', message: 'Resource type is required', type: 'error' })
    return { isValid: false, errors }
  }

  // For custom entities, skip static config validation - runtime validation will handle it
  if (isCustomResourceId(data.resourceType)) {
    // Basic validation for custom entities
    const hasConditions =
      (data.conditions && data.conditions.length > 0) ||
      (data.conditionGroups && data.conditionGroups.length > 0)

    if (!hasConditions) {
      errors.push({
        field: 'conditions',
        message:
          'No conditions applied - will return all records (limited by default/specified limit)',
        type: 'warning',
      })
    }

    // Validate limit for findMany. A variable-bound limit is a reference
    // string that only resolves at run time, so there is nothing to check.
    const limit = typeof data.limit === 'number' ? data.limit : Number(data.limit)
    if (data.findMode === 'findMany' && data.limit && !Number.isNaN(limit)) {
      if (limit < 1) {
        errors.push({ field: 'limit', message: 'Limit must be at least 1', type: 'error' })
      } else if (limit > 1000) {
        errors.push({ field: 'limit', message: 'Limit cannot exceed 1000', type: 'error' })
      }
    }

    return { isValid: errors.filter((e) => e.type === 'error').length === 0, errors }
  }

  // Validate limit for findMany. A variable-bound limit is a reference string
  // that only resolves at run time, so there is nothing to check.
  const limit = typeof data.limit === 'number' ? data.limit : Number(data.limit)
  if (data.findMode === 'findMany' && data.limit && !Number.isNaN(limit)) {
    if (limit < 1) {
      errors.push({ field: 'limit', message: 'Limit must be at least 1', type: 'error' })
    } else if (limit > 1000) {
      errors.push({ field: 'limit', message: 'Limit cannot exceed 1000', type: 'error' })
    }
  }

  // Warning if findOne has multiple conditions that might not return expected results
  if (data.findMode === 'findOne' && data.conditions && data.conditions.length > 3) {
    errors.push({
      field: 'conditions',
      message: 'Consider using fewer conditions for findOne mode to ensure predictable results',
      type: 'warning',
    })
  }

  // Warning if no conditions are provided
  const hasConditions =
    (data.conditions && data.conditions.length > 0) ||
    (data.conditionGroups && data.conditionGroups.length > 0)

  if (!hasConditions) {
    errors.push({
      field: 'conditions',
      message:
        'No conditions applied - will return all records (limited by default/specified limit)',
      type: 'warning',
    })
  }

  return { isValid: errors.filter((e) => e.type === 'error').length === 0, errors }
}

/**
 * Extract variables from find node filter conditions
 * Matches backend implementation in packages/lib/src/workflow-engine/nodes/action-nodes/find.ts
 */
export function extractFindVariables(data: Partial<FindNodeData>): string[] {
  const variableIds = new Set<string>()

  // Extract from flat conditions (backward compatibility)
  if (data.conditions && Array.isArray(data.conditions)) {
    data.conditions.forEach((condition: Condition) => {
      // Add variableId if present
      if (condition.variableId) {
        variableIds.add(condition.variableId)
      }

      // Extract from value if it's a string with {{variables}}
      if (condition.value && typeof condition.value === 'string') {
        extractVarIdsFromString(condition.value).forEach((id) => variableIds.add(id))
      }
    })
  }

  // Extract from condition groups
  if (data.conditionGroups && Array.isArray(data.conditionGroups)) {
    data.conditionGroups.forEach((group: ConditionGroup) => {
      group.conditions?.forEach((condition: Condition) => {
        // Add variableId if present
        if (condition.variableId) {
          variableIds.add(condition.variableId)
        }

        // Extract from value if it's a string with {{variables}}
        if (condition.value && typeof condition.value === 'string') {
          extractVarIdsFromString(condition.value).forEach((id) => variableIds.add(id))
        }
      })
    })
  }

  // Extract from limit if it's a string with variable reference
  if (data.limit && typeof data.limit === 'string') {
    extractVarIdsFromString(data.limit).forEach((id) => variableIds.add(id))
  }

  return Array.from(variableIds)
}

/**
 * Generate output variables for find nodes
 * Unified function for both system and custom resources
 *
 * @param data - Find node data
 * @param nodeId - Node ID
 * @param context - Output variable context with resource access
 */
export function getFindNodeOutputVariables(
  data: FindNodeData,
  nodeId: string,
  context: OutputContext
): UnifiedVariable[] {
  const inputs = resolveResourceGeneratorInputs(context)
  // No resource selected yet
  if (!inputs) {
    return []
  }

  return generateFindNodeVariablesFromFields(
    inputs.resource.fields,
    inputs.resourceMeta,
    nodeId,
    data.findMode,
    { resourcesMap: inputs.resourcesMap, maxDepth: 2 }
  )
}

/**
 * Find node manifest
 */
export const findManifest: NodeManifest<FindNodeData> = {
  id: 'find',
  category: NodeCategory.ACTION,
  displayName: 'Find',
  description: 'Search for records with dynamic filters and sorting',
  icon: 'search',
  color: '#10b981', // ACTION category color
  defaultData: createFindNodeDefaultData,
  configSchema: findNodeDataSchema as unknown as z.ZodType<FindNodeData>,
  validate: validateFindNodeConfig,
  extractVariables: extractFindVariables,
  resolveOutputs: getFindNodeOutputVariables,
  connection: {
    canRunSingle: true,
  },
  agent: {
    authorable: true,
    usage:
      '`resourceType` names the record type (system id like `ticket`, or a custom entity ' +
      'EntityDefinition id — resolve it, never guess). `findMode` is `findOne` or `findMany`. ' +
      '`conditionGroups` is the primary filter (groups AND at the top level, conditions inside a ' +
      "group combine via the group's `logicalOperator`); `conditions` is a flat legacy form kept " +
      'for back-compat and ignored when `conditionGroups` is non-empty. `limit` bounds `findMany` ' +
      '(1-1000, or a variable reference).',
    examples: [
      {
        description: 'Find up to 5 open tickets for a contact',
        config: {
          resourceType: 'ticket',
          findMode: 'findMany',
          conditionGroups: [
            {
              id: 'g1',
              logicalOperator: 'AND',
              conditions: [
                { id: 'c1', fieldId: 'ticket:status', operator: 'is', value: 'open' },
                {
                  id: 'c2',
                  fieldId: 'ticket:contact',
                  operator: 'is',
                  value: '{{trigger-1.contact.id}}',
                  isConstant: false,
                },
              ],
            },
          ],
          conditions: [],
          limit: 5,
        },
      },
    ],
  },
}
