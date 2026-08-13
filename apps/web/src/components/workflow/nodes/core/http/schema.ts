// apps/web/src/components/workflow/nodes/core/http/schema.ts

import { httpManifest, type NodeManifest } from '@auxx/lib/workflow-engine/client'
import type { NodeDefinition } from '~/components/workflow/types'
import { defineFromManifest } from '../../define-from-manifest'
import type { HttpNodeData } from './types'

// The data half (enums, request-shape types, data interface, zod schema,
// defaults, validator, variable extraction, output resolver) lives in the
// node catalog (`@auxx/lib/workflow-engine/catalog/nodes/http`). This file is
// the merge site: manifest + the React parts.

/** Node definition */
export const httpNodeDefinition: NodeDefinition<HttpNodeData> = defineFromManifest(
  httpManifest as unknown as NodeManifest<HttpNodeData>,
  {}
)

// Back-compat re-exports so no consumer import churns:
export {
  extractHttpVariableIds,
  getHttpOutputVariables,
  httpNodeDataSchema,
  validateHttpNodeData,
} from '@auxx/lib/workflow-engine/client'

/** Factory function for default data */
export function createHttpDefaultData(): Partial<HttpNodeData> {
  return httpManifest.defaultData() as Partial<HttpNodeData>
}
