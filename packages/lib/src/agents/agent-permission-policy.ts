// packages/lib/src/agents/agent-permission-policy.ts

import {
  type AgentKind,
  type Database,
  database,
  type PublishedAgentPermissionPolicy,
  schema,
} from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, eq } from 'drizzle-orm'
import { getCachedPermissionProfiles, getCachedResources } from '../cache'
import type { CapabilityView } from '../permissions/capabilities/capability-view'
import { NON_RECORD_DEF_SLUGS } from '../permissions/capabilities/entity-access'
import { getCapabilities } from '../permissions/capabilities/get-capabilities'
import { resolveDraftAgentPolicy } from '../permissions/profiles/agent-policy'
import {
  AgentPolicyCapabilities,
  buildDefIdToApiSlug,
  buildDefIdToEntitySlug,
  type PolicyResourceRef,
} from '../permissions/profiles/agent-policy-capabilities'
import {
  type ClampDefinition,
  type ClampedAgentPolicy,
  clampAgentPolicyToPublisher,
} from '../permissions/profiles/agent-policy-clamp'

const logger = createScopedLogger('agent-permission-policy')

/** The agent fields policy resolution needs — satisfied by `CachedAgent` and the row alike. */
export interface AgentPolicyPrincipal {
  id: string
  kind: AgentKind
  permissionProfileId: string | null
}

/**
 * Resolve a DRAFT agent's live permission policy from its profile binding
 * (plan 19 §1.3). This is the policy that governs **draft Chat turns and draft
 * eval runs only** — production always reads the selected version's snapshot, and
 * never this.
 */
export async function resolveDraftPolicyForAgent(
  organizationId: string,
  agent: AgentPolicyPrincipal
): Promise<PublishedAgentPermissionPolicy> {
  const profiles = await getCachedPermissionProfiles(organizationId)
  return resolveDraftAgentPolicy({
    organizationId,
    agentId: agent.id,
    kind: agent.kind,
    permissionProfileId: agent.permissionProfileId,
    profiles,
  })
}

/**
 * Read ONE specific version's authorization snapshot — the pinned-eval path
 * (plan 19 §15: *"production, queued, and pinned-eval runs resolve from the
 * **selected version's** snapshot"*).
 *
 * The `agents` org cache only carries the ACTIVE version's policy, so a pinned run
 * against an older version has to read that row. One indexed read per eval run,
 * org-scoped so a foreign version id resolves to `null` rather than leaking.
 */
export async function resolveVersionPolicy(
  organizationId: string,
  agentVersionId: string,
  db: Database = database
): Promise<PublishedAgentPermissionPolicy | null> {
  const [row] = await db
    .select({ permissionPolicy: schema.AgentVersion.permissionPolicy })
    .from(schema.AgentVersion)
    .where(
      and(
        eq(schema.AgentVersion.id, agentVersionId),
        eq(schema.AgentVersion.organizationId, organizationId)
      )
    )
    .limit(1)
  return row?.permissionPolicy ?? null
}

/**
 * Wrap a policy snapshot in the {@link CapabilityView} the runtime enforces
 * against, with the def resolvers built from the org's cached `resources`.
 *
 * The resolvers are the reason this is a function and not a bare constructor
 * call: the policy is keyed by `apiSlug` (so a published rule survives a def's
 * archive/restore and applies to defs created later), while callers hand gates
 * every def form there is. One cached read, then pure in-memory lookups.
 */
export async function buildAgentPolicyCapabilities(
  organizationId: string,
  policy: PublishedAgentPermissionPolicy
): Promise<AgentPolicyCapabilities> {
  const resources = (await getCachedResources(organizationId)) as PolicyResourceRef[]
  return new AgentPolicyCapabilities(
    policy,
    buildDefIdToApiSlug(resources),
    buildDefIdToEntitySlug(resources)
  )
}

/**
 * Resolve the policy a publish should write: the draft profile expanded into a
 * total snapshot, then clamped by the publishing human's own effective
 * capabilities (plan 19 §2.4a).
 *
 * The publisher's capabilities come from `getCapabilities` — the SAME composer
 * and the same `CapabilitySet` gates that govern them everywhere else in the
 * product. That is the point: the clamp must not be able to disagree with what
 * its subject is actually permitted to do.
 *
 * `publishedByUserId: null` means a system publish and applies NO clamp. It is a
 * required parameter rather than an optional one precisely so a future caller has
 * to make that choice consciously — an omitted publisher would otherwise be a
 * silent, unbounded escalation path, which is the hole §2.4a exists to close.
 */
export async function resolvePublishPolicy(input: {
  organizationId: string
  agent: AgentPolicyPrincipal
  publishedByUserId: string | null
}): Promise<ClampedAgentPolicy> {
  const { organizationId, agent, publishedByUserId } = input

  const [resolved, resources] = await Promise.all([
    resolveDraftPolicyForAgent(organizationId, agent),
    getCachedResources(organizationId) as Promise<PolicyResourceRef[]>,
  ])

  let publisher: CapabilityView | null = null
  if (publishedByUserId) {
    publisher = await getCapabilities(publishedByUserId, organizationId)
  } else {
    logger.warn('Publishing an agent version with no publisher — author clamp skipped', {
      organizationId,
      agentId: agent.id,
    })
  }

  // Mail/messaging-infrastructure and instance-access defs are governed outside
  // the record-def keyspace (`AgentPolicyCapabilities` bypasses the definitions
  // map for them), so clamping them would only manufacture confusing reductions.
  const definitions: ClampDefinition[] = resources
    .filter((r) => !NON_RECORD_DEF_SLUGS.has(r.entityType ?? r.apiSlug))
    .map((r) => ({ apiSlug: r.apiSlug, entityDefinitionId: r.entityDefinitionId }))

  const clamped = clampAgentPolicyToPublisher({
    resolved,
    publisher,
    publisherUserId: publishedByUserId,
    definitions,
  })

  if (clamped.reductions.length > 0) {
    logger.info('Author clamp reduced a published agent policy', {
      organizationId,
      agentId: agent.id,
      publishedByUserId,
      reductions: clamped.reductions.length,
    })
  }

  return clamped
}
