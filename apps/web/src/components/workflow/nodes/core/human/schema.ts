// apps/web/src/components/workflow/nodes/core/human/schema.ts

import { humanConfirmationManifest, type NodeManifest } from '@auxx/lib/workflow-engine/client'
import { BaseType, type NodeDefinition } from '~/components/workflow/types'
import { createUnifiedOutputVariable } from '~/components/workflow/utils/variable-conversion'
import { defineFromManifest } from '../../define-from-manifest'
import type { HumanConfirmationNodeData } from './types'

// The data half (schema, defaults, validator, three-way branch rules) lives
// in the node catalog (`@auxx/lib/workflow-engine/catalog/nodes/human`).
// This file is the merge site: manifest + the web-only output resolver.

/**
 * Output variables function for human confirmation node
 */
export const getHumanConfirmationOutputVariables = (
  _data: HumanConfirmationNodeData,
  nodeId: string
): any[] => {
  return [
    createUnifiedOutputVariable({
      nodeId,
      path: 'approved_by',
      type: BaseType.STRING,
      description: 'User ID of the approver (empty if denied or timeout)',
    }),
    createUnifiedOutputVariable({
      nodeId,
      path: 'denied_by',
      type: BaseType.STRING,
      description: 'User ID of the denier (empty if approved or timeout)',
    }),
    createUnifiedOutputVariable({
      nodeId,
      path: 'response_time',
      type: BaseType.NUMBER,
      description: 'Time taken to respond in seconds',
    }),
    createUnifiedOutputVariable({
      nodeId,
      path: 'outcome',
      type: BaseType.STRING,
      description: 'The outcome: approved, denied, or timeout',
    }),
    createUnifiedOutputVariable({
      nodeId,
      path: 'response_message',
      type: BaseType.STRING,
      description: 'Optional message from the reviewer',
    }),
  ]
}

/**
 * Human confirmation node definition
 */
export const humanConfirmationDefinition: NodeDefinition<HumanConfirmationNodeData> =
  defineFromManifest(
    humanConfirmationManifest as unknown as NodeManifest<HumanConfirmationNodeData>,
    { outputVariables: getHumanConfirmationOutputVariables }
  )

// Back-compat re-exports so no consumer import churns:
export {
  humanConfirmationNodeDataSchema,
  validateHumanConfirmationConfig,
} from '@auxx/lib/workflow-engine/client'

/**
 * Default configuration for new human confirmation nodes
 */
export const humanConfirmationDefaultData =
  humanConfirmationManifest.defaultData() as Partial<HumanConfirmationNodeData>
