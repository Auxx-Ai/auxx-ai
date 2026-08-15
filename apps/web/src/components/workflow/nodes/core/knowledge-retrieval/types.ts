// apps/web/src/components/workflow/nodes/core/knowledge-retrieval/types.ts

import type { CatalogKnowledgeRetrievalNodeData } from '@auxx/lib/workflow-engine/client'
import type { SpecificNode } from '~/components/workflow/types/node-base'
import type { NodeType } from '~/components/workflow/types/node-types'

// The data half (source-row union, zod schema, defaults, validator, output
// resolver) lives in the node catalog
// (`@auxx/lib/workflow-engine/catalog/nodes/knowledge-retrieval`).

/**
 * Search type options for knowledge retrieval
 */
export type SearchType = 'vector' | 'text' | 'hybrid'

// Back-compat re-exports so no panel or consumer import churns.
export {
  type KnowledgeSourceRow,
  sourceFieldKey,
  sourceRawId,
} from '@auxx/lib/workflow-engine/client'

/**
 * Knowledge Retrieval node data — the catalog shape with `type` narrowed to the
 * builder's `NodeType` enum.
 */
export interface KnowledgeRetrievalNodeData extends CatalogKnowledgeRetrievalNodeData {
  type: NodeType
}

/**
 * Specific Knowledge Retrieval node type for React Flow
 */
export type KnowledgeRetrievalNode = SpecificNode<'knowledge-retrieval', KnowledgeRetrievalNodeData>
