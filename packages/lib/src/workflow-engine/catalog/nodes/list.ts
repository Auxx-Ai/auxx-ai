// packages/lib/src/workflow-engine/catalog/nodes/list.ts

import { getFieldId, isResourceFieldId } from '@auxx/types/field'
import { z } from 'zod'
import type { Condition } from '../../../conditions/client'
import { BaseType } from '../../core/types'
import type { UnifiedVariable } from '../../types/unified-variable'
import { ErrorStrategy, errorHandlingBranches, errorStrategySchema } from '../error-handling'
import type { BaseNodeData } from '../node-base'
import type { OutputContext } from '../output-context'
import {
  type NodeBranch,
  NodeCategory,
  type NodeManifest,
  type NodeValidationResult,
} from '../types'
import { assignVariableIds, cloneAndRewriteVariableIds } from '../variable-cloning'
import { extractVarIdsFromString, inferPluckOutputType } from '../variable-inference'

/**
 * The list node's catalog manifest. The operation vocabulary and config types
 * previously lived in THREE places — the builder's `core/list/types.ts`, its
 * zod schemas, and the engine's `nodes/types/list-types.ts` (which now
 * re-exports from here). `Condition` is the shared conditions dialect from
 * `@auxx/lib/conditions` — the web conditions barrel already re-exports it.
 *
 * The deprecated duplicate `listNodeSchema` (zero consumers) was deleted; its
 * per-operation required-config knowledge survives as
 * `CONFIG_KEY_BY_OPERATION`.
 */

/** Available list operations */
export type ListOperation = 'filter' | 'sort' | 'slice' | 'pluck' | 'reverse' | 'join' | 'unique'

/** Sort direction */
export type SortDirection = 'asc' | 'desc'

/** Null handling options for sorting */
export type NullHandling = 'first' | 'last'

/** Slice operation modes */
export type SliceMode = 'first' | 'last' | 'range'

/** Unique comparison modes */
export type UniqueBy = 'whole' | 'field'

/** Join operation types */
export type JoinType = 'concat' | 'merge' | 'zip' | 'cross'

/**
 * Filter configuration using modern ConditionProvider system
 */
export interface FilterConfig {
  conditions: Condition[]
  /**
   * How the conditions combine. Mirrors the AND/OR toggle the shared condition list
   * writes onto `Condition.logicalOperator`, so the engine has one node-level key to
   * read instead of inferring it from the condition rows. Defaults to AND.
   */
  logic?: 'AND' | 'OR'
}

/**
 * Sort configuration (simplified single field sort)
 */
export interface SortConfig {
  /** Field to sort by (supports nested paths like "contact.name") */
  field: string
  direction: SortDirection
  /** How to handle null values (default: 'last') */
  nullHandling?: NullHandling
}

/**
 * Slice configuration
 */
export interface SliceConfig {
  mode: SliceMode

  // First/Last mode
  count?: number | string
  isCountConstant?: boolean

  // Range mode
  start?: number | string
  isStartConstant?: boolean
  end?: number | string
  isEndConstant?: boolean
}

/**
 * Unique configuration
 */
export interface UniqueConfig {
  by: UniqueBy
  field?: string | string[]
  keepFirst?: boolean
  caseSensitive?: boolean
}

/**
 * Join configuration - converts array to string with delimiter
 */
export interface JoinConfig {
  /** Delimiter to join elements with (e.g., ", " or "\n") */
  delimiter: string
  /** Optional field to extract from objects before joining (FieldReference: single or path) */
  field?: string | string[]
}

/**
 * Pluck configuration
 */
export interface PluckConfig {
  /** Field to pluck (FieldReference: single ResourceFieldId or FieldPath array) */
  field: string | string[]
  flatten?: boolean
}

/**
 * List node data - flattened structure
 */
export interface ListNodeData extends BaseNodeData {
  operation: ListOperation
  inputList: string
  filterConfig?: FilterConfig
  sortConfig?: SortConfig
  sliceConfig?: SliceConfig
  uniqueConfig?: UniqueConfig
  joinConfig?: JoinConfig
  pluckConfig?: PluckConfig

  /**
   * What happens when the operation fails — `fail` (route to the wireable
   * `fail` branch) or `continue` (succeed on `source` with a null `result`).
   * Optional: no node persisted before plan 21 step 4 carries the key.
   */
  error_strategy?: ErrorStrategy
}

/**
 * A `FieldReference`: either a single `ResourceFieldId` (`"ticket:subject"`) or a
 * `FieldPath` array for relationship traversal (`["ticket:contact",
 * "contact:email"]`).
 *
 * The join, pluck and unique panels all select fields through
 * `NavigableFieldSelector`, which hands back either shape — so a `z.string()`
 * here marks every relationship-traversing list node invalid in the builder.
 */
const fieldReferenceSchema = z.union([
  z.string().min(1, 'Field is required'),
  z.array(z.string().min(1)).min(1, 'Field path is required'),
])

/**
 * Zod schema for Condition (modern ConditionProvider format)
 */
const conditionSchema = z.object({
  id: z.string(),
  fieldId: fieldReferenceSchema,
  operator: z.string().min(1, 'Operator is required'), // Operator enum from engine
  value: z.any(),
  isConstant: z.boolean(),
  logicalOperator: z.enum(['AND', 'OR']).optional(),
  metadata: z.record(z.string(), z.any()).optional(),
})

/**
 * Zod schema for filter configuration (modern ConditionProvider format)
 */
const filterConfigSchema = z.object({
  conditions: z.array(conditionSchema),
  // How the conditions combine — mirrors the condition list's AND/OR toggle and is
  // what the engine's list processor reads. Defaults to AND when absent.
  logic: z.enum(['AND', 'OR']).optional(),
})

/**
 * Zod schema for sort configuration (simplified single field sort)
 */
const sortConfigSchema = z.object({
  field: z.string().min(1, 'Sort field is required'),
  direction: z.enum(['asc', 'desc'] as const),
  nullHandling: z.enum(['first', 'last'] as const).optional(),
})

/**
 * Zod schema for slice configuration
 */
const sliceConfigSchema = z.object({
  mode: z.enum(['first', 'last', 'range'] as const),

  // First/Last mode fields
  count: z.union([z.number().int().positive(), z.string()]).optional(),
  isCountConstant: z.boolean().optional().default(true),

  // Range mode fields
  start: z.union([z.number().int().min(0), z.string()]).optional(),
  isStartConstant: z.boolean().optional().default(true),

  end: z.union([z.number().int(), z.string()]).optional(),
  isEndConstant: z.boolean().optional().default(true),
})

/**
 * Zod schema for unique configuration
 */
const uniqueConfigSchema = z.object({
  by: z.enum(['whole', 'field'] as const),
  field: fieldReferenceSchema.optional(),
  keepFirst: z.boolean().optional().default(true),
  // Defaults to ON, which is what the panel shows and what the engine's
  // `executeUnique` assumes when the key is absent.
  caseSensitive: z.boolean().optional().default(true),
})

/**
 * Zod schema for join configuration - converts array to string with delimiter
 */
const joinConfigSchema = z.object({
  delimiter: z.string().default(', '),
  field: fieldReferenceSchema.optional(),
})

/**
 * Zod schema for pluck configuration
 */
const pluckConfigSchema = z.object({
  field: fieldReferenceSchema,
  flatten: z.boolean().optional().default(false),
})

/**
 * The operations the node actually offers.
 *
 * Declared once and reused: the two schemas had drifted apart from each other
 * AND from `ListOperation` — neither listed `unique` (so every unique node
 * failed validation with "invalid enum value") while the deprecated one still
 * listed `reduce`, an operation the engine has never implemented.
 *
 * `satisfies` pins this to `ListOperation`, which in turn mirrors the engine's
 * `ListProcessor` switch. Adding an operation now fails to compile until all
 * three agree.
 */
const LIST_OPERATIONS = [
  'filter',
  'sort',
  'slice',
  'unique',
  'join',
  'pluck',
  'reverse',
] as const satisfies readonly ListOperation[]

/**
 * The config object each operation needs before it can run — `undefined` for the
 * two that need none (`join`'s delimiter defaults to `", "`, and `reverse` takes
 * no configuration at all).
 */
export const CONFIG_KEY_BY_OPERATION = {
  filter: 'filterConfig',
  sort: 'sortConfig',
  slice: 'sliceConfig',
  unique: 'uniqueConfig',
  join: undefined,
  pluck: 'pluckConfig',
  reverse: undefined,
} as const satisfies Record<ListOperation, keyof ListNodeData | undefined>

/**
 * Zod schema for list node data
 */
export const listNodeDataSchema = z.object({
  // Base fields
  id: z.string(),
  type: z.literal('list'),
  title: z.string().default('List Operations'),
  desc: z.string().optional(),
  // List-specific fields
  operation: z.enum(LIST_OPERATIONS),
  // A fresh node persists an empty inputList until the user picks one — that
  // draft state must parse (`configSchema.safeParse(defaultData())` is
  // enforced), so required-ness is the validator's `inputList` check below,
  // which emits the exact error the old `.min(1)` produced.
  inputList: z.string(),
  filterConfig: filterConfigSchema.optional(),
  sortConfig: sortConfigSchema.optional(),
  sliceConfig: sliceConfigSchema.optional(),
  uniqueConfig: uniqueConfigSchema.optional(),
  joinConfig: joinConfigSchema.optional(),
  pluckConfig: pluckConfigSchema.optional(),
  // Failure policy — see `catalog/error-handling.ts`.
  error_strategy: errorStrategySchema.optional(),
})

/** Validation function for list node data */
export const validateListNodeData = (data: ListNodeData): NodeValidationResult => {
  const errors: Array<{ field: string; message: string; type?: 'warning' | 'error' }> = []

  // Use Zod schema for basic validation
  const result = listNodeDataSchema.safeParse(data)

  if (!result.success) {
    result.error!.issues.forEach((err) => {
      errors.push({ field: err.path.join('.'), message: err.message, type: 'error' })
    })
  }

  // Required-ness moved out of the schema (see `inputList` there) — same
  // field, same message, same severity as the old `.min(1)` zod issue.
  if (!data.inputList) {
    errors.push({ field: 'inputList', message: 'Input list is required', type: 'error' })
  }

  // Additional operation-specific validation
  switch (data.operation) {
    case 'slice':
      if (data.sliceConfig?.mode === 'range') {
        // Check that start and end are defined
        if (data.sliceConfig.start === undefined || data.sliceConfig.end === undefined) {
          errors.push({
            field: 'sliceConfig',
            message: 'Start and end are required for range mode',
            type: 'error',
          })
        }
        // Only validate start < end if BOTH are constants
        else if (
          data.sliceConfig.isStartConstant &&
          data.sliceConfig.isEndConstant &&
          typeof data.sliceConfig.start === 'number' &&
          typeof data.sliceConfig.end === 'number' &&
          data.sliceConfig.start >= data.sliceConfig.end
        ) {
          errors.push({
            field: 'sliceConfig',
            message: 'End must be greater than start',
            type: 'error',
          })
        }
      }

      // Validate that count is positive if constant
      if (
        (data.sliceConfig?.mode === 'first' || data.sliceConfig?.mode === 'last') &&
        data.sliceConfig.isCountConstant &&
        typeof data.sliceConfig.count === 'number' &&
        data.sliceConfig.count <= 0
      ) {
        errors.push({
          field: 'sliceConfig.count',
          message: 'Count must be a positive number',
          type: 'error',
        })
      }
      break
    case 'join':
      // No required validation - delimiter defaults to ", "
      break
    case 'unique':
      if (data.uniqueConfig?.by === 'field' && !data.uniqueConfig.field) {
        errors.push({
          field: 'uniqueConfig.field',
          message: 'Field is required when unique by field is selected',
          type: 'error',
        })
      }
      break
  }

  return { isValid: errors.filter((e) => e.type === 'error').length === 0, errors }
}

/**
 * Extract variables from list node configuration
 * Matches backend implementation expectations for variable dependency tracking
 */
export function extractListVariables(data: Partial<ListNodeData>): string[] {
  const variableIds = new Set<string>()

  // 1. Always extract from input list
  if (data.inputList) {
    extractVarIdsFromString(data.inputList).forEach((id) => variableIds.add(id))
  }

  // 2. Extract based on operation type
  switch (data.operation) {
    case 'filter':
      extractFilterVariables(data, variableIds)
      break
    case 'sort':
      extractSortVariables(data, variableIds)
      break
    case 'slice':
      extractSliceVariables(data, variableIds)
      break
    case 'pluck':
      extractPluckVariables(data, variableIds)
      break
    case 'reverse':
      // No additional variables to extract
      break
  }

  return Array.from(variableIds)
}

/** Extract variables from filter configuration */
function extractFilterVariables(data: Partial<ListNodeData>, variableIds: Set<string>): void {
  const conditions = data.filterConfig?.conditions || []

  conditions.forEach((condition: Condition) => {
    // Extract from fieldId
    if (condition.fieldId && typeof condition.fieldId === 'string') {
      extractVarIdsFromString(condition.fieldId).forEach((id) => variableIds.add(id))
    }

    // Extract from value if it's a string and not constant
    if (condition.value && typeof condition.value === 'string' && !condition.isConstant) {
      extractVarIdsFromString(condition.value).forEach((id) => variableIds.add(id))
    }
  })
}

/** Extract variables from sort configuration */
function extractSortVariables(data: Partial<ListNodeData>, variableIds: Set<string>): void {
  const sortConfig = data.sortConfig
  if (!sortConfig) return

  // Extract from field reference (can be a variable)
  if (sortConfig.field && typeof sortConfig.field === 'string') {
    extractVarIdsFromString(sortConfig.field).forEach((id) => variableIds.add(id))
  }
}

/** Extract variables from slice configuration */
function extractSliceVariables(data: Partial<ListNodeData>, variableIds: Set<string>): void {
  const sliceConfig = data.sliceConfig
  if (!sliceConfig) return

  // Extract from count (first/last mode)
  if (
    (sliceConfig.mode === 'first' || sliceConfig.mode === 'last') &&
    !sliceConfig.isCountConstant &&
    typeof sliceConfig.count === 'string'
  ) {
    extractVarIdsFromString(sliceConfig.count).forEach((id) => variableIds.add(id))
  }

  // Extract from start (range mode)
  if (
    sliceConfig.mode === 'range' &&
    !sliceConfig.isStartConstant &&
    typeof sliceConfig.start === 'string'
  ) {
    extractVarIdsFromString(sliceConfig.start).forEach((id) => variableIds.add(id))
  }

  // Extract from end (range mode)
  if (
    sliceConfig.mode === 'range' &&
    !sliceConfig.isEndConstant &&
    typeof sliceConfig.end === 'string'
  ) {
    extractVarIdsFromString(sliceConfig.end).forEach((id) => variableIds.add(id))
  }
}

/** Extract variables from pluck configuration */
function extractPluckVariables(data: Partial<ListNodeData>, variableIds: Set<string>): void {
  const pluckConfig = data.pluckConfig
  if (!pluckConfig) return

  // Extract from field reference (can be a variable)
  if (pluckConfig.field && typeof pluckConfig.field === 'string') {
    extractVarIdsFromString(pluckConfig.field).forEach((id) => variableIds.add(id))
  }
}

/**
 * Convert a FieldReference (string or string[]) to a dot-separated field key path.
 * - "ticket:email" → "email"
 * - ["ticket:contact", "contact:firstName"] → "contact.firstName"
 * - "email" → "email" (plain key passthrough)
 */
function fieldRefToKeyPath(field: string | string[]): string {
  if (Array.isArray(field)) {
    return field.map((rfId) => (isResourceFieldId(rfId) ? getFieldId(rfId) : rfId)).join('.')
  }
  if (isResourceFieldId(field)) {
    return getFieldId(field)
  }
  return field
}

/**
 * Validate that the input variable is an array type
 */
function validateInputArrayVariable(inputVar?: UnifiedVariable): UnifiedVariable | null {
  // Ensure it's an array type
  if (!inputVar || inputVar.type !== BaseType.ARRAY) return null
  return inputVar
}

/**
 * Compute output variables for a list node based on its operation.
 * Intelligently infers output types based on input array structure.
 *
 * @param data - List node configuration data
 * @param nodeId - Node ID for generating variable IDs
 * @param context - Output variable context with resolveVariable for upstream variable lookup
 * @returns Array of output variables with inferred types
 *
 * NOTE: This function implements best-effort type inference. When the input array variable
 * can be resolved via context.resolveVariable, it performs intelligent type inference based
 * on input array structure. Otherwise, it falls back to generic ARRAY types.
 */
export function computeListOutputVariables(
  data: ListNodeData,
  nodeId: string,
  context: OutputContext
): UnifiedVariable[] {
  // Resolve the input array variable from upstream
  const inputVariableId = data.inputList?.replace(/[{}]/g, '')
  const inputArrayVariable = inputVariableId ? context.resolveVariable(inputVariableId) : undefined
  const operation = data.operation as ListOperation
  const outputs: UnifiedVariable[] = []

  // Validate input array variable for type inference (if available)
  const inputArrayVar = validateInputArrayVariable(inputArrayVariable)

  // Infer result type based on operation
  let resultType: BaseType = BaseType.ARRAY
  let resultItems: UnifiedVariable | undefined
  let resultResourceId: string | undefined
  let resultProperties: Record<string, UnifiedVariable> | undefined

  switch (operation) {
    case 'filter':
    case 'sort':
    case 'unique':
    case 'reverse': {
      // These operations preserve the array structure
      // Use cloneAndRewriteVariableIds to deep clone with new IDs
      if (inputArrayVar?.items && data.inputList) {
        const variableId = data.inputList.replace(/[{}]/g, '')
        const oldBaseId = `${variableId}[*]`
        const newBaseId = `${nodeId}.result[*]`

        resultItems = cloneAndRewriteVariableIds(
          inputArrayVar.items,
          newBaseId,
          oldBaseId
        ) as UnifiedVariable

        // Preserve resourceId if present
        resultResourceId = inputArrayVar.resourceId
      }
      break
    }

    case 'slice': {
      // Slice returns single item when mode=first/last and count=1, otherwise array
      const sliceConfig = data.sliceConfig
      const returnsSingleItem =
        sliceConfig &&
        (sliceConfig.mode === 'first' || sliceConfig.mode === 'last') &&
        (sliceConfig.isCountConstant ?? true) &&
        sliceConfig.count === 1

      if (returnsSingleItem && inputArrayVar?.items && data.inputList) {
        // Return the item type directly (not wrapped in array)
        const variableId = data.inputList.replace(/[{}]/g, '')
        const oldBaseId = `${variableId}[*]`
        const newBaseId = `${nodeId}.result`

        // Clone the items structure and use it as the result type
        const clonedItem = cloneAndRewriteVariableIds(
          inputArrayVar.items,
          newBaseId,
          oldBaseId
        ) as UnifiedVariable

        // Set the result type to match the item type
        resultType = clonedItem.type

        // Copy nested structure based on type
        if (clonedItem.items) resultItems = clonedItem.items
        if (clonedItem.properties) resultProperties = clonedItem.properties

        resultResourceId = inputArrayVar.resourceId
      } else if (inputArrayVar?.items && data.inputList) {
        // Return array (default behavior)
        const variableId = data.inputList.replace(/[{}]/g, '')
        const oldBaseId = `${variableId}[*]`
        const newBaseId = `${nodeId}.result[*]`

        resultItems = cloneAndRewriteVariableIds(
          inputArrayVar.items,
          newBaseId,
          oldBaseId
        ) as UnifiedVariable

        resultResourceId = inputArrayVar.resourceId
      }
      break
    }

    case 'pluck': {
      // Infer type from plucked field
      const pluckFieldRef = data.pluckConfig?.field
      const flatten = data.pluckConfig?.flatten || false

      if (pluckFieldRef && inputArrayVar) {
        const pluckKeyPath = fieldRefToKeyPath(pluckFieldRef)
        const inferredType = inferPluckOutputType(inputArrayVar, pluckKeyPath, flatten)
        if (inferredType) {
          // Build the base result items structure
          const baseStructure: Partial<UnifiedVariable> = {
            type: inferredType.type,
            label: pluckKeyPath.split('.').pop() || 'Value',
            category: 'node' as const,
            ...(inferredType.items && { items: inferredType.items }),
            ...(inferredType.resourceId && { resourceId: inferredType.resourceId }),
            ...(inferredType.properties && { properties: inferredType.properties }),
          }

          // Use assignVariableIds to set IDs for the entire structure
          const newBaseId = `${nodeId}.result[*]`
          resultItems = assignVariableIds(baseStructure, newBaseId)
        }
      }
      break
    }

    case 'join': {
      // Join returns a string, not an array
      resultType = BaseType.STRING
      resultItems = undefined
      resultResourceId = undefined
      break
    }

    default:
      // Fallback: preserve input structure if available
      if (inputArrayVar?.items && data.inputList) {
        const variableId = data.inputList.replace(/[{}]/g, '')
        const oldBaseId = `${variableId}[*]`
        const newBaseId = `${nodeId}.result[*]`

        resultItems = cloneAndRewriteVariableIds(
          inputArrayVar.items,
          newBaseId,
          oldBaseId
        ) as UnifiedVariable

        resultResourceId = inputArrayVar.resourceId
      }
  }

  // Build main result variable
  outputs.push({
    id: `${nodeId}.result`,
    type: resultType,
    label: 'Result',
    category: 'node',
    description: `Result of ${operation} operation`,
    ...(resultItems && { items: resultItems }),
    ...(resultProperties && { properties: resultProperties }),
    ...(resultResourceId && { resourceId: resultResourceId }),
  })

  // Add operation-specific metadata variables
  if (['filter', 'slice', 'unique'].includes(operation)) {
    outputs.push({
      id: `${nodeId}.count`,
      type: BaseType.NUMBER,
      label: 'Count',
      category: 'node',
      description: 'Number of items in the result',
    })
  }

  return outputs
}

/**
 * List node manifest
 */
export const listManifest: NodeManifest<ListNodeData> = {
  id: 'list',
  category: NodeCategory.UTILITY,
  displayName: 'List Operations',
  description: 'Perform operations on arrays: filter, sort, map, reduce, and more',
  icon: 'list',
  color: '#3B82F6', // UTILITY category color
  defaultData: () => ({
    title: 'List Operations',
    desc: 'Perform operations on arrays',
    operation: 'filter' as ListOperation,
    inputList: '',
    filterConfig: {
      conditions: [],
      logic: 'AND',
    },
    // Written on create for the same reason http/crud write it: `fail` is what
    // an unset node ALREADY does, so the processor emits `outputHandle: 'fail'`
    // on failure either way — persisting it is the node telling the truth about
    // the handle it emits (plan 21 §14.4). Existing rows keep no key.
    error_strategy: ErrorStrategy.fail,
    _targetBranches: [
      { id: 'source', name: '', type: 'default' },
      { id: 'fail', name: 'Fail', type: 'fail' },
    ],
  }),
  configSchema: listNodeDataSchema as unknown as z.ZodType<ListNodeData>,
  validate: validateListNodeData,
  extractVariables: extractListVariables,
  resolveOutputs: computeListOutputVariables,
  connection: {
    canRunSingle: true,
    /**
     * Successful runs leave via `source`; the `fail` branch comes from the
     * shared helper, the single site that turns `error_strategy: 'fail'` into
     * a handle (plan 21 §15.4).
     */
    branches: (config): NodeBranch[] => [
      { id: 'source', name: '', kind: 'default' },
      ...errorHandlingBranches(config),
    ],
  },
  /**
   * The weakest case in plan 21 §16.3 — a list failure is usually a config bug
   * and routing around it hides the fix. Opted in anyway because a list
   * operating on data from a preceding API/retrieval step can fail on the DATA
   * rather than on the config (a `pluck` over a field an upstream response
   * omitted), which is the same "keep going" need the RAG cluster has. No
   * `default`: a substitute list is a config value, not an error recovery.
   */
  errorHandling: {
    // `fail` only — the outputs are the reason this node exists (§6.5).
    strategies: [ErrorStrategy.fail],
    defaultStrategy: ErrorStrategy.fail,
  },
  agent: {
    authorable: true,
    usage:
      'Pick `operation` and fill its matching config (`filter`→filterConfig, `sort`→sortConfig, ' +
      '`slice`→sliceConfig, `unique`→uniqueConfig, `pluck`→pluckConfig; `join` defaults its ' +
      'delimiter and `reverse` needs none). `inputList` is a {{…}} ref to an upstream array. ' +
      'Field references are a single `resource:field` id or an array for relationship traversal. ' +
      '`error_strategy` is fail (the default — exposes a wirable "fail" branch handle; ' +
      'leaving it unwired just means the run dies, which is the normal shape) or continue ' +
      '(succeed on "source" with `success: false` and the error in the output).',
    examples: [
      {
        description: 'Keep only open tickets from an upstream find',
        config: {
          operation: 'filter',
          inputList: '{{find-1.tickets}}',
          filterConfig: {
            conditions: [
              {
                id: 'c1',
                fieldId: 'ticket:status',
                operator: 'is',
                value: 'open',
                isConstant: true,
              },
            ],
            logic: 'AND',
          },
        },
      },
    ],
  },
}
