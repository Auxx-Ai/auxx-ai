// apps/web/src/components/workflow/nodes/core/scheduled/schema.ts

import { type NodeManifest, scheduledTriggerManifest } from '@auxx/lib/workflow-engine/client'
import type { NodeDefinition } from '~/components/workflow/types'
import { BaseType, type UnifiedVariable } from '~/components/workflow/types/variable-types'
import { createUnifiedOutputVariable } from '~/components/workflow/utils/variable-conversion'
import { defineFromManifest } from '../../define-from-manifest'
import type { ScheduledTriggerNodeData } from './types'

// The data half (schemas, defaults, validator, variable extraction) lives in
// the node catalog (`@auxx/lib/workflow-engine/catalog/nodes/scheduled`).
// This file is the merge site: manifest + the web-only output resolver.

/**
 * Define output variables for scheduled trigger node
 */
function getScheduledTriggerOutputVariables(
  data: ScheduledTriggerNodeData,
  nodeId: string
): UnifiedVariable[] {
  const variables: UnifiedVariable[] = []

  // Triggered at timestamp
  variables.push(
    createUnifiedOutputVariable({
      nodeId,
      path: 'triggered_at',
      type: BaseType.STRING,
      description: 'ISO timestamp when the scheduled trigger was executed',
    })
  )

  // Schedule type
  variables.push(
    createUnifiedOutputVariable({
      nodeId,
      path: 'schedule_type',
      type: BaseType.STRING,
      // Vocabulary defined once, engine-side, in `SCHEDULE_KINDS`
      // (`packages/lib/src/workflow-engine/nodes/trigger-nodes/scheduled.ts`).
      // This is the kind of schedule, never the interval unit — the unit is
      // published separately as `interval_config.unit`.
      description: "Kind of schedule this trigger runs on: 'interval' or 'cron'",
    })
  )

  // Test run indicator
  variables.push(
    createUnifiedOutputVariable({
      nodeId,
      path: 'is_test_run',
      type: BaseType.BOOLEAN,
      description: 'Whether this is a manual test run or actual scheduled execution',
    })
  )

  // Schedule configuration
  if (data.config.triggerInterval === 'custom') {
    variables.push(
      createUnifiedOutputVariable({
        nodeId,
        path: 'cron_expression',
        type: BaseType.STRING,
        description: 'The cron expression used for scheduling',
      })
    )
  } else {
    variables.push(
      createUnifiedOutputVariable({
        nodeId,
        path: 'interval_config',
        type: BaseType.OBJECT,
        description:
          "The interval used for scheduling: `{ unit, value }`, where `unit` is 'minutes' | 'hours' | 'days' | 'weeks'",
      })
    )
  }

  return variables
}

/**
 * Scheduled trigger node definition
 */
export const scheduledTriggerDefinition: NodeDefinition<ScheduledTriggerNodeData> =
  defineFromManifest(
    scheduledTriggerManifest as unknown as NodeManifest<ScheduledTriggerNodeData>,
    { outputVariables: getScheduledTriggerOutputVariables as any }
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
