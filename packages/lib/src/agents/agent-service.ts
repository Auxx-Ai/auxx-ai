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
  name: string
  slug: string
  description?: string | null
  avatar?: string | null
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
    avatar = null,
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
        image: avatar,
        userType: 'AGENT',
        emailVerified: true,
        updatedAt: now,
      })
      .returning()

    if (!user) throw new Error('Failed to insert agent User row')

    // 2. Insert the Agent row.
    const [agent] = await tx
      .insert(schema.Agent)
      .values({
        organizationId,
        userId: user.id,
        createdById,
        name,
        slug,
        description,
        avatar,
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
  name?: string
  description?: string | null
  avatar?: string | null
  prompt?: Record<string, unknown>
  modelId?: string | null
  mentionable?: boolean
}

/**
 * Update an agent. Mirrors name/avatar back to the User row in the same tx.
 */
export async function updateAgent(
  agentId: string,
  organizationId: string,
  input: UpdateAgentInput,
  db: Database = defaultDb as Database
): Promise<void> {
  const now = new Date()

  await db.transaction(async (tx) => {
    const [agent] = await tx
      .update(schema.Agent)
      .set({ ...input, updatedAt: now })
      .where(eq(schema.Agent.id, agentId))
      .returning({ userId: schema.Agent.userId })

    if (!agent) throw new Error(`Agent not found: ${agentId}`)

    // Mirror name/avatar to backing User row.
    const userPatch: { name?: string; image?: string | null; updatedAt: Date } = {
      updatedAt: now,
    }
    if (input.name !== undefined) userPatch.name = input.name
    if (input.avatar !== undefined) userPatch.image = input.avatar

    if (Object.keys(userPatch).length > 1) {
      await tx.update(schema.User).set(userPatch).where(eq(schema.User.id, agent.userId))
    }
  })

  try {
    await onCacheEvent('agent.updated', { orgId: organizationId })
  } catch (err) {
    logger.warn('Failed to invalidate caches after agent update', {
      organizationId,
      agentId,
      error: err instanceof Error ? err.message : String(err),
    })
  }
}

/**
 * Archive an agent (soft delete). Bans the backing User so any auth-leak path
 * also rejects, but leaves OrganizationMember intact so historical
 * attributions still resolve.
 */
export async function archiveAgent(
  agentId: string,
  organizationId: string,
  db: Database = defaultDb as Database
): Promise<void> {
  const now = new Date()

  await db.transaction(async (tx) => {
    const [agent] = await tx
      .update(schema.Agent)
      .set({ archivedAt: now, updatedAt: now })
      .where(eq(schema.Agent.id, agentId))
      .returning({ userId: schema.Agent.userId })

    if (!agent) throw new Error(`Agent not found: ${agentId}`)

    await tx
      .update(schema.User)
      .set({
        banned: true,
        bannedReason: 'agent_archived',
        bannedAt: now,
        updatedAt: now,
      })
      .where(eq(schema.User.id, agent.userId))
  })

  try {
    await onCacheEvent('agent.archived', { orgId: organizationId })
  } catch (err) {
    logger.warn('Failed to invalidate caches after agent archive', {
      organizationId,
      agentId,
      error: err instanceof Error ? err.message : String(err),
    })
  }
}
