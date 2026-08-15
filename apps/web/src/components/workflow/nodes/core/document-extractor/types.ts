// apps/web/src/components/workflow/nodes/core/document-extractor/types.ts

import type { CatalogDocumentExtractorNodeData } from '@auxx/lib/workflow-engine/client'
import type { SpecificNode } from '~/components/workflow/types/node-base'
import type { NodeType } from '~/components/workflow/types/node-types'

// The data half (zod schema, defaults, validator, output resolver) lives in the
// node catalog (`@auxx/lib/workflow-engine/catalog/nodes/document-extractor`).

// Back-compat re-export so no panel or consumer import churns. The enum used to
// be declared twice — here and in the engine processor — and now has one home.
export { DocumentSourceType } from '@auxx/lib/workflow-engine/client'

/**
 * Document Extractor node data — the catalog shape with `type` narrowed to the
 * builder's `NodeType` enum.
 */
export interface DocumentExtractorNodeData extends CatalogDocumentExtractorNodeData {
  type: NodeType
}

/**
 * Specific Document Extractor node type for React Flow
 */
export type DocumentExtractorNode = SpecificNode<'document-extractor', DocumentExtractorNodeData>
