// apps/web/src/components/workflow/nodes/core/dataset/types.ts

import type { CatalogDatasetNodeData } from '@auxx/lib/workflow-engine/client'
import type { SpecificNode } from '~/components/workflow/types/node-base'
import type { NodeType } from '~/components/workflow/types/node-types'

// The data half (zod schema, defaults, validator, output resolver) lives in the
// node catalog (`@auxx/lib/workflow-engine/catalog/nodes/dataset`).

/**
 * Dataset node data — the catalog shape with `type` narrowed to the builder's
 * `NodeType` enum.
 */
export interface DatasetNodeData extends CatalogDatasetNodeData {
  type: NodeType
}

/**
 * Specific Dataset node type for React Flow
 */
export type DatasetNode = SpecificNode<'dataset', DatasetNodeData>
