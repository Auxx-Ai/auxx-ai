// apps/web/src/components/workflow/nodes/core/format/schema.ts

import { formatManifest, type NodeManifest } from '@auxx/lib/workflow-engine/client'
import type { NodeDefinition } from '~/components/workflow/types'
import { defineFromManifest } from '../../define-from-manifest'
import type { FormatNodeData } from './types'

// The data half (schema, defaults, validator, variable extraction, output
// resolver) lives in the node catalog
// (`@auxx/lib/workflow-engine/catalog/nodes/format`). This file is the merge
// site: manifest + the React parts.

/** Node definition */
export const formatNodeDefinition: NodeDefinition<FormatNodeData> = defineFromManifest(
  formatManifest as unknown as NodeManifest<FormatNodeData>,
  {}
)

// Back-compat re-exports so no consumer import churns:
export { formatNodeSchema, validateFormatNodeData } from '@auxx/lib/workflow-engine/client'

/** Factory function for default data */
export function createFormatDefaultData(): Partial<FormatNodeData> {
  return formatManifest.defaultData() as Partial<FormatNodeData>
}
