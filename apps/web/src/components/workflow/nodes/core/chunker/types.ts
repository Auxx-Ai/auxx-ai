// apps/web/src/components/workflow/nodes/core/chunker/types.ts

import type { CatalogChunkerNodeData } from '@auxx/lib/workflow-engine/client'
import type { SpecificNode } from '~/components/workflow/types/node-base'
import type { NodeType } from '~/components/workflow/types/node-types'

// The data half (zod schema, defaults, validator, output resolver) lives in the
// node catalog (`@auxx/lib/workflow-engine/catalog/nodes/chunker`).

/**
 * Chunker node data — the catalog shape with `type` narrowed to the builder's
 * `NodeType` enum.
 */
export interface ChunkerNodeData extends CatalogChunkerNodeData {
  type: NodeType
}

/**
 * Specific Chunker node type for React Flow
 */
export type ChunkerNode = SpecificNode<'chunker', ChunkerNodeData>
