// apps/web/src/components/workflow/nodes/core/end/schema.ts

import { endManifest, type NodeManifest } from '@auxx/lib/workflow-engine/client'
import type { NodeDefinition } from '../../../types'
import { defineFromManifest } from '../../define-from-manifest'
import type { EndNodeData } from './types'

// The data half (schema, defaults, validator, variable extraction, output
// resolver) lives in the node catalog
// (`@auxx/lib/workflow-engine/catalog/nodes/end`). This file is the merge
// site: manifest + the React parts.

/**
 * Node definition for the End node
 */
export const endDefinition: NodeDefinition<EndNodeData> = defineFromManifest(
  endManifest as unknown as NodeManifest<EndNodeData>,
  {}
)

// Back-compat re-exports so no consumer import churns:
export {
  endNodeDataSchema,
  extractEndVariables,
  validateEndConfig,
} from '@auxx/lib/workflow-engine/client'

/**
 * Default configuration for the End node
 */
export const endDefaultData = endManifest.defaultData() as Partial<EndNodeData>
