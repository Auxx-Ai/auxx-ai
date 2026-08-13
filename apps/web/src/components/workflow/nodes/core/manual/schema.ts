// apps/web/src/components/workflow/nodes/core/manual/schema.ts

import { manualManifest, type NodeManifest } from '@auxx/lib/workflow-engine/client'
import type { NodeDefinition } from '~/components/workflow/types'
import { defineFromManifest } from '../../define-from-manifest'
import type { ManualNodeData } from './types'

// The data half (schema, defaults, validator, output resolver) lives in the
// node catalog (`@auxx/lib/workflow-engine/catalog/nodes/manual`). This file
// is the merge site: manifest + the React parts.

/**
 * Manual trigger node definition
 */
export const manualDefinition: NodeDefinition<ManualNodeData> = defineFromManifest(
  manualManifest as unknown as NodeManifest<ManualNodeData>,
  {}
)

// Back-compat re-exports so no consumer import churns:
export { manualNodeDataSchema, validateManualData } from '@auxx/lib/workflow-engine/client'

/**
 * Create default data for manual trigger node
 */
export const createManualDefaultData = (): Partial<ManualNodeData> =>
  manualManifest.defaultData() as Partial<ManualNodeData>

export const manualDefaultData = createManualDefaultData()
