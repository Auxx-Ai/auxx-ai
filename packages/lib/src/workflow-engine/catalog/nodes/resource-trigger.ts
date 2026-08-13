// packages/lib/src/workflow-engine/catalog/nodes/resource-trigger.ts

import { z } from 'zod'
import {
  type ConditionGroup,
  conditionGroupsSchema,
  isKnownOperator,
  operatorRequiresValue,
} from '../../../conditions/client'
import { WorkflowTriggerType } from '../../core/types'
import type { BaseNodeData } from '../node-base'
import { NodeCategory, type NodeManifest, type NodeValidationResult } from '../types'

/**
 * The resource-trigger node's catalog manifest.
 *
 * Drift fixed during the move (plan §6): `resourceTriggerNodeDataSchema`
 * required `entityDefinitionId` (`.min(1)`) while
 * `createResourceTriggerDefaultData()` never sets it — the defaults failed
 * their own schema. Never bit in the builder because the panel backfills the
 * id on mount, so it would have bitten exactly (and only) a server-side
 * author. The schema now admits the pre-backfill draft state; the trigger
 * columns derivation (`derive-trigger.ts`) already requires BOTH `operation`
 * and `entityDefinitionId` before it sets anything.
 */

/**
 * Node data for resource trigger nodes (flattened structure)
 */
export interface ResourceTriggerData extends BaseNodeData {
  // Resource trigger configuration
  resourceType: string // Resource ID for display (e.g., 'contact', 'ticket', 'entity_vendors')
  /**
   * Actual entity definition ID: 'contact', 'ticket', 'clq1abc123'.
   * Absent on a freshly added node until the panel backfills it on mount —
   * apps/web narrows this to required (its post-backfill view).
   */
  entityDefinitionId?: string
  operation: 'created' | 'updated' | 'deleted' | 'manual'

  variables?: any[]

  /**
   * Trigger filter — the gate that decides whether the workflow runs at all.
   *
   * Groups are AND'd; conditions inside a group combine by the group's
   * `logicalOperator`. An empty/absent filter means "fire on every record".
   *
   * Read by `resource-trigger-base.ts`, which evaluates it with the shared
   * `evaluateConditionsWithDiagnostics` and REFUSES to fire when any condition
   * does not evaluate as written. Values are constants only — a trigger fires
   * before any node has run, so there is no workflow variable to reference.
   */
  filters?: ConditionGroup[]
}

/**
 * Zod schema for validation
 */
export const resourceTriggerNodeDataSchema = z.object({
  // Base node properties
  id: z.string(),
  type: z.literal('resource-trigger'),
  // .default(false) aligns with baseNodeDataSchema — the node factory sets it
  selected: z.boolean().default(false),

  // Resource trigger configuration
  resourceType: z.string().min(1, 'Resource type is required'),
  // Pre-backfill draft state is a node without this key — see the header note.
  entityDefinitionId: z.string().optional(),
  operation: z.enum(['created', 'updated', 'deleted', 'manual']),

  // Flattened config properties
  title: z.string().min(1),
  desc: z.string().optional(),
  description: z.string().optional(),
  variables: z.array(z.any()).optional(),

  // Trigger filter — condition groups, AND'd at the top level
  filters: conditionGroupsSchema.optional(),

  // Standard properties
  isValid: z.boolean().optional(),
  errors: z.array(z.string()).optional(),
  disabled: z.boolean().optional(),
  outputVariables: z.array(z.string()).optional(),
})

/** Operations configuration */
const RESOURCE_OPERATIONS: Record<string, { operation: string; label: string }> = {
  created: { operation: 'created', label: 'Created' },
  updated: { operation: 'updated', label: 'Updated' },
  deleted: { operation: 'deleted', label: 'Deleted' },
  manual: { operation: 'manual', label: 'Manual' },
}

/**
 * Get the appropriate icon for a resource/operation combination
 */
function getResourceTriggerIcon(_resourceType: string, operation: string): string {
  const operationSuffixes: Record<string, string> = {
    created: 'Plus',
    updated: '',
    deleted: 'Minus',
    manual: 'Play',
  }

  if (operation === 'manual') return 'Play'
  if (operation === 'updated') return 'Zap'

  const suffix = operationSuffixes[operation] || ''
  return suffix ? `Zap${suffix}` : 'Zap'
}

/**
 * Create default data for resource trigger
 */
export function createResourceTriggerDefaultData(
  resourceType: string = 'contact',
  operation: string = 'created'
): Partial<ResourceTriggerData> {
  const operationConfig = RESOURCE_OPERATIONS[operation]

  return {
    title: `Record ${operationConfig?.label || operation}`,
    desc: `Triggered when a record is ${operation}`,
    description: `Triggered when a record is ${operation}`,
    icon: getResourceTriggerIcon(resourceType, operation),
    variables: [],
    isValid: true,
    errors: [],
    disabled: false,
    outputVariables: [],
    resourceType,
    operation: operation as 'created' | 'updated' | 'deleted' | 'manual',
    // No filter = fire on every record. The engine reads this key.
    filters: [],
  }
}

/**
 * Validation function
 */
export const validateResourceTriggerConfig = (data: ResourceTriggerData): NodeValidationResult => {
  const errors: Array<{ field: string; message: string; type?: 'warning' | 'error' }> = []

  if (!data.resourceType?.trim()) {
    errors.push({ field: 'resourceType', message: 'Resource type is required', type: 'error' })
  }

  if (!data.operation) {
    errors.push({ field: 'operation', message: 'Operation is required', type: 'error' })
  }

  if (!data.title?.trim()) {
    errors.push({ field: 'title', message: 'Title is required', type: 'error' })
  }

  if (data.title && data.title.length > 100) {
    errors.push({
      field: 'title',
      message: 'Title is too long (max 100 characters)',
      type: 'warning',
    })
  }

  if (data.description && data.description.length > 500) {
    errors.push({
      field: 'description',
      message: 'Description is too long (max 500 characters)',
      type: 'warning',
    })
  }

  // Trigger filters are a GATE — a condition that does not evaluate as written makes
  // the engine refuse to fire the workflow at all (`resource-trigger-base.ts`). Reject
  // it at save time so the author sees it here rather than as a workflow that stopped
  // running for no visible reason.
  for (const group of data.filters ?? []) {
    for (const condition of group.conditions) {
      if (condition.isConstant === false) {
        errors.push({
          field: 'filters',
          message: 'Trigger filters cannot reference workflow variables',
          type: 'error',
        })
      }
      if (!isKnownOperator(condition.operator)) {
        errors.push({
          field: 'filters',
          message: `Unknown filter operator: "${condition.operator}"`,
          type: 'error',
        })
      } else if (operatorRequiresValue(condition.operator) && isBlank(condition.value)) {
        errors.push({
          field: 'filters',
          message: `Filter on "${String(condition.fieldId)}" is missing a value`,
          type: 'error',
        })
      }
    }
  }

  return { isValid: errors.filter((e) => e.type === 'error').length === 0, errors }
}

/** A condition value the author has not filled in yet. */
function isBlank(value: unknown): boolean {
  if (value === undefined || value === null || value === '') return true
  return Array.isArray(value) && value.length === 0
}

/**
 * Resource trigger node manifest
 */
export const resourceTriggerManifest: NodeManifest<ResourceTriggerData> = {
  id: 'resource-trigger',
  category: NodeCategory.TRIGGER,
  displayName: 'Record',
  description: 'Triggers when a record event occurs (create, update, delete, or manual)',
  icon: 'zap',
  color: '#10b981',
  triggerType: WorkflowTriggerType.RESOURCE_TRIGGER,
  defaultData: () => createResourceTriggerDefaultData('contact', 'created'),
  configSchema: resourceTriggerNodeDataSchema as unknown as z.ZodType<ResourceTriggerData>,
  validate: validateResourceTriggerConfig,
  connection: {},
  agent: {
    authorable: true,
    usage:
      '`resourceType`/`entityDefinitionId` name the record type (for custom entities the id is an ' +
      'EntityDefinition CUID — resolve it, never guess) and `operation` picks the event. BOTH ' +
      '`operation` and `entityDefinitionId` must be set or the workflow trigger columns are not ' +
      "derived and the trigger will not fire. `filters` gate firing: groups AND'd, constants only " +
      '(no {{…}} refs — nothing has run yet); empty means every record fires.',
    examples: [
      {
        description: 'Fire when a ticket is created',
        config: {
          resourceType: 'ticket',
          entityDefinitionId: 'ticket',
          operation: 'created',
          filters: [],
        },
      },
    ],
  },
}
