// apps/web/src/components/workflow/nodes/core/date-time/schema.ts

import { dateTimeManifest, type NodeManifest } from '@auxx/lib/workflow-engine/client'
import type { NodeDefinition } from '~/components/workflow/types/registry'
import { defineFromManifest } from '../../define-from-manifest'
import type { DateTimeNodeData } from './types'

// The data half (enums, schema, defaults, validator, variable extraction,
// output resolver) lives in the node catalog
// (`@auxx/lib/workflow-engine/catalog/nodes/date-time`). This file is the
// merge site: manifest + the React parts.

/**
 * Node definition
 */
export const dateTimeNodeDefinition: NodeDefinition<DateTimeNodeData> = defineFromManifest(
  dateTimeManifest as unknown as NodeManifest<DateTimeNodeData>,
  {}
)

// Back-compat re-exports so no consumer import churns:
export {
  dateTimeNodeSchema,
  extractDateTimeNodeVariables,
  validateDateTimeNodeData,
} from '@auxx/lib/workflow-engine/client'

/**
 * Default data factory
 */
export function createDateTimeNodeDefaultData(): Partial<DateTimeNodeData> {
  return dateTimeManifest.defaultData() as Partial<DateTimeNodeData>
}
