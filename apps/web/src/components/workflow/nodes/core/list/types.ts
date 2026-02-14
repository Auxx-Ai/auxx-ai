// apps/web/src/components/workflow/nodes/core/list/types.ts

import type { Condition } from '~/components/conditions'
import type { BaseNodeData, SpecificNode } from '~/components/workflow/types'

/**
 * Available list operations
 */
export type ListOperation = 'filter' | 'sort' | 'slice' | 'pluck' | 'reverse' | 'join'

/**
 * Sort direction
 */
export type SortDirection = 'asc' | 'desc'

/**
 * Null handling options for sorting
 */
export type NullHandling = 'first' | 'last'

/**
 * Slice operation modes
 */
export type SliceMode = 'first' | 'last' | 'range'

/**
 * Unique comparison modes
 */
export type UniqueBy = 'whole' | 'field'

/**
 * Join operation types
 */
export type JoinType = 'concat' | 'merge' | 'zip' | 'cross'

/**
 * Filter configuration using modern ConditionProvider system
 */
export interface FilterConfig {
  conditions: Condition[]
}

/**
 * Sort configuration (simplified single field sort)
 */
export interface SortConfig {
  field: string
  direction: SortDirection
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
// export interface UniqueConfig {
//   by: UniqueBy
//   field?: string
//   keepFirst?: boolean
// }

/**
 * Join configuration - converts array to string with delimiter
 */
export interface JoinConfig {
  /** Delimiter to join elements with (e.g., ", " or "\n") */
  delimiter: string
  /** Optional field to extract from objects before joining */
  field?: string
}

/**
 * Pluck configuration
 */
export interface PluckConfig {
  field: string
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
  // uniqueConfig?: UniqueConfig
  joinConfig?: JoinConfig
  pluckConfig?: PluckConfig
}

/**
 * Full List node type for React Flow
 */
export type ListNode = SpecificNode<'list', ListNodeData>

/**
 * Operation metadata for UI display
 */
export interface OperationMetadata {
  label: string
  description: string
  icon: string
  requiresSecondList?: boolean
  outputType: 'array' | 'value' | 'object'
}

/**
 * Operation metadata map
 */
export const OPERATION_METADATA: Record<ListOperation, OperationMetadata> = {
  filter: {
    label: 'Filter',
    description: 'Remove items based on conditions',
    icon: 'filter',
    outputType: 'array',
  },
  sort: {
    label: 'Sort',
    description: 'Order items by one or more fields',
    icon: 'arrows-up-down',
    outputType: 'array',
  },
  slice: {
    label: 'Slice',
    description: 'Extract a portion of the list',
    icon: 'scissors',
    outputType: 'array',
  },
  // unique: {
  //   label: 'Unique',
  //   description: 'Remove duplicate items',
  //   icon: 'Fingerprint',
  //   outputType: 'array',
  // },
  join: {
    label: 'Join',
    description: 'Convert array to string with delimiter',
    icon: 'text',
    outputType: 'value',
  },
  pluck: {
    label: 'Pluck',
    description: 'Extract a specific field from all items',
    icon: 'target',
    outputType: 'array',
  },
  reverse: {
    label: 'Reverse',
    description: 'Reverse the order of items',
    icon: 'refresh',
    outputType: 'array',
  },
}
