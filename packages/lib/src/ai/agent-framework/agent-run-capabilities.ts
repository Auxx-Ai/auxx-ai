// packages/lib/src/ai/agent-framework/agent-run-capabilities.ts

import { getCachedMembers } from '../../cache/org-cache-helpers'
import { UnprocessableEntityError } from '../../errors'
import {
  type CapabilityView,
  intersectCapabilities,
} from '../../permissions/capabilities/capability-view'
import { getCapabilities } from '../../permissions/capabilities/get-capabilities'

/**
 * The agent fields {@link resolveAgentRunCapabilities} needs — structurally
 * satisfied by `CachedAgent`, the `Agent` row, and test fixtures alike.
 */
export interface AgentRunPrincipal {
  /** The agent's own synthetic User; `null` while setup is incomplete. */
  userId: string | null
  /** Optional run-as delegation — resolves capabilities from this user instead. */
  runAsUserId: string | null
  /** Only used to make the run-as failure message actionable. */
  id?: string
  /** Only used to make the run-as failure message actionable. */
  name?: string | null
}

/**
 * Thrown when an agent's `runAsUserId` no longer points at an ACTIVE human
 * member of the org (deleted, deactivated, or re-pointed at an agent/system
 * user). The run is **stopped** rather than silently falling back to the
 * agent's own profile — a silently-widened agent is worse than a stopped one
 * (capability layer v2 §0.6). Surfaces as a 422 through the standard
 * `AuxxError` mapping, and lands in the run log with a message naming both
 * the agent and the missing user so an admin can re-point the delegation.
 */
export class AgentRunAsUnavailableError extends UnprocessableEntityError {}

/**
 * Resolve the {@link CapabilityView} an agent run executes under
 * (capability layer v2 §3.1).
 *
 * ```
 * sourceUserId = agent.runAsUserId ?? agent.userId
 * caps         = getCapabilities(sourceUserId, organizationId)
 * caps         = invokerUserId ? min(caps, getCapabilities(invokerUserId)) : caps
 * ```
 *
 * - **Run-as** (`agent.runAsUserId`) replaces the capability *source only* —
 *   the engine identity (session `userId`, authorship, realtime attribution)
 *   stays `agent.userId` in every case, so audit trails remain honest (§0.1).
 *   The delegate must be an ACTIVE `userType: 'USER'` member; otherwise this
 *   throws {@link AgentRunAsUnavailableError} (§0.6 — never a silent fallback).
 * - **Invoker intersection** applies to human-triggered runs (mention,
 *   assignment, interactive DM): a mention can never read data through an agent
 *   that the mentioner couldn't read themselves (§0.5). Schedule / event / app /
 *   webhook / visitor runs pass no `invokerUserId` and use the agent profile
 *   alone. Passing the source user as the invoker short-circuits to the same
 *   view (no wrapper) via `intersectCapabilities`.
 *
 * Returns `undefined` when the agent has no backing User yet (pre-setup draft):
 * there is no principal to resolve, so callers keep today's unrestricted
 * behavior rather than inventing one.
 */
export async function resolveAgentRunCapabilities(params: {
  agent: AgentRunPrincipal
  organizationId: string
  /** The human who triggered this run, when there is one. */
  invokerUserId?: string | null
}): Promise<CapabilityView | undefined> {
  const { agent, organizationId, invokerUserId } = params

  // Pre-setup draft: no synthetic User exists, so there is no principal to
  // resolve. Not an error — the caller simply stays unrestricted, as today.
  if (!agent.userId) return undefined

  if (agent.runAsUserId) {
    await assertActiveHumanMember(agent, agent.runAsUserId, organizationId)
  }

  const sourceUserId = agent.runAsUserId ?? agent.userId
  const caps = await getCapabilities(sourceUserId, organizationId)

  if (!invokerUserId || invokerUserId === sourceUserId) return caps

  return intersectCapabilities(caps, await getCapabilities(invokerUserId, organizationId))
}

/**
 * Assert the run-as delegate is an ACTIVE human member of the org, reading the
 * `members` org cache (zero DB round-trips on a warm cache).
 */
async function assertActiveHumanMember(
  agent: AgentRunPrincipal,
  runAsUserId: string,
  organizationId: string
): Promise<void> {
  const members = await getCachedMembers(organizationId)
  const member = members.find((m) => m.userId === runAsUserId)
  const label = agent.name ? `"${agent.name}"` : (agent.id ?? 'unknown')

  if (!member) {
    throw new AgentRunAsUnavailableError(
      `Agent ${label} is configured to run as user ${runAsUserId}, who is not a member of this organization. Update the agent's run-as user to let it run again.`
    )
  }
  if (member.status !== 'ACTIVE') {
    throw new AgentRunAsUnavailableError(
      `Agent ${label} is configured to run as user ${runAsUserId}, whose membership is ${member.status}. Reactivate that member or update the agent's run-as user to let it run again.`
    )
  }
  if (member.user?.userType !== 'USER') {
    throw new AgentRunAsUnavailableError(
      `Agent ${label} is configured to run as user ${runAsUserId}, who is not a human member. Update the agent's run-as user to let it run again.`
    )
  }
}
