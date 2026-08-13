// apps/web/src/components/workflow/nodes/core/var-assign/schema.ts

import { type NodeManifest, varAssignManifest } from '@auxx/lib/workflow-engine/client'
import type { NodeDefinition } from '~/components/workflow/types'
import { defineFromManifest } from '../../define-from-manifest'
import type { VarAssignNodeData } from './types'

// The data half (schemas, defaults, validator, variable extraction, output
// resolver) lives in the node catalog
// (`@auxx/lib/workflow-engine/catalog/nodes/var-assign`). This file is the
// merge site: manifest + the React parts. The deprecated, consumer-less
// `varAssignConfigSchema` died in the move.

/**
 * Node definition for var-assign
 */
export const varAssignDefinition: NodeDefinition<VarAssignNodeData> = defineFromManifest(
  varAssignManifest as unknown as NodeManifest<VarAssignNodeData>,
  {}
)

// Back-compat re-exports so no consumer import churns:
export {
  extractVarAssignVariables,
  validateVarAssign,
  varAssignNodeDataSchema,
} from '@auxx/lib/workflow-engine/client'

/**
 * Default data for new var-assign nodes (flattened)
 */
export const varAssignDefaultData = varAssignManifest.defaultData() as Partial<VarAssignNodeData>

/**
 * Factory function to create default node data (flattened)
 */
export const createVarAssignDefaultData = (): Partial<VarAssignNodeData> =>
  varAssignManifest.defaultData() as Partial<VarAssignNodeData>
