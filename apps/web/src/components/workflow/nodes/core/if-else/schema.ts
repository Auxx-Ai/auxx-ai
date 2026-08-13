// apps/web/src/components/workflow/nodes/core/if-else/schema.ts

import { ifElseManifest, type NodeManifest } from '@auxx/lib/workflow-engine/client'
import type { NodeDefinition } from '~/components/workflow/types'
import { defineFromManifest } from '../../define-from-manifest'
import type { IfElseNodeData } from './types'

// The data half (condition/case types, schema, defaults, validator, variable
// extraction, branch rules, output resolver) lives in the node catalog
// (`@auxx/lib/workflow-engine/catalog/nodes/if-else`). This file is the merge
// site: manifest + the React parts. The deprecated, consumer-less
// `ifElseSchema` died in the move.

/**
 * Node definition for if-else
 */
export const ifElseDefinition: NodeDefinition<IfElseNodeData> = defineFromManifest(
  ifElseManifest as unknown as NodeManifest<IfElseNodeData>,
  {}
)

// Back-compat re-exports so no consumer import churns:
export {
  ifElseNodeDataSchema,
  validateIfElseConfig,
} from '@auxx/lib/workflow-engine/client'

/**
 * Default data for new if-else nodes (flattened)
 */
export const ifElseDefaultData = ifElseManifest.defaultData() as Partial<IfElseNodeData>
