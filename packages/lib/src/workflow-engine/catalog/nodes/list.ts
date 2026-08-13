// packages/lib/src/workflow-engine/catalog/nodes/list.ts

import { z } from 'zod'
import type { Condition } from '../../../conditions/client'
import type { BaseNodeData } from '../node-base'
import { NodeCategory, type NodeManifest, type NodeValidationResult } from '../types'
import { extractVarIdsFromString } from '../variable-inference'

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
  }),
  configSchema: listNodeDataSchema as unknown as z.ZodType<ListNodeData>,
  validate: validateListNodeData,
  extractVariables: extractListVariables,
  connection: {
    canRunSingle: true,
  },
  agent: {
    authorable: true,
    usage:
      'Pick `operation` and fill its matching config (`filter`→filterConfig, `sort`→sortConfig, ' +
      '`slice`→sliceConfig, `unique`→uniqueConfig, `pluck`→pluckConfig; `join` defaults its ' +
      'delimiter and `reverse` needs none). `inputList` is a {{…}} ref to an upstream array. ' +
      'Field references are a single `resource:field` id or an array for relationship traversal.',
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
