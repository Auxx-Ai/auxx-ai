// packages/lib/src/workflow-engine/catalog/nodes/manual.ts

import type { z } from 'zod'
import { BaseType, WorkflowTriggerType } from '../../core/types'
import type { UnifiedVariable } from '../../types/unified-variable'
import { type BaseNodeData, baseNodeDataSchema } from '../node-base'
import { NodeCategory, type NodeManifest, type NodeValidationResult } from '../types'
import { createUnifiedOutputVariable } from '../variable-conversion'

/**
 * Manual trigger node data interface.
 *
 * No `inputNodes` list: what a manual trigger collects is the set of
 * `form-input` nodes wired into its `input` handle, and the EDGE is the only
 * record of that. A mirrored id list on the node was append-only canvas
 * metadata — maintained by one of the two ways to author the wire, pruned by
 * neither — so it drifted from the edges in 7 of the 8 dev workflows that had
 * an input edge, and nothing read it.
 */
export type ManualNodeData = BaseNodeData

/**
 * Zod schema for manual trigger node data
 */
export const manualNodeDataSchema = baseNodeDataSchema

/**
 * Validate manual trigger node data
 */
export function validateManualData(data: ManualNodeData): NodeValidationResult {
  const result = manualNodeDataSchema.safeParse(data)
  if (result.success) {
    return { isValid: true, errors: [] }
  }
  return {
    isValid: false,
    errors: result.error.issues.map((e) => ({
      field: e.path.join('.'),
      message: e.message,
      type: 'error' as const,
    })),
  }
}

/**
 * Define output variables for manual trigger node
 */
function getManualOutputVariables(data: ManualNodeData, nodeId: string): UnifiedVariable[] {
  const variables: UnifiedVariable[] = []

  // Add trigger timestamp
  variables.push(
    createUnifiedOutputVariable({
      nodeId,
      path: 'timestamp',
      type: BaseType.DATETIME,
      description: 'When the workflow was manually triggered',
    })
  )

  // Add user ID who triggered
  variables.push(
    createUnifiedOutputVariable({
      nodeId,
      path: 'userId',
      type: BaseType.STRING,
      description: 'ID of the user who triggered the workflow',
    })
  )

  // Data from connected input nodes — advertised ALWAYS, because the engine
  // writes `inputs` unconditionally (`nodes/trigger-nodes/manual.ts`). Gating
  // it on `data.inputNodes` made the declaration disagree with the write in
  // both directions: `inputNodes` is append-only canvas metadata, so a stale
  // id kept the variable advertised forever and an emptied list hid a
  // variable that is always populated (an empty object when nothing is wired).
  variables.push(
    createUnifiedOutputVariable({
      nodeId,
      path: 'inputs',
      type: BaseType.OBJECT,
      description: 'Data collected from connected input nodes',
    })
  )

  return variables
}

/**
 * Manual trigger node manifest.
 * Note: the trigger-column derivation maps `manual` to `TriggerType.FORM`
 * (not MANUAL) — see use-workflow-save.ts; `triggerType` here is the
 * engine-side `WorkflowTriggerType`.
 */
export const manualManifest: NodeManifest<ManualNodeData> = {
  id: 'manual',
  category: NodeCategory.TRIGGER,
  displayName: 'Manual Trigger',
  description: 'Manually trigger workflow with user inputs',
  icon: 'play',
  color: '#10b981', // TRIGGER category color
  triggerType: WorkflowTriggerType.MANUAL,
  defaultData: () => ({
    title: 'Manual Trigger',
    desc: 'Manually trigger workflow with user inputs',
  }),
  configSchema: manualNodeDataSchema as unknown as z.ZodType<ManualNodeData>,
  validate: validateManualData,
  resolveOutputs: getManualOutputVariables,
  connection: {
    canRunSingle: false, // Triggers cannot be run individually
    acceptsInputNodes: true, // This node accepts input-node connections
  },
  agent: {
    authorable: true,
    usage:
      'The workflow starts when a user runs it by hand. It takes no config. To collect ' +
      'values from the user, add `form-input` nodes and connect them to this node — the ' +
      'connection IS the declaration, and their values arrive under `inputs`.',
    examples: [{ description: 'Plain manual trigger', config: {} }],
  },
}
