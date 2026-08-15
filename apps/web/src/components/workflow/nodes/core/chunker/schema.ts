// apps/web/src/components/workflow/nodes/core/chunker/schema.ts

import { chunkerManifest, type NodeManifest } from '@auxx/lib/workflow-engine/client'
import type { NodeDefinition } from '~/components/workflow/types'
import { defineFromManifest } from '../../define-from-manifest'
import type { ChunkerNodeData } from './types'

// The data half (zod schema, defaults, validator, variable extraction, output
// resolver) lives in the node catalog
// (`@auxx/lib/workflow-engine/catalog/nodes/chunker`). This file is the merge
// site: manifest + the React parts.

/**
 * Chunker node definition.
 *
 * The cast bridges lib's `type: string` to the web `NodeType` narrowing —
 * safe because the manifest's defaults never set `type` (the node factory
 * assigns identity). `component` / `panel` / `traceRenderer` are attached in
 * `nodes/core/index.ts`, as for every other migrated node.
 */
export const chunkerDefinition: NodeDefinition<ChunkerNodeData> = defineFromManifest(
  chunkerManifest as unknown as NodeManifest<ChunkerNodeData>,
  {}
)

// Back-compat re-exports so no panel or consumer import churns:
export {
  chunkerNodeDataSchema,
  extractChunkerVariables,
  validateChunkerConfig,
} from '@auxx/lib/workflow-engine/client'

/**
 * Default configuration for new Chunker nodes
 */
export const chunkerDefaultData = chunkerManifest.defaultData() as Partial<ChunkerNodeData>
