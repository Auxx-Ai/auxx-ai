// apps/web/src/server/lib/agent-instance-access.ts

import { getAllCachedAgents } from '@auxx/lib/cache'
import { NotFoundError } from '@auxx/lib/errors'
import type { CapabilitySet } from '@auxx/lib/permissions/capabilities/capability-set'

/**
 * The one authority for per-agent instance access (plan 25 §4.2).
 *
 * Every `agentId` that reaches an assert must be a real {@link Agent.id} first.
 * That is not pedantry: `agent.getById` accepts **an id OR a slug** (the detail
 * page routes by slug), and `assertViewInstance('agent', slug)` looks up a
 * `ResourceAccess` row keyed on the id — so it would find none, fall through to
 * the area level, and hand a restricted agent straight to the caller. #1345 hit
 * the same class from the other side, where `assertWorkflowVersionNotSystemOwned`
 * had to return the PARENT `WorkflowApp.id` because instance access keys on the
 * parent while version surfaces only hold a child id.
 *
 * Resolution runs off the org agents cache (`getAllCachedAgents` — it includes
 * archived rows, so an archived agent still resolves and is judged by its
 * grants rather than vanishing into a 404 for an admin who may see it).
 *
 * **Not found is a 404 BEFORE the assert, deliberately.** An agent id from
 * another org must not be distinguishable from a restricted one in this org;
 * both end as `NotFoundError`, and only a resolvable in-org agent reaches the
 * capability check.
 */
export type AgentAccessTier = 'view' | 'edit' | 'admin'

/**
 * Resolve `idOrSlug` to a real `Agent.id` within the org, then assert the tier
 * against it. Returns the resolved id so callers can use it downstream instead
 * of re-resolving.
 *
 * @throws NotFoundError when no agent in the org matches the identifier.
 * @throws ForbiddenError (from the CapabilitySet) when the tier is not met.
 */
export async function assertAgentAccess(params: {
  capabilities: CapabilitySet
  organizationId: string
  idOrSlug: string
  tier: AgentAccessTier
}): Promise<string> {
  const { capabilities, organizationId, idOrSlug, tier } = params
  const agentId = await resolveAgentId(organizationId, idOrSlug)

  if (tier === 'view') capabilities.assertViewInstance('agent', agentId)
  else if (tier === 'edit') capabilities.assertEditInstance('agent', agentId)
  else capabilities.assertAdminInstance('agent', agentId)

  return agentId
}

/**
 * `idOrSlug` → `Agent.id`, or a 404. Exported for the rare caller that needs
 * the id without an assert (the kopilot SSE route resolves before it can build
 * its denial message). Prefer {@link assertAgentAccess} — a bare resolve is a
 * lookup, not a permission check.
 */
export async function resolveAgentId(organizationId: string, idOrSlug: string): Promise<string> {
  const all = await getAllCachedAgents(organizationId)
  const match = all.find((a) => a.id === idOrSlug || a.slug === idOrSlug)
  if (!match) throw new NotFoundError('Agent not found')
  return match.id
}
