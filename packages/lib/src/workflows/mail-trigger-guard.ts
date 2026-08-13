// packages/lib/src/workflows/mail-trigger-guard.ts

import { type Database, schema } from '@auxx/database'
import { inArray } from 'drizzle-orm'
import { getOrgCache } from '../cache'
import { BadRequestError } from '../errors'
import { WorkflowNodeType } from '../workflow-engine/core/types'

/**
 * §8.2/§11: personal channels are not automatable. Rejects a workflow graph
 * whose message-received trigger is scoped to a channel attached to a personal
 * inbox. Persisted nodes carry the workflow node type in `data.type`
 * (`node.type` is the React Flow renderer type, `'standard'`), and the scope
 * lives in `data.channelIds` (message-trigger-scoping plan §4); the legacy
 * `data.filters.integrationId` shape is still honored for graphs saved before
 * scoping shipped. No-op for org channels and for unscoped triggers — unscoped
 * dispatch excludes personal channels at the dispatcher
 * (`trigger-message-workflows.ts`).
 */
export async function assertMailTriggerNotPersonal(
  db: Database,
  organizationId: string,
  graph: unknown
): Promise<void> {
  const nodes = (graph as { nodes?: unknown[] } | null)?.nodes
  if (!Array.isArray(nodes)) return

  const integrationIds = nodes
    .filter(
      (n): n is { type?: string; data?: Record<string, unknown> } =>
        typeof n === 'object' && n !== null
    )
    .filter(
      (n) => ((n.data?.type as string | undefined) ?? n.type) === WorkflowNodeType.MESSAGE_RECEIVED
    )
    .flatMap((n) => {
      const channelIds = Array.isArray(n.data?.channelIds) ? n.data.channelIds : []
      const legacyId = (n.data?.filters as Record<string, unknown> | undefined)?.integrationId
      return [...channelIds, legacyId]
    })
    .filter((id): id is string => typeof id === 'string' && id.length > 0)

  if (integrationIds.length === 0) return

  // The merged inbox cache spans BOTH inbox definitions and derives
  // `isPersonal` from def membership (plan 40 §3.4), so mail-trigger
  // eligibility keeps excluding personal mailboxes across the def move with no
  // def literal here. HEADLESS path — no member capabilities are read.
  const inboxes = await getOrgCache().get(organizationId, 'inboxes')
  const personalIds = new Set(inboxes.filter((i) => i.isPersonal).map((i) => i.id))
  if (personalIds.size === 0) return

  const rows = await db
    .select({ inboxId: schema.InboxIntegration.inboxId })
    .from(schema.InboxIntegration)
    .where(inArray(schema.InboxIntegration.integrationId, integrationIds))
  if (rows.some((row) => personalIds.has(row.inboxId))) {
    throw new BadRequestError(
      'Mail triggers cannot be configured on a personal inbox. Personal accounts are not automatable.'
    )
  }
}
