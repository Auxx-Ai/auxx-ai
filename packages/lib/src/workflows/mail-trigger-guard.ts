// packages/lib/src/workflows/mail-trigger-guard.ts

import { type Database, schema } from '@auxx/database'
import { eq } from 'drizzle-orm'
import { getOrgCache } from '../cache'
import { BadRequestError } from '../errors'
import { WorkflowNodeType } from '../workflow-engine/core/types'

/**
 * §8.2/§11: personal channels are not automatable. Rejects a workflow graph
 * whose message-received trigger targets an integration attached to a personal
 * inbox (the engine honors `filters.integrationId` at execution time, so the
 * graph is validated even though the builder UI has no integration picker).
 * No-op for org inboxes and for graphs without an integration filter.
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
      (n): n is { type: string; data?: { filters?: Record<string, unknown> } } =>
        typeof n === 'object' &&
        n !== null &&
        (n as { type?: unknown }).type === WorkflowNodeType.MESSAGE_RECEIVED
    )
    .map((n) => n.data?.filters?.integrationId)
    .filter((id): id is string => typeof id === 'string' && id.length > 0)

  if (integrationIds.length === 0) return

  const inboxes = await getOrgCache().get(organizationId, 'inboxes')
  const personalIds = new Set(inboxes.filter((i) => i.isPersonal).map((i) => i.id))
  if (personalIds.size === 0) return

  for (const integrationId of integrationIds) {
    const [row] = await db
      .select({ inboxId: schema.InboxIntegration.inboxId })
      .from(schema.InboxIntegration)
      .where(eq(schema.InboxIntegration.integrationId, integrationId))
      .limit(1)
    if (row && personalIds.has(row.inboxId)) {
      throw new BadRequestError(
        'Mail triggers cannot be configured on a personal inbox. Personal accounts are not automatable.'
      )
    }
  }
}
