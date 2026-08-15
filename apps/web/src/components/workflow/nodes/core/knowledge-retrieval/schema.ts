// apps/web/src/components/workflow/nodes/core/knowledge-retrieval/schema.ts

import { knowledgeRetrievalManifest, type NodeManifest } from '@auxx/lib/workflow-engine/client'
import type { NodeDefinition } from '~/components/workflow/types'
import { defineFromManifest } from '../../define-from-manifest'
import type { KnowledgeRetrievalNodeData } from './types'

// The data half (source-row union, zod schema, defaults, validator, variable
// extraction, output resolver) lives in the node catalog
// (`@auxx/lib/workflow-engine/catalog/nodes/knowledge-retrieval`). This file is
// the merge site: manifest + the React parts.

/**
 * Knowledge Retrieval node definition.
 *
 * The cast bridges lib's `type: string` to the web `NodeType` narrowing —
 * safe because the manifest's defaults never set `type` (the node factory
 * assigns identity). `component` / `panel` / `traceRenderer` are attached in
 * `nodes/core/index.ts`, as for every other migrated node.
 */
export const knowledgeRetrievalDefinition: NodeDefinition<KnowledgeRetrievalNodeData> =
  defineFromManifest(
    knowledgeRetrievalManifest as unknown as NodeManifest<KnowledgeRetrievalNodeData>,
    {}
  )

// Back-compat re-exports so no panel or consumer import churns:
export {
  extractKnowledgeRetrievalVariables,
  knowledgeRetrievalNodeDataSchema,
  validateKnowledgeRetrievalConfig,
} from '@auxx/lib/workflow-engine/client'

/**
 * Default configuration for new Knowledge Retrieval nodes
 */
export const knowledgeRetrievalDefaultData =
  knowledgeRetrievalManifest.defaultData() as Partial<KnowledgeRetrievalNodeData>
