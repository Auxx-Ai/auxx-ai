// packages/lib/src/workflow-engine/catalog/derive-trigger-server.ts

import { createScopedLogger } from '@auxx/logger'
import { resolveActiveInstallationId } from '../../apps/installations/resolve-active-installation'
import { deriveTriggerLinks, type TriggerDerivationNode } from './derive-trigger'

const logger = createScopedLogger('derive-trigger-server')

/**
 * The app/webhook trigger columns on `Workflow` (and their `AgentTrigger`
 * mirrors). A key that is absent means "leave the stored value alone"; `null`
 * is an explicit clear — the same contract `workflow-service.update` builds
 * its `workflowUpdates` object with.
 */
export interface TriggerLinkColumnUpdates {
  triggerAppId?: string | null
  triggerTriggerId?: string | null
  triggerInstallationId?: string | null
  triggerConnectionId?: string | null
  triggerWebhookEndpointId?: string | null
  triggerTopic?: string | null
}

/**
 * Server-side composition over {@link deriveTriggerLinks}: derive the six
 * app/webhook trigger-link columns from the graph, resolving
 * `triggerInstallationId` at save time. THE one implementation of the
 * branches `workflow-service.update` used to inline (HANDOFF item 5) —
 * Phase 3's graph-edit service calls this on every trigger-touching mutation.
 *
 * SERVER-ONLY leaf module (same rule as `build-output-context.ts` /
 * `resolve-outputs.ts`): it reaches the DB through
 * `resolveActiveInstallationId`, so it must never be exported from
 * `client.ts` or the `workflow-engine` index barrel. `organizationId` first,
 * no `db` param: the only read goes through `resolveActiveInstallationId`,
 * which owns its own DB access — there is no query here to run against a
 * caller-supplied `db`.
 *
 * `triggerType` is the type being WRITTEN (the save path trusts the posted
 * value; a future full server derivation needs the catalog to cover webhook /
 * app trigger types first — see `05-resource-model.md` §4a.8 step 5). This
 * function cannot fail: an unresolvable installation falls back to the
 * node's stored `installationId` with a warning, because writing `null`
 * would silently disable dispatch (the trigger filter matches on exact
 * equality).
 *
 * Returns `{}` when there is nothing to write — the caller must then leave
 * the stored columns untouched.
 */
export async function deriveTriggerLinkColumns(
  organizationId: string,
  triggerType: string | null | undefined,
  nodes: readonly TriggerDerivationNode[] | null | undefined
): Promise<TriggerLinkColumnUpdates> {
  const links = deriveTriggerLinks(triggerType, nodes)

  switch (links.kind) {
    case 'none':
      return {}

    case 'clear':
      return {
        triggerAppId: null,
        triggerTriggerId: null,
        triggerInstallationId: null,
        triggerConnectionId: null,
        triggerWebhookEndpointId: null,
        triggerTopic: null,
      }

    case 'webhook-endpoint':
      // No installation/connection to resolve — the user owns the endpoint.
      return {
        triggerAppId: null,
        triggerTriggerId: null,
        triggerInstallationId: null,
        triggerConnectionId: null,
        triggerWebhookEndpointId: links.webhookEndpointId,
        triggerTopic: links.topic,
      }

    case 'app-trigger': {
      // Resolve triggerInstallationId at save time — fall back to the stored
      // value for legacy nodes that still carry installationId.
      let triggerInstallationId: string | null
      const instResult = await resolveActiveInstallationId(links.appId, organizationId)
      if (instResult.isOk()) {
        triggerInstallationId = instResult.value
      } else {
        triggerInstallationId = links.storedInstallationId
        logger.warn('Could not resolve triggerInstallationId, using stored value', {
          appId: links.appId,
          organizationId,
          storedInstallationId: links.storedInstallationId,
        })
      }
      return {
        triggerAppId: links.appId,
        triggerTriggerId: links.triggerId,
        triggerConnectionId: links.connectionId,
        triggerInstallationId,
      }
    }
  }
}
