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

/** The two dynamic app trigger types whose link columns come off the app trigger node. */
const APP_TRIGGER_TYPES: readonly string[] = [
  WorkflowTriggerType.APP_TRIGGER,
  WorkflowTriggerType.APP_POLLING_TRIGGER,
]

/**
 * What `deriveTriggerLinks` found in the graph for the app/webhook trigger
 * columns (`Workflow.triggerAppId` / `triggerTriggerId` / `triggerConnectionId`
 * / `triggerInstallationId` / `triggerWebhookEndpointId` / `triggerTopic`):
 *
 * - `none` — nothing to write; the caller leaves the columns untouched. This
 *   covers "no trigger type", "app trigger but no graph posted", and "app
 *   trigger whose node is missing" — all preserved verbatim from the
 *   `workflow-service.update` branches this replaced.
 * - `app-trigger` — the app trigger node's fields; `triggerInstallationId` is
 *   NOT part of this result because it is resolved server-side at save time
 *   (`resolveActiveInstallationId`), with `storedInstallationId` as the legacy
 *   fallback.
 * - `webhook-endpoint` — `(webhookEndpointId, topic)` off the trigger node
 *   (explicit `null`s when the node is missing); the app columns clear.
 * - `clear` — the trigger switched to a non-app, non-webhook type: all six
 *   columns clear.
 */
export type DerivedTriggerLinks =
  | { kind: 'none' }
  | { kind: 'clear' }
  | {
      kind: 'app-trigger'
      appId: string
      triggerId: string
      connectionId: string | null
      /** The node's stored `installationId` — fallback when resolution fails. */
      storedInstallationId: string | null
    }
  | { kind: 'webhook-endpoint'; webhookEndpointId: string | null; topic: string | null }

/**
 * Pure graph-side half of the app/webhook trigger-column derivation — the
 * server-side branches `workflow-service.update` used to inline (HANDOFF item
 * 5). Unlike {@link deriveTriggerColumns}, `triggerType` is an INPUT here, not
 * derived: the save path trusts the caller-posted type, and the catalog cannot
 * yet resolve webhook / webhook-endpoint / app trigger types itself (they are
 * `NOT_YET_MIGRATED`).
 *
 * The server-side composition that resolves the installation id lives in
 * `derive-trigger-server.ts` (server-only leaf module — do not fold it in
 * here, this file is exported through `client.ts` and runs in the browser).
 */
export function deriveTriggerLinks(
  triggerType: string | null | undefined,
  nodes: readonly TriggerDerivationNode[] | null | undefined
): DerivedTriggerLinks {
  if (!triggerType) return { kind: 'none' }

  if (APP_TRIGGER_TYPES.includes(triggerType)) {
    if (!nodes) return { kind: 'none' }
    const triggerNode = nodes.find((n) => n.data?.triggerId && n.data?.appId)
    if (!triggerNode?.data) return { kind: 'none' }
    return {
      kind: 'app-trigger',
      appId: triggerNode.data.appId,
      triggerId: triggerNode.data.triggerId,
      connectionId: triggerNode.data.connectionId || null,
      storedInstallationId: triggerNode.data.installationId || null,
    }
  }

  if (triggerType === WorkflowTriggerType.WEBHOOK_ENDPOINT && nodes) {
    const triggerNode = nodes.find((n) => n.data?.webhookEndpointId)
    return {
      kind: 'webhook-endpoint',
      webhookEndpointId: triggerNode?.data?.webhookEndpointId || null,
      topic: triggerNode?.data?.topic || null,
    }
  }

  return { kind: 'clear' }
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
