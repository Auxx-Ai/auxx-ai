// apps/web/src/components/workflow/nodes/core/list/schema.ts

import { z } from 'zod'
import { NodeCategory, type NodeDefinition, NodeType } from '~/components/workflow/types'
import type { ValidationResult } from '../../../types'
import { extractListVariables } from './extract-variables'
import { computeListOutputVariables } from './output-variables'
import type { ListNodeData, ListOperation } from './types'

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
 * Declared once and reused by both schemas: they had drifted apart from each
 * other AND from `ListOperation` — neither listed `unique` (so every unique node
 * failed validation with "invalid enum value") while the deprecated one still
 * listed `reduce`, an operation the engine has never implemented.
 *
 * `satisfies` pins this to the builder type, which in turn mirrors the engine's
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
const CONFIG_KEY_BY_OPERATION = {
  filter: 'filterConfig',
  sort: 'sortConfig',
  slice: 'sliceConfig',
  unique: 'uniqueConfig',
  join: undefined,
  pluck: 'pluckConfig',
  reverse: undefined,
} as const satisfies Record<ListOperation, keyof ListNodeData | undefined>

const listConfigShape = {
  operation: z.enum(LIST_OPERATIONS),
  inputList: z.string().min(1, 'Input list is required'),
  filterConfig: filterConfigSchema.optional(),
  sortConfig: sortConfigSchema.optional(),
  sliceConfig: sliceConfigSchema.optional(),
  uniqueConfig: uniqueConfigSchema.optional(),
  joinConfig: joinConfigSchema.optional(),
  pluckConfig: pluckConfigSchema.optional(),
}

/**
 * Zod schema for list node data
 */
export const listNodeDataSchema = z.object({
  // Base fields
  id: z.string(),
  type: z.literal(NodeType.LIST),
  title: z.string().default('List Operations'),
  desc: z.string().optional(),
  // List-specific fields
  ...listConfigShape,
})

/**
 * Zod schema for list node configuration (deprecated)
 */
export const listNodeSchema = z
  .object({
    title: z.string().default('List Operations'),
    desc: z.string().optional(),
    ...listConfigShape,
  })
  .refine(
    (data) => {
      // Validate that the appropriate config is provided for each operation
      const required = CONFIG_KEY_BY_OPERATION[data.operation]
      return required === undefined || data[required] !== undefined
    },
    { message: 'Operation configuration is required' }
  )

/**
 * Factory function to create default data
 */
export const createListDefaultData = (): Partial<ListNodeData> => ({
  title: 'List Operations',
  desc: 'Perform operations on arrays',
  operation: 'filter' as ListOperation,
  inputList: '',
  filterConfig: {
    conditions: [],
    logic: 'AND',
  },
})

/**
 * List node definition
 */
export const listNodeDefinition: NodeDefinition<ListNodeData> = {
  id: NodeType.LIST,
  category: NodeCategory.UTILITY,
  displayName: 'List Operations',
  description: 'Perform operations on arrays: filter, sort, map, reduce, and more',
  icon: 'list',
  color: '#3B82F6', // UTILITY category color
  schema: listNodeSchema,
  defaultData: createListDefaultData(),
  canRunSingle: true,

  /**
   * Define output variables based on operation
   */
  outputVariables: computeListOutputVariables,

  /**
   * Extract variables from data for single-run
   */
  extractVariables: extractListVariables,

  /**
   * Validation function for the node data
   */
  validator: (data): ValidationResult => {
    const errors: Array<{ field: string; message: string; type?: 'warning' | 'error' }> = []

    // Use Zod schema for basic validation
    const result = listNodeDataSchema.safeParse(data)

    if (!result.success) {
      result.error!.issues.forEach((err) => {
        errors.push({ field: err.path.join('.'), message: err.message, type: 'error' })
      })
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
  },
}
