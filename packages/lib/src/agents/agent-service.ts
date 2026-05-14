// packages/lib/src/agents/agent-service.ts

import { type Database, database as defaultDb, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { eq } from 'drizzle-orm'
import { onCacheEvent } from '../cache'

const logger = createScopedLogger('agent-service')

export interface CreateAgentInput {
  organizationId: string
  /** The human creating this agent. */
  createdById: string
  /** Written to the backing User row; reads also flow through User. */
  name: string
  slug: string
  description?: string | null
  prompt?: Record<string, unknown>
  modelId?: string | null
  mentionable?: boolean
}

export interface CreatedAgent {
  agentId: string
  userId: string
}

/**
 * Generate the sentinel email used for the synthetic User backing an agent.
 * The domain is non-routable; email fan-out code also skips userType='AGENT'
 * regardless (belt & suspenders).
 */
function agentSentinelEmail(agentId: string): string {
  return `agent+${agentId}@agents.auxx.local`
}

/**
 * Create an agent.
 *
 * Inserts a synthetic User (userType='AGENT'), an OrganizationMember row, and
 * the Agent row in a single transaction. Critically:
 *
 *   - Does NOT increment PlanSubscription.seats (agents don't consume seats)
 *   - Does NOT push to Stripe
 *   - Does NOT send any invite / join-organization email
 *   - Does NOT set User.defaultOrganizationId
 *
 * Fires `member.added` so the members cache picks up the new row, and
 * `agent.created` so the agents cache picks it up too.
 */
export async function createAgent(
  input: CreateAgentInput,
  db: Database = defaultDb as Database
): Promise<CreatedAgent> {
  const {
    organizationId,
    createdById,
    name,
    slug,
    description = null,
    prompt = {},
    modelId = null,
    mentionable = true,
  } = input

  const now = new Date()

  const { agentId, userId } = await db.transaction(async (tx) => {
    // 1. Insert the synthetic User. emailVerified: true skips any
    //    email-verification trigger; banned: false so we can still join
    //    org-member queries (logon paths reject AGENT users separately).
    const [user] = await tx
      .insert(schema.User)
      .values({
        name,
        // email gets backfilled below once we know the agent id (need a
        // deterministic, unique sentinel keyed by agentId)
        email: null,
        userType: 'AGENT',
        emailVerified: true,
        updatedAt: now,
      })
      .returning()

    if (!user) throw new Error('Failed to insert agent User row')

    // 2. Insert the Agent row. Name/avatar are not stored here — they live
    //    on the backing User row (User.name, User.avatarAssetId).
    const [agent] = await tx
      .insert(schema.Agent)
      .values({
        organizationId,
        userId: user.id,
        createdById,
        slug,
        description,
        prompt,
        modelId,
        mentionable,
      })
      .returning()

    if (!agent) throw new Error('Failed to insert Agent row')

    // 3. Back-fill the User email with the sentinel now that we have agentId.
    await tx
      .update(schema.User)
      .set({ email: agentSentinelEmail(agent.id), updatedAt: now })
      .where(eq(schema.User.id, user.id))

    // 4. OrganizationMember row — role='USER', status='ACTIVE'.
    //    DO NOT increment PlanSubscription.seats. DO NOT push Stripe.
    //    DO NOT send invite/join emails.
    await tx.insert(schema.OrganizationMember).values({
      userId: user.id,
      organizationId,
      role: 'USER',
      status: 'ACTIVE',
      updatedAt: now,
    })

    return { agentId: agent.id, userId: user.id }
  })

  // Invalidate caches outside the tx so retries don't double-fire.
  try {
    await onCacheEvent('member.added', { orgId: organizationId })
    await onCacheEvent('agent.created', { orgId: organizationId })
  } catch (err) {
    logger.warn('Failed to invalidate caches after agent create', {
      organizationId,
      agentId,
      error: err instanceof Error ? err.message : String(err),
    })
  }

  return { agentId, userId }
}

export interface UpdateAgentInput {
  /** Routed to the backing User row, not stored on Agent. */
  name?: string
  description?: string | null
  prompt?: Record<string, unknown>
  modelId?: string | null
  mentionable?: boolean
  /**
   * Archive transition. `Date` archives the agent (soft-delete + bans the
   * backing User); `null` unarchives (clears `archivedAt`, unbans User). When
   * omitted, the archive state is left untouched.
   */
  archivedAt?: Date | null
}

/**
 * Update an agent. Name updates route to the backing User row; avatar changes
 * go through the standard user-avatar upload flow against `agent.userId` (not
 * this function). Archive transitions also toggle the User's banned state.
 */
export async function updateAgent(
  agentId: string,
  organizationId: string,
  input: UpdateAgentInput,
  db: Database = defaultDb as Database
): Promise<void> {
  const now = new Date()
  const archiveTransition = 'archivedAt' in input

  await db.transaction(async (tx) => {
    const { name: _name, ...agentPatch } = input

    const [agent] = await tx
      .update(schema.Agent)
      .set({ ...agentPatch, updatedAt: now })
      .where(eq(schema.Agent.id, agentId))
      .returning({ userId: schema.Agent.userId })

    if (!agent) throw new Error(`Agent not found: ${agentId}`)

    const userPatch: {
      name?: string
      banned?: boolean
      bannedReason?: string | null
      bannedAt?: Date | null
      updatedAt: Date
    } = { updatedAt: now }
    if (input.name !== undefined) userPatch.name = input.name
    if (archiveTransition) {
      if (input.archivedAt) {
        userPatch.banned = true
        userPatch.bannedReason = 'agent_archived'
        userPatch.bannedAt = input.archivedAt
      } else {
        userPatch.banned = false
        userPatch.bannedReason = null
        userPatch.bannedAt = null
      }
    }

    if (Object.keys(userPatch).length > 1) {
      await tx.update(schema.User).set(userPatch).where(eq(schema.User.id, agent.userId))
    }
  })

  try {
    const event = archiveTransition && input.archivedAt ? 'agent.archived' : 'agent.updated'
    await onCacheEvent(event, { orgId: organizationId })
  } catch (err) {
    logger.warn('Failed to invalidate caches after agent update', {
      organizationId,
      agentId,
      error: err instanceof Error ? err.message : String(err),
    })
  }
}

/**
 * Archive an agent (soft delete). Thin wrapper around `updateAgent` for
 * non-router callers; the tRPC layer drives archive via `updateAgent`
 * directly.
 */
export async function archiveAgent(
  agentId: string,
  organizationId: string,
  db: Database = defaultDb as Database
): Promise<void> {
  await updateAgent(agentId, organizationId, { archivedAt: new Date() }, db)
}
