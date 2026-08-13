// apps/web/src/components/workflow/nodes/core/http/schema.ts

import { httpManifest, type NodeManifest } from '@auxx/lib/workflow-engine/client'
import type { NodeDefinition } from '~/components/workflow/types'
import type { UnifiedVariable } from '~/components/workflow/types/variable-types'
import { BaseType } from '~/components/workflow/types/variable-types'
import { createUnifiedOutputVariable } from '~/components/workflow/utils/variable-conversion'
import { defineFromManifest } from '../../define-from-manifest'
import type { HttpNodeData } from './types'

// The data half (enums, request-shape types, data interface, zod schema,
// defaults, validator, variable extraction) lives in the node catalog
// (`@auxx/lib/workflow-engine/catalog/nodes/http`). This file is the merge
// site: manifest + the web-only output resolver.

/** Output variables for HTTP node */
export function getHttpOutputVariables(data: HttpNodeData, nodeId: string): UnifiedVariable[] {
  return [
    createUnifiedOutputVariable({
      nodeId,
      path: 'status',
      type: BaseType.NUMBER,
      description: 'HTTP response status code',
    }),
    createUnifiedOutputVariable({
      nodeId,
      path: 'headers',
      type: BaseType.OBJECT,
      description: 'HTTP response headers',
    }),
    createUnifiedOutputVariable({
      nodeId,
      path: 'body',
      type: BaseType.ANY,
      description: 'HTTP response body',
    }),
    createUnifiedOutputVariable({
      nodeId,
      path: 'success',
      type: BaseType.BOOLEAN,
      description: 'Whether the HTTP request was successful',
    }),
    createUnifiedOutputVariable({
      nodeId,
      path: 'error',
      type: BaseType.STRING,
      description: 'Error message if the request failed',
    }),
    createUnifiedOutputVariable({
      nodeId,
      path: 'response',
      type: BaseType.OBJECT,
      description: 'Full HTTP response object',
    }),
  ]
}

/** Node definition */
export const httpNodeDefinition: NodeDefinition<HttpNodeData> = defineFromManifest(
  httpManifest as unknown as NodeManifest<HttpNodeData>,
  { outputVariables: getHttpOutputVariables as any }
)

// Back-compat re-exports so no consumer import churns:
export {
  extractHttpVariableIds,
  httpNodeDataSchema,
  validateHttpNodeData,
} from '@auxx/lib/workflow-engine/client'

/** Factory function for default data */
export function createHttpDefaultData(): Partial<HttpNodeData> {
  return httpManifest.defaultData() as Partial<HttpNodeData>
}
