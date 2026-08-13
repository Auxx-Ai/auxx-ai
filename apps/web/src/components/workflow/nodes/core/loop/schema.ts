// apps/web/src/components/workflow/nodes/core/loop/schema.ts

import { loopManifest, type NodeManifest } from '@auxx/lib/workflow-engine/client'
import type { NodeDefinition } from '~/components/workflow/types'
import { defineFromManifest } from '../../define-from-manifest'
import type { LoopNodeData } from './types'

// The data half (constants, schema, defaults, validator, variable extraction,
// handle declarations, output resolver) lives in the node catalog
// (`@auxx/lib/workflow-engine/catalog/nodes/loop`). This file is the merge
// site: manifest + the React parts.

/**
 * Node definition for loop
 */
export const loopDefinition: NodeDefinition<LoopNodeData> = defineFromManifest(
  loopManifest as unknown as NodeManifest<LoopNodeData>,
  {}
)

// Back-compat re-exports so no consumer import churns:
export {
  extractLoopVariables,
  loopConfigSchema,
  validateLoop,
} from '@auxx/lib/workflow-engine/client'

/**
 * Factory function to create default data (flattened structure)
 */
export const createLoopDefaultData = (): Partial<LoopNodeData> =>
  loopManifest.defaultData() as Partial<LoopNodeData>

/**
 * Default data for new loop nodes
 */
export const loopDefaultData: Partial<LoopNodeData> = createLoopDefaultData()
