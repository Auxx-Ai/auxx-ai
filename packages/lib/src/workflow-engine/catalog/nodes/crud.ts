// packages/lib/src/workflow-engine/catalog/nodes/crud.ts

import { RelationUpdateMode, relationUpdateModeSchema } from '@auxx/types/custom-field'
import { z } from 'zod'
import { generateCrudNodeVariablesFromFields } from '../../../resources/variable-generators'
import { BaseType } from '../../core/types'
import type { UnifiedVariable } from '../../types/unified-variable'
import {
  ErrorStrategy,
  errorHandlingBranches,
  normalizeErrorStrategy,
  validateDefaultValues,
} from '../error-handling'
import type { BaseNodeData } from '../node-base'
import type { OutputContext } from '../output-context'
import { resolveResourceGeneratorInputs } from '../resource-meta'
import {
  type NodeBranch,
  NodeCategory,
  type NodeManifest,
  type NodeValidationResult,
} from '../types'
import { extractFieldVariableIds, extractVarIdsFromString } from '../variable-inference'

/**
 * The crud node's catalog manifest — resource-backed like find, plus the
 * shared failure policy (`catalog/error-handling.ts`). The `CrudErrorStrategy`
 * enum that used to live here was one of two divergent error-strategy sets;
 * it is now the single `ErrorStrategy` (plan 21 §15.1) and crud's values are
 * unchanged, since the unified set took crud's names and crud's default.
 */

/**
 * CRUD default value configuration
 */
export interface CrudDefaultValue {
  key: string
  type: 'string' | 'number' | 'boolean' | 'object' | 'array'
  value: string // String representation that will be parsed based on type
}

/**
 * CRUD node data interface
 */
export interface CrudNodeData extends BaseNodeData {
  // CRUD-specific configuration
  resourceType: string // Now accepts system ('contact', 'ticket') and custom ('entity_vendors') resources
  mode: 'create' | 'update' | 'delete'
  resourceId?: string // For update/delete operations (VarEditor input)
  data: Record<string, any> // Field values
  fieldModes?: Record<string, boolean> // Track constant/variable mode per field
  // Update mode per multi-value field — multi-relation, MULTI_SELECT, and
  // multi-value scalars (`options.multi` on EMAIL/URL/PHONE/…). Default: replace.
  fieldUpdateModes?: Record<string, RelationUpdateMode>
  fieldUpdateModeVars?: Record<string, string> // Dynamic mode variable per field

  // Error handling configuration
  error_strategy: ErrorStrategy
  default_values: CrudDefaultValue[]
}

/**
 * Zod schema for CRUD node data validation
 */
export const crudNodeDataSchema = z.object({
  id: z.string(),
  type: z.literal('crud'),
  // .default(false) aligns with baseNodeDataSchema — the node factory sets it
  selected: z.boolean().default(false),
  title: z.string().min(1),
  desc: z.string().optional(),
  description: z.string().optional(),
  resourceType: z.string().min(1),
  mode: z.enum(['create', 'update', 'delete']),
  resourceId: z.string().optional(),
  data: z.record(z.string(), z.any()),
  fieldModes: z.record(z.string(), z.boolean()).optional(),
  fieldUpdateModes: z.record(z.string(), relationUpdateModeSchema).optional(),
  fieldUpdateModeVars: z.record(z.string(), z.string()).optional(),
  error_strategy: z.enum(ErrorStrategy).default(ErrorStrategy.fail),
  default_values: z
    .array(
      z.object({
        key: z.string(),
        type: z.enum(['string', 'number', 'boolean', 'object', 'array']),
        value: z.string(),
      })
    )
    .default([]),
  // `_targetBranches` is DERIVED state — see catalog/derived-keys.ts.
  isValid: z.boolean().optional(),
  errors: z.array(z.string()).optional(),
  disabled: z.boolean().optional(),
  outputVariables: z.array(z.string()).optional(),
})

/**
 * Create default CRUD node data
 */
export function createCrudNodeDefaultData(): Partial<CrudNodeData> {
  return {
    title: 'CRUD Operation',
    desc: 'Create, update, or delete records',
    resourceType: 'contact',
    mode: 'create',
    data: {},
    error_strategy: ErrorStrategy.fail,
    default_values: [],
  }
}

/**
 * Validation function for CRUD node configuration
 * Supports both system resources and custom entities (dynamic resources)
 */
export const validateCrudNodeConfig = (data: CrudNodeData): NodeValidationResult => {
  const errors: Array<{ field: string; message: string; type?: 'warning' | 'error' }> = []

  // Guard against undefined/null data
  if (!data) {
    return {
      isValid: false,
      errors: [{ field: 'data', message: 'Node data is missing', type: 'error' }],
    }
  }

  // Basic field validation
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

  // Validate resource type - now accepts any string (system or custom entity)
  if (!data.resourceType) {
    errors.push({ field: 'resourceType', message: 'Resource type is required', type: 'error' })
    return { isValid: false, errors }
  }

  // Validate operation mode
  if (!data.mode) {
    errors.push({ field: 'mode', message: 'Operation mode is required', type: 'error' })
    return { isValid: false, errors }
  }

  if (!['create', 'update', 'delete'].includes(data.mode)) {
    errors.push({
      field: 'mode',
      message: 'Operation mode must be create, update, or delete',
      type: 'error',
    })
    return { isValid: false, errors }
  }

  // Validate resource ID for update/delete operations
  if ((data.mode === 'update' || data.mode === 'delete') && !data.resourceId?.trim()) {
    errors.push({
      field: 'resourceId',
      message: 'Resource ID is required for update and delete operations',
      type: 'error',
    })
  }

  // Warning if no field data is provided for create/update (delete doesn't need data)
  if (data.mode !== 'delete') {
    if (!data.data || Object.keys(data.data).length === 0) {
      errors.push({
        field: 'data',
        message: `No field data provided for ${data.mode} operation`,
        type: 'warning',
      })
    }
  }

  // Warning for delete operations
  if (data.mode === 'delete' && data.resourceId?.trim()) {
    errors.push({
      field: 'resourceId',
      message: 'Delete operations are irreversible. Ensure you have the correct resource ID.',
      type: 'warning',
    })
  }

  // `default` with nothing configured is a silent no-op: `handleCrudError`'s
  // `default` arm is guarded on a non-empty list and otherwise falls straight
  // through to the fail arm, with no log and nothing in the panel (plan 24
  // §9.2). `panel.tsx` has always rendered a `default_values` error slot;
  // until now nothing populated it.
  //
  // `targets: undefined` because a manifest `validate` receives only `data` —
  // crud's declared outputs need an `OutputContext` carrying the resource, so
  // the KEY check cannot run here. The panel, which has the resource, runs the
  // full check. Passing an empty target list instead would report every key as
  // unknown.
  errors.push(
    ...validateDefaultValues({
      strategy: normalizeErrorStrategy(data.error_strategy, ErrorStrategy.fail),
      values: data.default_values,
      targets: undefined,
    })
  )

  // Validate per-field update modes (multi-relation, MULTI_SELECT, multi-value scalar)
  if (data.fieldUpdateModes) {
    for (const [fieldKey, mode] of Object.entries(data.fieldUpdateModes)) {
      // Dynamic mode requires a mode variable
      if (mode === RelationUpdateMode.DYNAMIC && !data.fieldUpdateModeVars?.[fieldKey]) {
        errors.push({
          field: `data.${fieldKey}`,
          message: 'Dynamic mode requires a mode variable',
          type: 'warning',
        })
      }
    }
  }

  return { isValid: errors.filter((e) => e.type === 'error').length === 0, errors }
}

/**
 * Extract variables from CRUD operation data
 * Matches backend implementation in packages/lib/src/workflow-engine/nodes/action-nodes/crud.ts
 */
export function extractCrudVariables(data: Partial<CrudNodeData>): string[] {
  const variableIds = new Set<string>()

  // Extract from resourceId (for update/delete operations)
  extractFieldVariableIds(data.resourceId).forEach((id) => variableIds.add(id))

  // Extract from field values (for create/update operations)
  if (data.data) {
    Object.values(data.data).forEach((fieldValue: any) => {
      if (typeof fieldValue === 'string') {
        // String values may contain {{variable}} patterns
        extractVarIdsFromString(fieldValue).forEach((id) => variableIds.add(id))
      } else if (fieldValue && typeof fieldValue === 'object') {
        // VarEditor format: { variable: 'nodeId.path' }
        if (fieldValue.variable) {
          variableIds.add(fieldValue.variable)
        }
        // Also check if the object contains string values with variables
        if (typeof fieldValue.value === 'string') {
          extractVarIdsFromString(fieldValue.value).forEach((id) => variableIds.add(id))
        }
      }
    })
  }
  return Array.from(variableIds)
}

/**
 * Generate thread-specific output variables for action results
 * Thread operations return action result flags instead of standard CRUD output
 */
function generateThreadActionVariables(nodeId: string): UnifiedVariable[] {
  return [
    // Core identifiers
    {
      id: `${nodeId}.id`,
      label: 'Thread ID',
      type: BaseType.STRING,
      category: 'node',
      description: 'ID of the thread that was updated',
    },
    {
      id: `${nodeId}.success`,
      label: 'Success',
      type: BaseType.BOOLEAN,
      category: 'node',
      description: 'Whether all actions completed successfully',
    },

    // Action result flags
    {
      id: `${nodeId}.statusUpdated`,
      label: 'Status Updated',
      type: BaseType.BOOLEAN,
      category: 'node',
      description: 'Whether the status was changed',
    },
    {
      id: `${nodeId}.subjectUpdated`,
      label: 'Subject Updated',
      type: BaseType.BOOLEAN,
      category: 'node',
      description: 'Whether the subject was renamed',
    },
    {
      id: `${nodeId}.assigneeUpdated`,
      label: 'Assignee Updated',
      type: BaseType.BOOLEAN,
      category: 'node',
      description: 'Whether the assignee was changed',
    },
    {
      id: `${nodeId}.readStatusUpdated`,
      label: 'Read Status Updated',
      type: BaseType.BOOLEAN,
      category: 'node',
      description: 'Whether the read status was changed',
    },
    {
      id: `${nodeId}.tagsUpdated`,
      label: 'Tags Updated',
      type: BaseType.BOOLEAN,
      category: 'node',
      description: 'Whether tags were modified',
    },
    {
      id: `${nodeId}.inboxUpdated`,
      label: 'Inbox Updated',
      type: BaseType.BOOLEAN,
      category: 'node',
      description: 'Whether the thread was moved to a different inbox',
    },
    {
      id: `${nodeId}.primaryEntityUpdated`,
      label: 'Record Link Updated',
      type: BaseType.BOOLEAN,
      category: 'node',
      description: 'Whether the linked primary record was changed',
    },

    // New values (for chaining)
    {
      id: `${nodeId}.newStatus`,
      label: 'New Status',
      type: BaseType.STRING,
      category: 'node',
      description: 'The new status value (if changed)',
    },
    {
      id: `${nodeId}.newSubject`,
      label: 'New Subject',
      type: BaseType.STRING,
      category: 'node',
      description: 'The new subject value (if renamed)',
    },
    {
      id: `${nodeId}.newAssigneeId`,
      label: 'New Assignee ID',
      type: BaseType.STRING,
      category: 'node',
      description: 'The new assignee ID (null if unassigned)',
    },
    {
      id: `${nodeId}.newReadStatus`,
      label: 'New Read Status',
      type: BaseType.STRING,
      category: 'node',
      description: 'The new read status (READ or UNREAD)',
    },
    {
      id: `${nodeId}.newInboxId`,
      label: 'New Inbox ID',
      type: BaseType.STRING,
      category: 'node',
      description: 'The new inbox ID (if moved)',
    },
    {
      id: `${nodeId}.newPrimaryEntityId`,
      label: 'New Record ID',
      type: BaseType.STRING,
      category: 'node',
      description: 'The newly linked primary record ID (null if unlinked)',
    },

    // Summary
    {
      id: `${nodeId}.actionCount`,
      label: 'Action Count',
      type: BaseType.NUMBER,
      category: 'node',
      description: 'Number of actions that were performed',
    },
    {
      id: `${nodeId}.actionsPerformed`,
      label: 'Actions Performed',
      type: BaseType.ARRAY,
      category: 'node',
      description: 'List of action descriptions that were performed',
    },
    {
      id: `${nodeId}.errors`,
      label: 'Errors',
      type: BaseType.ARRAY,
      category: 'node',
      description: 'List of any errors that occurred',
    },

    // The thread ref + the four run-metadata fields the engine writes
    // unconditionally for EVERY crud mode, success or failure
    // (`crud.ts` — success path sets `operation`/`resourceType`/`error` at
    // executeNode's top and `thread` inside the thread branch; the failure
    // path (`handleCrudError`) sets all four plus `errorDetails`). Thread
    // mode's action-flag variables above never included them.
    {
      id: `${nodeId}.thread`,
      label: 'Thread',
      type: BaseType.OBJECT,
      category: 'node',
      description: 'Reference to the updated thread',
    },
    {
      id: `${nodeId}.operation`,
      label: 'Operation',
      type: BaseType.STRING,
      category: 'node',
      description: 'The CRUD operation that was performed (create/update/delete)',
    },
    {
      id: `${nodeId}.resourceType`,
      label: 'Resource Type',
      type: BaseType.STRING,
      category: 'node',
      description: 'The type of resource that was operated on',
    },
    {
      id: `${nodeId}.error`,
      label: 'Error Message',
      type: BaseType.STRING,
      category: 'node',
      description: 'Error message if the operation failed (null if successful)',
    },
    {
      id: `${nodeId}.errorDetails`,
      label: 'Error Details',
      type: BaseType.OBJECT,
      category: 'node',
      description: 'Detailed error information for debugging (null if successful)',
    },
  ]
}

/**
 * Generate output variables for CRUD node based on current configuration
 * Unified function for both system resources and custom entities
 *
 * @param nodeData - CRUD node data
 * @param nodeId - Node ID
 * @param context - Output variable context with resource access
 */
export function getCrudNodeOutputVariables(
  nodeData: CrudNodeData,
  nodeId: string,
  context: OutputContext
): UnifiedVariable[] {
  // Thread resources have action-based output variables
  if (nodeData.resourceType === 'thread') {
    const variables = generateThreadActionVariables(nodeId)

    // Add strategy-specific variables if needed
    if (nodeData.error_strategy === ErrorStrategy.default) {
      variables.push(
        {
          id: `${nodeId}.usedDefaults`,
          label: 'Used Defaults',
          type: BaseType.BOOLEAN,
          category: 'node',
          description: 'Whether default values were used due to operation failure',
        },
        {
          id: `${nodeId}.defaultValues`,
          label: 'Default Values',
          type: BaseType.OBJECT,
          category: 'node',
          description: 'The default values used when the operation failed',
        }
      )
    }

    return variables
  }

  // No resource selected yet
  const inputs = resolveResourceGeneratorInputs(context)
  if (!inputs) {
    return []
  }

  const baseVariables = generateCrudNodeVariablesFromFields(
    inputs.resource.fields,
    inputs.resourceMeta,
    nodeId,
    nodeData.mode,
    { resourcesMap: inputs.resourcesMap, maxDepth: 2 }
  )

  // Every create/update success writes `id` (executeNode's `result.id` write)
  // and `record` (the `ResourceReference` convenience alias alongside the
  // `<entityDefId>.*` tree `setEntityVariables` populates) — declare both;
  // `generateCrudNodeVariablesFromFields` only shapes the record-typed tree,
  // not these two flat aliases.
  if (nodeData.mode !== 'delete') {
    baseVariables.push(
      {
        id: `${nodeId}.id`,
        label: 'ID',
        type: BaseType.STRING,
        category: 'node',
        description: 'ID of the created/updated record',
      },
      {
        id: `${nodeId}.record`,
        label: 'Record',
        type: BaseType.OBJECT,
        category: 'node',
        description: 'Reference to the created/updated record',
      }
    )
  }

  // Add strategy-specific variables if needed
  if (nodeData.error_strategy === ErrorStrategy.default) {
    baseVariables.push(
      {
        id: `${nodeId}.usedDefaults`,
        label: 'Used Defaults',
        type: BaseType.BOOLEAN,
        category: 'node',
        description: 'Whether default values were used due to operation failure',
      },
      {
        id: `${nodeId}.defaultValues`,
        label: 'Default Values',
        type: BaseType.OBJECT,
        category: 'node',
        description: 'The default values used when the operation failed',
      }
    )
  }

  return baseVariables
}

/**
 * CRUD node manifest
 */
export const crudManifest: NodeManifest<CrudNodeData> = {
  id: 'crud',
  category: NodeCategory.ACTION,
  displayName: 'CRUD',
  description: 'Create, update, or delete records in the database',
  icon: 'database',
  color: '#10b981', // ACTION category color
  defaultData: createCrudNodeDefaultData,
  configSchema: crudNodeDataSchema as unknown as z.ZodType<CrudNodeData>,
  validate: validateCrudNodeConfig,
  extractVariables: extractCrudVariables,
  resolveOutputs: getCrudNodeOutputVariables,
  connection: {
    canRunSingle: true,
    /**
     * Succeeded results leave via 'source'; the `fail` branch comes from the
     * shared `errorHandlingBranches` helper — the same call http spreads, so
     * the rule exists once (plan 21 §15.4).
     */
    branches: (config): NodeBranch[] => [
      { id: 'source', name: '', kind: 'default' },
      ...errorHandlingBranches(config),
    ],
  },
  errorHandling: {
    // No `continue`: this node WRITES data that downstream nodes read, so a
    // silently-skipped write is a data-integrity bug, not an inconvenience
    // (plan 24 §6.5). `default` covers "carry on with a stand-in" honestly.
    strategies: [ErrorStrategy.fail, ErrorStrategy.default],
    defaultStrategy: ErrorStrategy.fail,
    // The 5-key status block `handleCrudError` writes BEFORE the strategy
    // switch (`nodes/action-nodes/crud.ts`). `record`, `id`, `deleted` and the
    // whole `<entityDefId>.*` tree are source-only — the fail arm never writes
    // them, and the picker offered them anyway until plan 24 §6.1.
    failOutputs: ['success', 'error', 'errorDetails', 'operation', 'resourceType'],
    // Written as an explicit `null` on the success path, so under strategy
    // `fail` these two can never be anything else on `source` (§6.1a).
    // `success` deliberately stays on both: it is a real boolean rather than a
    // null, and it is the discriminator under `default`.
    failureOnlyOutputs: ['error', 'errorDetails'],
    // The same five, for a different reason — do not collapse the two lists.
    // `handleCrudError` writes this block BEFORE the strategy switch, so a
    // configured substitute for one of them is overwritten on the way past,
    // and a `success: true` substitute on a failed create would state
    // something untrue that the rest of the graph believes. What a `default`
    // on crud is FOR is `id` / `record` / the record tree — "if the create
    // fails, pretend it made this record" (plan 24 §10.2).
    defaultValueExclude: ['success', 'error', 'errorDetails', 'operation', 'resourceType'],
  },
  agent: {
    authorable: true,
    usage:
      '`resourceType` names the record type (system id like `ticket`, or a custom entity ' +
      'EntityDefinition id — resolve it, never guess); `thread` is special: it is action-based ' +
      "(status/subject/assignee/tags/…), not field-based, and only supports mode 'update'. " +
      '`mode` is create/update/delete; update and delete require `resourceId`. `data` holds field ' +
      'values keyed by field name, which may be {{…}} refs. `error_strategy` is fail (default, wires ' +
      "a 'fail' branch handle), continue (succeed with success:false), or default (apply " +
      '`default_values` on failure).',
    examples: [
      {
        description: 'Create a contact from trigger data',
        config: {
          resourceType: 'contact',
          mode: 'create',
          data: {
            email: '{{trigger-1.contact.email}}',
            firstName: '{{trigger-1.contact.firstName}}',
          },
          error_strategy: 'fail',
        },
      },
    ],
  },
}
