// apps/web/src/components/workflow/nodes/core/scheduled/schema.ts

import { type NodeManifest, scheduledTriggerManifest } from '@auxx/lib/workflow-engine/client'
import type { NodeDefinition } from '~/components/workflow/types'
import { defineFromManifest } from '../../define-from-manifest'
import type { ScheduledTriggerNodeData } from './types'

// The data half (schemas, defaults, validator, variable extraction, output
// resolver) lives in the node catalog
// (`@auxx/lib/workflow-engine/catalog/nodes/scheduled`). This file is the
// merge site: manifest + the React parts.

/**
 * Scheduled trigger node definition
 */
export const scheduledTriggerDefinition: NodeDefinition<ScheduledTriggerNodeData> =
  defineFromManifest(
    scheduledTriggerManifest as unknown as NodeManifest<ScheduledTriggerNodeData>,
    {}
  )

// Back-compat re-exports so no consumer import churns:
export {
  scheduledTriggerNodeDataSchema,
  scheduledTriggerUIConfigSchema,
  validateScheduledTriggerData,
} from '@auxx/lib/workflow-engine/client'

/**
 * Create default data for scheduled trigger node
 */
export const createScheduledTriggerDefaultData = (): Partial<ScheduledTriggerNodeData> =>
  scheduledTriggerManifest.defaultData() as Partial<ScheduledTriggerNodeData>

export const scheduledTriggerDefaultData = createScheduledTriggerDefaultData()
