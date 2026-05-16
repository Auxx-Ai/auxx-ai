// packages/lib/src/agents/agent-service.ts

import {
  type AgentResourceScopeEntity,
  type AgentToolsetEntity,
  type Database,
  database as defaultDb,
  type PinnedRecord,
  schema,
} from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { generateId } from '@auxx/utils'
import { and, eq, isNull } from 'drizzle-orm'
import { getAllCachedAgents, getCachedAgentById, getCachedAgents, onCacheEvent } from '../cache'
import { BadRequestError } from '../errors'
import { resolveDefaultToolsets } from './default-toolsets'

const logger = createScopedLogger('agent-service')

export interface CreateAgentInput {
  organizationId: string
  /** The human creating this agent. */
  createdById: string
  /**
   * Written to the backing User row. Omit to leave `User.name = null` —
   * setup-mode drafts start nameless and the builder fills it in via
   * `update_agent_identity`. UI sites fall back to "Untitled agent".
   */
  name?: string | null
  /**
   * URL/mention slug. Omit during chat-driven creation; the service writes
   * `slug = agentId` so the row satisfies the unique (orgId, slug) index
   * without any slug-generation concern.
   */
  slug?: string
  description?: string | null
  prompt?: Record<string, unknown>
  modelId?: string | null
  mentionable?: boolean
  /**
   * Initial toolset slugs to enable. When omitted, defaults from
   * `resolveDefaultToolsets(orgId)` are inserted with `source='auto_default'`.
   * When provided, caller-supplied slugs are inserted with `source='manual'`.
   */
  toolsetSlugs?: string[]
}

export interface CreatedAgent {
  agentId: string
  userId: string
  /** Toolset slugs inserted alongside the agent. */
  toolsetSlugs: string[]
  /** Source applied to the toolset rows (manual vs auto_default). */
  toolsetSource: 'manual' | 'auto_default'
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
    name = null,
    description = null,
    prompt = {},
    modelId = null,
    mentionable = true,
  } = input

  const now = new Date()
  const toolsetSource: 'manual' | 'auto_default' = input.toolsetSlugs ? 'manual' : 'auto_default'
  const toolsetSlugs = input.toolsetSlugs ?? (await resolveDefaultToolsets(organizationId))

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
    //    on the backing User row (User.name, User.avatarAssetId). When the
    //    caller omits `slug`, insert with a unique placeholder and back-
    //    fill `slug = id` post-insert so the (organizationId, slug)
    //    unique index is satisfied trivially without an extra round trip
    //    for id pre-generation.
    const slugPlaceholder = input.slug ?? `_pending_${generateId()}`
    const [agent] = await tx
      .insert(schema.Agent)
      .values({
        organizationId,
        userId: user.id,
        createdById,
        slug: slugPlaceholder,
        description,
        prompt,
        modelId,
        mentionable,
      })
      .returning()

    if (!agent) throw new Error('Failed to insert Agent row')

    if (!input.slug) {
      await tx
        .update(schema.Agent)
        .set({ slug: agent.id, updatedAt: now })
        .where(eq(schema.Agent.id, agent.id))
    }

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

    // 5. AgentToolset rows. Auto-defaults when caller omitted toolsetSlugs;
    //    explicit choices land as `manual`.
    if (toolsetSlugs.length > 0) {
      await tx.insert(schema.AgentToolset).values(
        toolsetSlugs.map((toolsetSlug) => ({
          agentId: agent.id,
          toolsetSlug,
          source: toolsetSource,
          enabled: true,
          config: {},
          updatedAt: now,
        }))
      )
    }

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

  return { agentId, userId, toolsetSlugs, toolsetSource }
}

export interface UpdateAgentInput {
  /** Routed to the backing User row, not stored on Agent. */
  name?: string
  /** URL/mention slug. Caller must enforce uniqueness via `isAgentSlugTaken`. */
  slug?: string
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
 * Mark an agent's chat-driven setup mode as complete. Idempotent on
 * already-completed agents. Flips the rail UI from the setup carousel to the
 * Prompt/Tools/Knowledge tabs. The agent is functionally live throughout
 * setup; this only gates the UI surface.
 *
 * Rejects with `BadRequestError` if the agent does not yet have the minimum
 * configuration the carousel was meant to enforce: a non-empty persona
 * prompt, at least one toolset, and a name. Guards both the chat-builder
 * tool and the rail's "Mark setup complete" escape hatch from shipping a
 * half-built agent past the carousel.
 */
export async function completeAgentSetup(
  agentId: string,
  organizationId: string,
  db: Database = defaultDb as Database
): Promise<void> {
  const detail = await getAgentDetail(organizationId, agentId, db)
  if (!detail) throw new BadRequestError(`Agent not found: ${agentId}`)

  // Already complete — preserve previous idempotent behavior.
  if (detail.setupCompletedAt) return

  if (isEmptyPromptDoc(detail.prompt)) {
    throw new BadRequestError('Add a persona prompt before completing setup.')
  }
  if ((detail.toolsets ?? []).length === 0) {
    throw new BadRequestError('Enable at least one toolset before completing setup.')
  }
  if (!detail.name || detail.name.trim() === '') {
    throw new BadRequestError('Give the agent a name before completing setup.')
  }

  const result = await db
    .update(schema.Agent)
    .set({ setupCompletedAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        eq(schema.Agent.id, agentId),
        eq(schema.Agent.organizationId, organizationId),
        isNull(schema.Agent.setupCompletedAt)
      )
    )
    .returning({ id: schema.Agent.id })

  if (result.length === 0) return

  try {
    await onCacheEvent('agent.updated', { orgId: organizationId })
  } catch (err) {
    logger.warn('Failed to invalidate caches after agent setup complete', {
      organizationId,
      agentId,
      error: err instanceof Error ? err.message : String(err),
    })
  }
}

/**
 * True when the prompt doc has no real content. Mirrors the client-side
 * `isEmptyTiptapDoc` check in `derive-setup-step.ts` and also accepts the
 * KB block shape (`{ blockType: 'text' }` with an empty `content` array)
 * the persona editor uses today.
 */
function isEmptyPromptDoc(doc: Record<string, unknown> | null | undefined): boolean {
  if (!doc) return true
  const content = (doc as { content?: unknown[] }).content
  if (!Array.isArray(content) || content.length === 0) return true
  if (content.length === 1) {
    const node = content[0] as { type?: string; content?: unknown[] }
    if (!node) return true
    // Empty Tiptap paragraph.
    if (node.type === 'paragraph' && (!node.content || node.content.length === 0)) return true
    // Empty KB-block placeholder (`mdToBlocks` emits this for empty input).
    if (node.type === 'block' && (!node.content || node.content.length === 0)) return true
  }
  return false
}

/**
 * Hard-delete a draft agent (one with `setupCompletedAt IS NULL`). Used by
 * the agents-list "Discard draft" overflow item. Completed agents take the
 * archive path instead; this helper refuses to touch them so a stray call
 * cannot wipe production agents.
 */
export async function deleteDraftAgent(
  agentId: string,
  organizationId: string,
  db: Database = defaultDb as Database
): Promise<{ deleted: boolean }> {
  const deleted = await db.transaction(async (tx) => {
    const [agent] = await tx
      .select({
        id: schema.Agent.id,
        userId: schema.Agent.userId,
        setupCompletedAt: schema.Agent.setupCompletedAt,
      })
      .from(schema.Agent)
      .where(and(eq(schema.Agent.id, agentId), eq(schema.Agent.organizationId, organizationId)))
      .limit(1)
    if (!agent) return false
    if (agent.setupCompletedAt) return false

    // Cascades from Agent → AgentToolset / AgentResourceScope take care of
    // their rows. OrganizationMember rows fan-cascade off User. We delete
    // the Agent first to drop those, then drop the synthetic User.
    await tx.delete(schema.Agent).where(eq(schema.Agent.id, agentId))
    await tx.delete(schema.User).where(eq(schema.User.id, agent.userId))
    return true
  })

  if (!deleted) return { deleted: false }

  try {
    await onCacheEvent('member.removed', { orgId: organizationId })
    await onCacheEvent('agent.archived', { orgId: organizationId })
  } catch (err) {
    logger.warn('Failed to invalidate caches after draft delete', {
      organizationId,
      agentId,
      error: err instanceof Error ? err.message : String(err),
    })
  }

  return { deleted: true }
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

/**
 * Summary row for admin listings. Sourced entirely from the org cache.
 */
export interface AgentSummary {
  id: string
  userId: string
  createdById: string
  /** `null` until the builder writes a real one via `update_agent_identity`. */
  name: string | null
  slug: string
  description: string | null
  avatarUrl: string | null
  mentionable: boolean
  modelId: string | null
  /** ISO string when chat-driven setup completed; null while in setup mode. */
  setupCompletedAt: string | null
  archivedAt: string | null
  createdAt: string
  updatedAt: string
}

/**
 * List agents for the admin UI. Read flows entirely through the org cache;
 * pass `includeArchived: true` to include soft-deleted rows.
 */
export async function listAgents(
  organizationId: string,
  options: { includeArchived?: boolean } = {}
): Promise<AgentSummary[]> {
  const all = options.includeArchived
    ? await getAllCachedAgents(organizationId)
    : await getCachedAgents(organizationId)
  return all.map(toAgentSummary)
}

function toAgentSummary(a: {
  id: string
  userId: string
  createdById: string
  name: string | null
  slug: string
  description: string | null
  avatarUrl: string | null
  mentionable: boolean
  modelId: string | null
  setupCompletedAt: string | null
  archivedAt: string | null
  createdAt: string
  updatedAt: string
}): AgentSummary {
  return {
    id: a.id,
    userId: a.userId,
    createdById: a.createdById,
    name: a.name && a.name.length > 0 ? a.name : null,
    slug: a.slug,
    description: a.description,
    avatarUrl: a.avatarUrl,
    mentionable: a.mentionable,
    modelId: a.modelId,
    setupCompletedAt: a.setupCompletedAt,
    archivedAt: a.archivedAt,
    createdAt: a.createdAt,
    updatedAt: a.updatedAt,
  }
}

/**
 * Full admin-detail view of one agent. Combines the cached agent row with
 * (uncached) toolset + resource-scope rows read in one DB round trip each.
 * Returns `null` when the agent does not exist for this org.
 */
export interface AgentDetail extends AgentSummary {
  organizationId: string
  prompt: Record<string, unknown>
  pinnedRecords: PinnedRecord[]
  toolsets: AgentToolsetEntity[]
  resourceScopes: AgentResourceScopeEntity[]
}

/**
 * Resolve an agent by id or slug, returning the full admin-detail view.
 *
 * Lookup flows through the org agents cache (which contains every agent in
 * the org, including archived rows), so a single network roundtrip resolves
 * either identifier. Returns `null` when neither identifier matches.
 */
export async function getAgentDetailByIdOrSlug(
  organizationId: string,
  idOrSlug: string,
  db: Database = defaultDb as Database
): Promise<AgentDetail | null> {
  const all = await getAllCachedAgents(organizationId)
  const match = all.find((a) => a.id === idOrSlug || a.slug === idOrSlug)
  if (!match) return null
  return getAgentDetail(organizationId, match.id, db)
}

export async function getAgentDetail(
  organizationId: string,
  agentId: string,
  db: Database = defaultDb as Database
): Promise<AgentDetail | null> {
  const cached = await getCachedAgentById(organizationId, agentId)
  if (!cached) return null

  const [toolsets, resourceScopes] = await Promise.all([
    db.select().from(schema.AgentToolset).where(eq(schema.AgentToolset.agentId, agentId)),
    db
      .select()
      .from(schema.AgentResourceScope)
      .where(
        and(
          eq(schema.AgentResourceScope.agentId, agentId),
          eq(schema.AgentResourceScope.organizationId, organizationId)
        )
      ),
  ])

  return {
    ...toAgentSummary(cached),
    organizationId,
    prompt: cached.prompt,
    pinnedRecords: cached.pinnedRecords,
    toolsets,
    resourceScopes,
  }
}

/**
 * Returns true when an active or archived agent owns the given slug in this
 * org. Optionally excludes one agent (used by `update`-style slug checks).
 */
export async function isAgentSlugTaken(
  organizationId: string,
  slug: string,
  options: { excludeAgentId?: string } = {}
): Promise<boolean> {
  const all = await getAllCachedAgents(organizationId)
  return all.some((a) => a.slug === slug && a.id !== options.excludeAgentId)
}

/**
 * Cache-backed existence guard. Use in routers to keep org-scope enforcement
 * out of raw SQL. Includes archived agents so callers can act on them.
 */
export async function agentExistsInOrg(organizationId: string, agentId: string): Promise<boolean> {
  return (await getCachedAgentById(organizationId, agentId)) !== null
}
