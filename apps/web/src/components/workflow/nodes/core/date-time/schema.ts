// apps/web/src/components/workflow/nodes/core/date-time/schema.ts

import { dateTimeManifest, type NodeManifest } from '@auxx/lib/workflow-engine/client'
import type { NodeDefinition } from '~/components/workflow/types/registry'
import { BaseType } from '~/components/workflow/types/variable-types'
import { createUnifiedOutputVariable } from '~/components/workflow/utils/variable-conversion'
import { defineFromManifest } from '../../define-from-manifest'
import { type DateTimeNodeData, DateTimeOperation } from './types'

// The data half (enums, schema, defaults, validator, variable extraction)
// lives in the node catalog (`@auxx/lib/workflow-engine/catalog/nodes/date-time`).
// This file is the merge site: manifest + the web-only output resolver.

/**
 * Output variables definition
 */
export function getDateTimeNodeOutputVariables(data: DateTimeNodeData, nodeId: string): any[] {
  // The date-producing operations emit an ISO 8601 string in the node's
  // timezone, or epoch milliseconds when `outputAsTimestamp` is set.
  const dateOutputType = data.outputAsTimestamp ? BaseType.NUMBER : BaseType.DATETIME
  const dateOutputSuffix = data.outputAsTimestamp ? ' (epoch milliseconds)' : ''

  switch (data.operation) {
    case DateTimeOperation.ADD_SUBTRACT:
    case DateTimeOperation.ROUND:
      return [
        createUnifiedOutputVariable({
          nodeId,
          path: 'result',
          type: dateOutputType,
          description: `Modified date/time${dateOutputSuffix}`,
        }),
      ]

    case DateTimeOperation.FORMAT:
      return [
        createUnifiedOutputVariable({
          nodeId,
          path: 'result',
          type: BaseType.STRING,
          description: 'Formatted date string',
        }),
      ]

    case DateTimeOperation.TIME_BETWEEN:
      return [
        createUnifiedOutputVariable({
          nodeId,
          path: 'result',
          type: BaseType.NUMBER,
          description: `Duration in ${data.timeBetween?.unit || 'days'}`,
        }),
      ]

    case DateTimeOperation.PARSE_DATE:
      return [
        createUnifiedOutputVariable({
          nodeId,
          path: 'result',
          type: dateOutputType,
          description: `Parsed date${dateOutputSuffix}`,
        }),
      ]

    default:
      return []
  }
}

/**
 * Node definition
 */
export const dateTimeNodeDefinition: NodeDefinition<DateTimeNodeData> = defineFromManifest(
  dateTimeManifest as unknown as NodeManifest<DateTimeNodeData>,
  { outputVariables: getDateTimeNodeOutputVariables }
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
