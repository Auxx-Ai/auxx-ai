// packages/lib/src/workflow-engine/catalog/derive-trigger.ts

import {
  RESOURCE_OPERATION_TO_TRIGGER_TYPE,
  type ResourceTriggerOperation,
  WorkflowTriggerType,
} from '../core/types'
import { getManifest } from './registry'

/**
 * The graph-node subset the derivation reads. React Flow nodes, engine nodes
 * and agent-authored graphs all satisfy it structurally.
 */
export interface TriggerDerivationNode {
  data?: {
    type?: string
    operation?: string
    entityDefinitionId?: string
    [key: string]: any
  } | null
}

export interface DerivedTriggerColumns {
  /** Undefined ⇒ no trigger node found — the caller keeps its previous value. */
  triggerType?: WorkflowTriggerType
  /** Set only by a fully configured resource-trigger. */
  entityDefinitionId?: string
}

/**
 * Derive `Workflow.triggerType` / `Workflow.entityDefinitionId` from a graph's
 * nodes — THE one implementation of the derivation `use-workflow-save.ts` used
 * to inline in the browser (plan §6b): the server takes these columns on
 * trust with the posted graph, so every writer must derive them identically or
 * a "switched" trigger keeps firing on the old one.
 *
 * Two load-bearing quirks, preserved verbatim (see `05-resource-model.md` §4):
 *  - a `manual` node maps to `TriggerType.FORM`, not MANUAL;
 *  - a `resource-trigger` sets the columns only when BOTH `operation` and
 *    `entityDefinitionId` are present — a half-configured trigger leaves
 *    `triggerType` at the generic RESOURCE_TRIGGER and no entity id.
 *
 * `resolveTriggerType` maps a node's `data.type` to its trigger type. The
 * default consults the catalog, which covers every migrated trigger; apps/web
 * passes its registry-backed resolver because the canvas can also hold
 * not-yet-migrated triggers (webhook, webhook-endpoint) and dynamic app
 * triggers (`appId:triggerId` → APP_TRIGGER / APP_POLLING_TRIGGER) the catalog
 * cannot see yet.
 */
export function deriveTriggerColumns(
  nodes: readonly TriggerDerivationNode[],
  opts?: {
    resolveTriggerType?: (nodeType: string) => WorkflowTriggerType | undefined
  }
): DerivedTriggerColumns {
  const resolve =
    opts?.resolveTriggerType ?? ((nodeType: string) => getManifest(nodeType)?.triggerType)

  const triggerNode = nodes.find((n) => {
    const nodeType = n.data?.type
    return nodeType !== undefined && resolve(nodeType) !== undefined
  })
  if (!triggerNode?.data?.type) return {}

  const nodeType = triggerNode.data.type
  let triggerType = resolve(nodeType)
  let entityDefinitionId: string | undefined

  // Resource triggers need special handling for entityDefinitionId
  if (nodeType === 'resource-trigger') {
    const { operation, entityDefinitionId: nodeEntityDefId } = triggerNode.data
    if (operation && nodeEntityDefId) {
      const mappedTriggerType =
        RESOURCE_OPERATION_TO_TRIGGER_TYPE[operation as ResourceTriggerOperation]
      if (mappedTriggerType) {
        triggerType = mappedTriggerType
        entityDefinitionId = nodeEntityDefId
      }
    }
  }

  // Manual trigger maps to FORM
  if (nodeType === 'manual') {
    triggerType = WorkflowTriggerType.FORM
  }

  return { triggerType, entityDefinitionId }
}
