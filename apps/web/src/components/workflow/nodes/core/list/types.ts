// apps/web/src/components/workflow/nodes/core/list/types.ts

import type { CatalogListNodeData } from '@auxx/lib/workflow-engine/client'
import type { SpecificNode } from '~/components/workflow/types'
import type { NodeType } from '~/components/workflow/types/node-types'

// The data half moved to the node catalog (node-catalog Phase 1 —
// `@auxx/lib/workflow-engine/catalog/nodes/list`); re-exported here so no web
// import churns. ListNodeData narrows `type` to the web NodeType enum, same
// as BaseNodeData does over its lib counterpart. `OPERATION_METADATA` below is
// UI display metadata (picker labels/icons), not part of the node contract, so
// it stays web-side.
export type {
  FilterConfig,
  JoinConfig,
  JoinType,
  ListOperation,
  NullHandling,
  PluckConfig,
  SliceConfig,
  SliceMode,
  SortConfig,
  SortDirection,
  UniqueBy,
  UniqueConfig,
} from '@auxx/lib/workflow-engine/client'

import type { ListOperation } from '@auxx/lib/workflow-engine/client'

/**
 * List node data - flattened structure
 */
export interface ListNodeData extends CatalogListNodeData {
  type: NodeType
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
  unique: {
    label: 'Unique',
    description: 'Remove duplicate items',
    icon: 'fingerprint',
    outputType: 'array',
  },
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
