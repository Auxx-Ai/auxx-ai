// packages/lib/src/agents/agent-service.ts

import {
  type AgentConfig,
  type AgentKind,
  type AppAccountBinding,
  type Database,
  database as defaultDb,
  type KnowledgeEntry,
  schema,
  type ToolsetEntry,
} from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { generateId } from '@auxx/utils'
import { and, eq, inArray, isNull, or, sql } from 'drizzle-orm'
import { getAllCachedAgents, getCachedAgentById, getCachedAgents, onCacheEvent } from '../cache'
import { BadRequestError, ForbiddenError } from '../errors'
import { getRealtimeService, publishAgentUpdated } from '../realtime'
import { publishAgentTx } from './agent-version-service'
import type { ToolBindingMap } from './bindings'
import { resolveDefaultToolsets } from './default-toolsets'
import { reconcilePromptMentions, type ToolsetSource } from './prompt-mention-reconciler'
import { getOrgToolCatalog } from './toolset-catalog'

const logger = createScopedLogger('agent-service')

export interface CreateAgentInput {
  organizationId: string
  /** The human creating this agent. */
  createdById: string
  /**
   * Stored on `Agent.config.name` during draft. When the agent later
   * completes setup the value is mirrored onto the synthetic User row.
   * Omit to start the draft nameless — the builder fills it in via
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
   * Invocation surface — `'internal'` (default) or `'chat'`. Immutable after
   * creation; `updateAgent` rejects changes. Phase 2's Create UI is the only
   * caller that sends `'chat'`. See plans/chat/v5.
   */
  kind?: AgentKind
  /**
   * Initial toolset slugs to enable. When omitted, defaults from
   * `resolveDefaultToolsets(orgId)` are inserted with `source='auto_default'`.
   * When provided, caller-supplied slugs are inserted with `source='manual'`.
   */
  toolsetSlugs?: string[]
}

export interface CreatedAgent {
  agentId: string
  /**
   * Always `null` on creation under Option D — the synthetic User row is
   * materialized inside `completeAgentSetup`. See
   * plans/kopilot/agents/dm/option-d-defer-user-plan.md.
   */
  userId: null
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
 * Under Option D the draft Agent row is the **only** row that exists during
 * setup — no synthetic User, no OrganizationMember. Those are materialized
 * inside `completeAgentSetup`. Identity fields the builder receives during
 * setup (`name`, eventually `avatarAssetId`) land on `Agent.config` and are
 * mirrored onto the User on completion.
 *
 * Three `AgentTrigger` rows (mention/assignment/dm) are still inserted
 * here — they reference `agentId` only and are dormant until setup
 * completes (runtime gates on the agent having a backing User).
 *
 * Fires `agent.created` so the agents cache picks the draft up. The
 * `member.added` event is deferred to `completeAgentSetup`.
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
    kind = 'internal',
  } = input

  const now = new Date()
  const toolsetSource: ToolsetSource = input.toolsetSlugs ? 'manual' : 'auto_default'
  const toolsetSlugs = input.toolsetSlugs ?? (await resolveDefaultToolsets(organizationId))
  const toolsetEntries: ToolsetEntry[] = toolsetSlugs.map((slug) => ({
    slug,
    config: {},
    enabled: true,
    source: toolsetSource,
  }))

  const config: AgentConfig | null = name ? { name } : null

  const { agentId } = await db.transaction(async (tx) => {
    // 1. Insert the Agent row with `userId: null`. The synthetic User is
    //    deferred to `completeAgentSetup`. When the caller omits `slug`,
    //    insert with a unique placeholder and back-fill `slug = id` post-
    //    insert so the (organizationId, slug) unique index is satisfied
    //    trivially without pre-generating an id.
    const slugPlaceholder = input.slug ?? `_pending_${generateId()}`
    const [agent] = await tx
      .insert(schema.Agent)
      .values({
        organizationId,
        userId: null,
        createdById,
        slug: slugPlaceholder,
        description,
        prompt,
        kind,
        toolsets: toolsetEntries,
        knowledge: [],
        modelId,
        mentionable,
        config,
      })
      .returning()

    if (!agent) throw new Error('Failed to insert Agent row')

    if (!input.slug) {
      await tx
        .update(schema.Agent)
        .set({ slug: agent.id, updatedAt: now })
        .where(eq(schema.Agent.id, agent.id))
    }

    // 2. Auto-create mention + assignment + dm triggers (enabled by default).
    //    Phase 1.5 / 2: every agent fires when @-mentioned in a comment,
    //    assigned to a ticket, or direct-messaged via the Chat tab /
    //    composer sender picker. Cascade on agentId cleans these up when
    //    the agent is archived/deleted. Dormant until setup completes —
    //    runtime gates on the agent having a backing User.
    await tx.insert(schema.AgentTrigger).values([
      {
        agentId: agent.id,
        organizationId,
        kind: 'mention',
        enabled: true,
        config: {},
        createdById,
        updatedAt: now,
      },
      {
        agentId: agent.id,
        organizationId,
        kind: 'assignment',
        enabled: true,
        config: {},
        createdById,
        updatedAt: now,
      },
      {
        agentId: agent.id,
        organizationId,
        kind: 'dm',
        enabled: true,
        config: {},
        createdById,
        updatedAt: now,
      },
    ])

    return { agentId: agent.id }
  })

  try {
    await onCacheEvent('agent.created', { orgId: organizationId })
  } catch (err) {
    logger.warn('Failed to invalidate caches after agent create', {
      organizationId,
      agentId,
      error: err instanceof Error ? err.message : String(err),
    })
  }
  await publishAgentUpdated(getRealtimeService(), organizationId, { agentId })

  return { agentId, userId: null, toolsetSlugs, toolsetSource }
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
  /**
   * Per-app credential bindings. Each entry is merged into
   * `Agent.appAccounts`; pass `null` for an app id to clear that binding.
   * Service validates each credId belongs to `organizationId` and is either
   * a workspace cred or owned by `Agent.createdById`. See
   * plans/kopilot/apps/agent-credentials.md §5.5.
   */
  appAccounts?: Record<string, AppAccountBinding | null>
}

/**
 * Update an agent. Name updates route to the backing User row when one
 * exists (post-setup); otherwise they merge into `Agent.config.name`.
 * Avatar changes go through the standard user-avatar upload flow against
 * `agent.userId` (not this function). Archive transitions also toggle the
 * backing User's banned state — only valid on completed agents.
 */
export async function updateAgent(
  agentId: string,
  organizationId: string,
  input: UpdateAgentInput,
  db: Database = defaultDb as Database
): Promise<void> {
  // `kind` is chosen once at creation and immutable thereafter — it changes
  // an agent's whole invocation surface (toolset catalog, runtime path). It
  // is intentionally absent from `UpdateAgentInput`; this guard defends the
  // contract against untyped / pass-through callers (e.g. tRPC input bleed).
  if ('kind' in input) {
    throw new BadRequestError("An agent's kind cannot be changed after creation.")
  }

  const now = new Date()
  const archiveTransition = 'archivedAt' in input

  // When the prompt changes, also reconcile `Agent.toolsets` /
  // `Agent.knowledge` from the Tiptap doc so mention-sourced entries stay in
  // sync with what's actually referenced in the prompt. Catalog lookup happens
  // outside the tx; the tx takes a row lock so concurrent autosaves serialize.
  const toolCatalog = input.prompt !== undefined ? await getOrgToolCatalog(organizationId) : null

  // appAccounts validation runs outside the tx — we only need to know each
  // credId is visible to the agent's creator (workspace cred, or personal
  // cred owned by createdById). Done before the tx so we fail fast.
  if (input.appAccounts !== undefined) {
    await validateAppAccountBindings(agentId, organizationId, input.appAccounts, db)
  }

  await db.transaction(async (tx) => {
    const { name: _name, appAccounts: _appAccounts, ...agentPatch } = input
    const patch: Record<string, unknown> = { ...agentPatch, updatedAt: now }

    const [current] = await tx
      .select({
        userId: schema.Agent.userId,
        toolsets: schema.Agent.toolsets,
        knowledge: schema.Agent.knowledge,
        appAccounts: schema.Agent.appAccounts,
        config: schema.Agent.config,
      })
      .from(schema.Agent)
      .where(eq(schema.Agent.id, agentId))
      .for('update')
      .limit(1)
    if (!current) throw new Error(`Agent not found: ${agentId}`)

    if (input.appAccounts !== undefined) {
      const next: Record<string, AppAccountBinding> = { ...(current.appAccounts ?? {}) }
      for (const [appId, entry] of Object.entries(input.appAccounts)) {
        if (entry === null) delete next[appId]
        else next[appId] = entry
      }
      patch.appAccounts = next
    }

    if (input.prompt !== undefined && toolCatalog) {
      const reconciled = reconcilePromptMentions({
        prompt: input.prompt,
        current: { toolsets: current.toolsets ?? [], knowledge: current.knowledge ?? [] },
        toolCatalog,
      })
      patch.toolsets = reconciled.toolsets
      patch.knowledge = reconciled.knowledge
    }

    // Flip the dirty flag only for versioned behavior fields (prompt drags its
    // reconciled toolsets/knowledge with it; modelId and appAccounts are
    // versioned too). Identity/lifecycle edits (name/slug/description/
    // mentionable/archivedAt) never mark dirty. The SQL guard sets it true only
    // when an active version exists — pre-setup drafts have no baseline.
    const behaviorChanged =
      input.prompt !== undefined || input.modelId !== undefined || input.appAccounts !== undefined
    if (behaviorChanged) {
      patch.hasUnpublishedChanges = sql`${schema.Agent.activeVersionId} is not null`
    }

    if (input.name !== undefined && !current.userId) {
      // Pre-setup: stash the name on Agent.config. After completion the
      // builder/admin paths write through to User.name and the read path
      // prefers User over config.
      patch.config = { ...(current.config ?? {}), name: input.name }
    }

    if (archiveTransition && !current.userId) {
      // Archiving an agent that never completed setup is meaningless —
      // there is no User to ban and no consumer that surfaces it. The
      // admin path uses `deleteDraftAgent` for drafts; defend against
      // mis-routed calls so we don't trip the User update below.
      throw new BadRequestError('Cannot archive an agent that has not completed setup.')
    }

    await tx.update(schema.Agent).set(patch).where(eq(schema.Agent.id, agentId))

    if (!current.userId) return

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
      await tx.update(schema.User).set(userPatch).where(eq(schema.User.id, current.userId))
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
  await publishAgentUpdated(getRealtimeService(), organizationId, { agentId })
}

/**
 * Mark an agent's chat-driven setup mode as complete. Idempotent on
 * already-completed agents. Flips the rail UI from the setup carousel to the
 * Prompt/Tools/Knowledge tabs.
 *
 * Under Option D this is also where the **synthetic User + OrganizationMember
 * rows are materialized** — the draft Agent has `userId IS NULL` until this
 * function runs. The User row mirrors the User-owned keys from
 * `Agent.config` (currently `name`, `avatarAssetId`); non-User-owned keys
 * (`color`, `iconId`) stay on `config`.
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

  // Already complete — preserve idempotent behavior.
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

  const name = detail.name.trim()
  const now = new Date()

  const completed = await db.transaction(async (tx) => {
    // Re-read the row inside the txn to fetch `config` + `userId` under a
    // lock. Skip if another writer beat us to it (idempotency).
    const [row] = await tx
      .select({
        userId: schema.Agent.userId,
        config: schema.Agent.config,
        setupCompletedAt: schema.Agent.setupCompletedAt,
      })
      .from(schema.Agent)
      .where(and(eq(schema.Agent.id, agentId), eq(schema.Agent.organizationId, organizationId)))
      .for('update')
      .limit(1)
    if (!row) return false
    if (row.setupCompletedAt) return false

    // If a User already exists (legacy pre-D draft) just flip the flag, then
    // publish v1 so every set-up agent always has an active version.
    if (row.userId) {
      await tx
        .update(schema.Agent)
        .set({ setupCompletedAt: now, updatedAt: now })
        .where(eq(schema.Agent.id, agentId))
      await publishAgentTx(tx, { organizationId, agentId, label: 'Initial version' })
      return true
    }

    const config = (row.config ?? {}) as AgentConfig
    const avatarAssetId = config.avatarAssetId ?? null

    // Insert the synthetic User. emailVerified: true skips any
    // email-verification trigger. The sentinel email is non-routable.
    const [user] = await tx
      .insert(schema.User)
      .values({
        name,
        email: agentSentinelEmail(agentId),
        userType: 'AGENT',
        emailVerified: true,
        avatarAssetId,
        updatedAt: now,
      })
      .returning()
    if (!user) throw new Error('Failed to insert agent User row')

    // OrganizationMember — role='USER', status='ACTIVE'. DO NOT increment
    // PlanSubscription.seats, DO NOT push Stripe, DO NOT send invite emails.
    await tx.insert(schema.OrganizationMember).values({
      userId: user.id,
      organizationId,
      role: 'USER',
      status: 'ACTIVE',
      updatedAt: now,
    })

    await tx
      .update(schema.Agent)
      .set({ userId: user.id, setupCompletedAt: now, updatedAt: now })
      .where(eq(schema.Agent.id, agentId))

    // Auto-publish v1 inside the same transaction so production always runs a
    // frozen version (see plans/agents/agent-versions/build-plan.md §2.2).
    await publishAgentTx(tx, { organizationId, agentId, label: 'Initial version' })

    return true
  })

  if (!completed) return

  try {
    await onCacheEvent('member.added', { orgId: organizationId })
    await onCacheEvent('agent.updated', { orgId: organizationId })
  } catch (err) {
    logger.warn('Failed to invalidate caches after agent setup complete', {
      organizationId,
      agentId,
      error: err instanceof Error ? err.message : String(err),
    })
  }
  await publishAgentUpdated(getRealtimeService(), organizationId, { agentId })
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
  const result = await db.transaction(async (tx) => {
    const [agent] = await tx
      .select({
        id: schema.Agent.id,
        userId: schema.Agent.userId,
        setupCompletedAt: schema.Agent.setupCompletedAt,
      })
      .from(schema.Agent)
      .where(and(eq(schema.Agent.id, agentId), eq(schema.Agent.organizationId, organizationId)))
      .limit(1)
    if (!agent) return { deleted: false, hadUser: false }
    if (agent.setupCompletedAt) return { deleted: false, hadUser: false }

    // AgentTrigger rows cascade off the Agent. Toolsets/knowledge live on
    // the row itself, so deleting the Agent drops them. The synthetic
    // User exists only for pre-D drafts (and any test fixtures); under
    // Option D a draft has `userId IS NULL` and there is no User to
    // clean up.
    await tx.delete(schema.Agent).where(eq(schema.Agent.id, agentId))
    if (agent.userId) {
      await tx.delete(schema.User).where(eq(schema.User.id, agent.userId))
    }
    return { deleted: true, hadUser: agent.userId !== null }
  })

  if (!result.deleted) return { deleted: false }

  try {
    if (result.hadUser) {
      await onCacheEvent('member.removed', { orgId: organizationId })
    }
    await onCacheEvent('agent.archived', { orgId: organizationId })
  } catch (err) {
    logger.warn('Failed to invalidate caches after draft delete', {
      organizationId,
      agentId,
      error: err instanceof Error ? err.message : String(err),
    })
  }
  await publishAgentUpdated(getRealtimeService(), organizationId, { agentId })

  return { deleted: true }
}

/**
 * Permanently delete an agent, regardless of setup state. Used by the agents
 * list overflow "Delete" item and the detail-page actions menu. Unlike
 * `deleteDraftAgent`, this also removes completed agents.
 *
 * The `Agent` row is dropped — `AgentTrigger` / `AgentProcedure` cascade off it,
 * while `AiAgentSession` / `ChatWidget` references are nulled (FK set-null), so
 * conversation history survives orphaned. The synthetic `User` (present once an
 * agent completes setup) is deleted too, which cascades its `OrganizationMember`
 * row. No Stripe / seat changes — completion never incremented seats.
 */
export async function deleteAgent(
  agentId: string,
  organizationId: string,
  db: Database = defaultDb as Database
): Promise<{ deleted: boolean }> {
  const result = await db.transaction(async (tx) => {
    const [agent] = await tx
      .select({ id: schema.Agent.id, userId: schema.Agent.userId })
      .from(schema.Agent)
      .where(and(eq(schema.Agent.id, agentId), eq(schema.Agent.organizationId, organizationId)))
      .limit(1)
    if (!agent) return { deleted: false, hadUser: false }

    await tx.delete(schema.Agent).where(eq(schema.Agent.id, agentId))
    if (agent.userId) {
      await tx.delete(schema.User).where(eq(schema.User.id, agent.userId))
    }
    return { deleted: true, hadUser: agent.userId !== null }
  })

  if (!result.deleted) return { deleted: false }

  try {
    if (result.hadUser) {
      await onCacheEvent('member.removed', { orgId: organizationId })
    }
    await onCacheEvent('agent.deleted', { orgId: organizationId })
  } catch (err) {
    logger.warn('Failed to invalidate caches after agent delete', {
      organizationId,
      agentId,
      error: err instanceof Error ? err.message : String(err),
    })
  }
  await publishAgentUpdated(getRealtimeService(), organizationId, { agentId })

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
  /** `null` while the agent is a draft (pre-`completeAgentSetup`). */
  userId: string | null
  createdById: string
  /** `null` until the builder writes a real one via `update_agent_identity`. */
  name: string | null
  slug: string
  description: string | null
  avatarUrl: string | null
  /** Invocation surface — `'internal'` (default) or `'chat'`. Immutable. */
  kind: AgentKind
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
  userId: string | null
  createdById: string
  name: string | null
  slug: string
  description: string | null
  avatarUrl: string | null
  kind: AgentKind
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
    kind: a.kind,
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
  toolsets: ToolsetEntry[]
  knowledge: KnowledgeEntry[]
  appAccounts: Record<string, AppAccountBinding>
  /**
   * Per-agent tool-binding **override** map (`tool → input → VarSource`).
   * Usually empty — author defaults (`inputBindings`) cover the common case.
   * Surfaced so the agent detail UI can render the Bindings section.
   * See plans/chat/v8 phase-5.
   */
  toolRestrictions: ToolBindingMap
  /** The published version production runs; `null` while a pre-setup draft. */
  activeVersionId: string | null
  /** Number of {@link activeVersionId}; `null` when never published. */
  activeVersionNumber: number | null
  /** Whether the draft (this view's behavior fields) diverges from the active version. */
  hasUnpublishedChanges: boolean
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

  // The cache serves the ACTIVE-version view; the builder must edit the DRAFT.
  // Overlay the six behavior fields plus version metadata from a direct Agent-row
  // read (one indexed PK select + a LEFT join for the active version number).
  // Identity/presentation (name, avatarUrl, triggers, procedures) keep the
  // cached values. See plans/agents/agent-versions/build-plan.md §4.2′.
  const [row] = await db
    .select({
      prompt: schema.Agent.prompt,
      toolsets: schema.Agent.toolsets,
      knowledge: schema.Agent.knowledge,
      appAccounts: schema.Agent.appAccounts,
      toolRestrictions: schema.Agent.toolRestrictions,
      modelId: schema.Agent.modelId,
      activeVersionId: schema.Agent.activeVersionId,
      hasUnpublishedChanges: schema.Agent.hasUnpublishedChanges,
      activeVersionNumber: schema.AgentVersion.versionNumber,
    })
    .from(schema.Agent)
    .leftJoin(schema.AgentVersion, eq(schema.AgentVersion.id, schema.Agent.activeVersionId))
    .where(and(eq(schema.Agent.id, agentId), eq(schema.Agent.organizationId, organizationId)))
    .limit(1)
  if (!row) return null

  return {
    ...toAgentSummary(cached),
    organizationId,
    // Draft view (the Agent row) — overrides the cached active-view behavior.
    prompt: (row.prompt ?? {}) as Record<string, unknown>,
    toolsets: row.toolsets ?? [],
    knowledge: row.knowledge ?? [],
    appAccounts: row.appAccounts ?? {},
    toolRestrictions: (row.toolRestrictions ?? {}) as ToolBindingMap,
    modelId: row.modelId ?? null,
    activeVersionId: row.activeVersionId ?? null,
    activeVersionNumber: row.activeVersionNumber ?? null,
    hasUnpublishedChanges: row.hasUnpublishedChanges,
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

/**
 * Verify each non-null appAccounts entry's `credId` resolves to a
 * `WorkflowCredentials` row in this org that is either workspace-scoped
 * (`userId IS NULL`) or owned by the agent's creator. Rejects with
 * `ForbiddenError` for any cred pointing at a different teammate's
 * personal cred (or at a row in another org). See
 * plans/kopilot/apps/agent-credentials.md §5.5.
 */
async function validateAppAccountBindings(
  agentId: string,
  organizationId: string,
  bindings: Record<string, AppAccountBinding | null>,
  db: Database
): Promise<void> {
  const credIds = Object.values(bindings)
    .filter((b): b is AppAccountBinding => b !== null)
    .map((b) => b.credId)
  if (credIds.length === 0) return

  const cached = await getCachedAgentById(organizationId, agentId)
  if (!cached) throw new BadRequestError(`Agent not found: ${agentId}`)
  const createdById = cached.createdById

  const rows = await db
    .select({
      id: schema.WorkflowCredentials.id,
      userId: schema.WorkflowCredentials.userId,
    })
    .from(schema.WorkflowCredentials)
    .where(
      and(
        eq(schema.WorkflowCredentials.organizationId, organizationId),
        eq(schema.WorkflowCredentials.type, 'app-connection'),
        inArray(schema.WorkflowCredentials.id, credIds),
        or(
          isNull(schema.WorkflowCredentials.userId),
          eq(schema.WorkflowCredentials.userId, createdById)
        )
      )
    )
  const visible = new Set(rows.map((r) => r.id))
  for (const credId of credIds) {
    if (!visible.has(credId)) {
      throw new ForbiddenError(`Credential ${credId} is not available to this agent`)
    }
  }
}
