// apps/web/src/components/workflow/nodes/core/dataset/schema.ts

import { datasetManifest, type NodeManifest } from '@auxx/lib/workflow-engine/client'
import type { NodeDefinition } from '~/components/workflow/types'
import { defineFromManifest } from '../../define-from-manifest'
import type { DatasetNodeData } from './types'

// The data half (zod schema, defaults, validator, variable extraction, output
// resolver) lives in the node catalog
// (`@auxx/lib/workflow-engine/catalog/nodes/dataset`). This file is the merge
// site: manifest + the React parts.

/**
 * Dataset node definition.
 *
 * The cast bridges lib's `type: string` to the web `NodeType` narrowing —
 * safe because the manifest's defaults never set `type` (the node factory
 * assigns identity). `component` / `panel` / `traceRenderer` are attached in
 * `nodes/core/index.ts`, as for every other migrated node.
 */
export const datasetDefinition: NodeDefinition<DatasetNodeData> = defineFromManifest(
  datasetManifest as unknown as NodeManifest<DatasetNodeData>,
  {}
)

// Back-compat re-exports so no panel or consumer import churns:
export {
  datasetNodeDataSchema,
  extractDatasetVariables,
  validateDatasetConfig,
} from '@auxx/lib/workflow-engine/client'

/**
 * Default configuration for new Dataset nodes
 */
export const datasetDefaultData = datasetManifest.defaultData() as Partial<DatasetNodeData>
