// packages/lib/src/actors/actor-service.ts

import type {
  Actor,
  ActorContext,
  ActorId,
  AgentActor,
  GroupActor,
  SystemActor,
  UserActor,
} from '@auxx/types/actor'
import { parseActorId, toActorId } from '@auxx/types/actor'
import {
  type CachedAgent,
  type CachedGroup,
  getCachedAgents,
  getCachedAgentsByIds,
  getCachedAgentsByUserIds,
  getCachedGroups,
  getCachedMembers,
  getCachedMembersByUserIds,
  type OrgMemberInfo,
} from '../cache'
import { SystemUserService } from '../users/system-user-service'

// ============================================================================
// Service Options Types
// ============================================================================

/** Options for listing actors */
export interface ListActorsOptions {
  /**
   * Filter to specific target.
   * - 'user': humans only
   * - 'group': groups only
   * - 'agent': agents only
   * - 'both': humans + groups (default; agents excluded unless includeAgents is true)
   * - 'all': humans + groups + agents
   */
  target?: 'user' | 'group' | 'agent' | 'both' | 'all'
  /** Filter users by role */
  roles?: ('OWNER' | 'ADMIN' | 'USER')[]
  /** Filter to specific group IDs */
  groupIds?: string[]
  /** Include only groups user can access (default: true) */
  accessibleGroupsOnly?: boolean
  /**
   * When target is 'both', include agents alongside humans.
   * Default: false. Set automatically when target is 'agent' or 'all'.
   */
  includeAgents?: boolean
}

/** Options for searching actors */
export interface SearchActorsOptions extends ListActorsOptions {
  /** Search query */
  query: string
  /** Maximum results to return */
  limit?: number
}

// ============================================================================
// ActorService
// ============================================================================

/**
 * Service for resolving and listing actors (users, groups, agents, system).
 * Provides methods to list, search, and batch resolve actors.
 */
export class ActorService {
  private db: ActorContext['db']
  private organizationId: string
  private userId: string

  constructor(ctx: ActorContext) {
    this.db = ctx.db
    this.organizationId = ctx.organizationId
    this.userId = ctx.userId
  }

  /**
   * List all available actors for the organization.
   * Used for preloading and dropdown selection.
   */
  async listActors(options: ListActorsOptions = {}): Promise<Actor[]> {
    const target = options.target ?? 'both'
    const includeAgents = options.includeAgents ?? (target === 'agent' || target === 'all')
    const results: Actor[] = []

    if (target === 'user' || target === 'both' || target === 'all') {
      const users = await this.listUsers(options.roles)
      results.push(...users)
    }

    if (target === 'agent' || target === 'all' || (target === 'both' && includeAgents)) {
      const agents = await this.listAgents()
      results.push(...agents)
    }

    if (target === 'group' || target === 'both' || target === 'all') {
      const groups = await this.listGroups(options)
      results.push(...groups)
    }

    return results
  }

  /**
   * Get multiple actors by ActorId.
   * Used for batch hydration of ACTOR field values.
   */
  async getByIds(actorIds: ActorId[]): Promise<Map<ActorId, Actor>> {
    const result = new Map<ActorId, Actor>()
    if (actorIds.length === 0) return result

    // Partition by type
    const userIds: string[] = []
    const groupIds: string[] = []
    const agentIds: string[] = []

    for (const actorId of actorIds) {
      try {
        const { type, id } = parseActorId(actorId)
        if (type === 'user') userIds.push(id)
        else if (type === 'group') groupIds.push(id)
        else if (type === 'agent') agentIds.push(id)
      } catch {}
    }

    // Batch fetch
    const [users, groups, agents] = await Promise.all([
      userIds.length > 0 ? this.fetchUsers(userIds) : [],
      groupIds.length > 0 ? this.fetchGroups(groupIds) : [],
      agentIds.length > 0 ? getCachedAgentsByIds(this.organizationId, agentIds) : [],
    ])

    for (const user of users) {
      result.set(user.actorId, user)
    }
    for (const group of groups) {
      result.set(group.actorId, group)
    }
    for (const agent of agents) {
      if (!agent.userId) continue // draft — no actor identity yet
      const actor = this.toAgentActor(agent)
      result.set(actor.actorId, actor)
    }

    // Compatibility shim: many legacy code paths (Thread.assigneeIds,
    // Task.assignedToUserId, ACTOR field rows, attributions, etc.) store an
    // agent reference as the synthetic user id and address it via
    // `user:<userId>`. Resolve those to the canonical AgentActor so display
    // works regardless of which spelling the caller used. The Actor's primary
    // `actorId` stays `agent:<id>` — we just stamp the legacy key in the map.
    const unresolvedUserIds = userIds.filter((id) => !result.has(toActorId('user', id)))
    if (unresolvedUserIds.length > 0) {
      const agentsByUser = await getCachedAgentsByUserIds(this.organizationId, unresolvedUserIds)
      for (const a of agentsByUser) {
        if (!a.userId) continue
        const actor = this.toAgentActor(a)
        result.set(toActorId('user', a.userId), actor)
        result.set(actor.actorId, actor)
      }

      const stillUnresolved = unresolvedUserIds.filter((id) => !result.has(toActorId('user', id)))
      if (stillUnresolved.length > 0) {
        const systemActor = await this.fetchSystemUser()
        if (systemActor) {
          for (const id of stillUnresolved) {
            if (toActorId('user', id) === systemActor.actorId) {
              result.set(systemActor.actorId, systemActor)
            }
          }
        }
      }
    }

    return result
  }

  /**
   * Get a single actor by ActorId.
   */
  async getById(actorId: ActorId): Promise<Actor | null> {
    const { type, id } = parseActorId(actorId)

    if (type === 'agent') {
      const agents = await getCachedAgentsByIds(this.organizationId, [id])
      if (agents[0] && agents[0].userId) return this.toAgentActor(agents[0])
      return null
    }

    if (type === 'user') {
      const users = await this.fetchUsers([id])
      if (users[0]) return users[0]
      // Compatibility shim: legacy callsites still address an agent via the
      // synthetic user id (Thread.assigneeIds, Task assignees, field-value
      // ACTOR rows). Resolve those to the canonical AgentActor.
      const agents = await getCachedAgentsByUserIds(this.organizationId, [id])
      if (agents[0] && agents[0].userId) return this.toAgentActor(agents[0])
      // Org's own system user.
      const systemActor = await this.fetchSystemUser()
      if (systemActor && systemActor.actorId === actorId) return systemActor
      return null
    }

    const groups = await this.fetchGroups([id])
    return groups[0] ?? null
  }

  /**
   * Search actors by name/email.
   */
  async searchActors(options: SearchActorsOptions): Promise<Actor[]> {
    const { query, limit = 20, target = 'both' } = options
    const includeAgents = options.includeAgents ?? (target === 'agent' || target === 'all')
    const results: Actor[] = []
    const searchPattern = `%${query}%`

    if (target === 'user' || target === 'both' || target === 'all') {
      const users = await this.searchUsers(searchPattern, options.roles, limit)
      results.push(...users)
    }

    if (target === 'agent' || target === 'all' || (target === 'both' && includeAgents)) {
      const agents = await this.searchAgents(searchPattern, limit)
      results.push(...agents)
    }

    if (target === 'group' || target === 'both' || target === 'all') {
      const groups = await this.searchGroups(searchPattern, options, limit)
      results.push(...groups)
    }

    // Sort by relevance (exact match first, then alphabetical)
    return results
      .sort((a, b) => {
        const aExact = a.name.toLowerCase().startsWith(query.toLowerCase())
        const bExact = b.name.toLowerCase().startsWith(query.toLowerCase())
        if (aExact && !bExact) return -1
        if (!aExact && bExact) return 1
        return a.name.localeCompare(b.name)
      })
      .slice(0, limit)
  }

  // ─────────────────────────────────────────────────────────────────
  // Private: User Operations
  // ─────────────────────────────────────────────────────────────────

  private async listUsers(roles?: ('OWNER' | 'ADMIN' | 'USER')[]): Promise<UserActor[]> {
    const members = await getCachedMembers(this.organizationId, {
      status: 'ACTIVE',
      roles: roles?.length ? roles : undefined,
    })
    return members
      .filter((m) => m.user && m.user.userType === 'USER')
      .map((m) => this.toUserActorFromCache(m))
  }

  private async fetchUsers(userIds: string[]): Promise<UserActor[]> {
    const members = await getCachedMembersByUserIds(this.organizationId, userIds)
    return members
      .filter((m) => m.user && m.user.userType === 'USER')
      .map((m) => this.toUserActorFromCache(m))
  }

  private async searchUsers(
    pattern: string,
    roles?: ('OWNER' | 'ADMIN' | 'USER')[],
    limit?: number
  ): Promise<UserActor[]> {
    const members = await getCachedMembers(this.organizationId, {
      status: 'ACTIVE',
      roles: roles?.length ? roles : undefined,
    })

    const searchTerm = pattern.replace(/%/g, '').toLowerCase()
    return members
      .filter(
        (m) =>
          m.user &&
          m.user.userType === 'USER' &&
          (m.user.name?.toLowerCase().includes(searchTerm) ||
            m.user.email?.toLowerCase().includes(searchTerm))
      )
      .map((m) => this.toUserActorFromCache(m))
      .slice(0, limit ?? 50)
  }

  private toUserActorFromCache(member: OrgMemberInfo): UserActor {
    return {
      actorId: toActorId('user', member.userId),
      type: 'user',
      name: member.user?.name ?? member.user?.email ?? 'Unknown',
      email: member.user?.email ?? '',
      avatarUrl: member.user?.image ?? null,
      role: member.role as 'OWNER' | 'ADMIN' | 'USER',
    }
  }

  /**
   * Fetch the organization's system user as a SystemActor.
   * System users are linked via Organization.systemUserId, not as org members.
   */
  private async fetchSystemUser(): Promise<SystemActor | null> {
    const user = await SystemUserService.getOrganizationSystemUser(this.organizationId)
    if (!user) return null
    return {
      actorId: toActorId('user', user.id),
      type: 'system',
      name: 'Auxx.ai',
      avatarUrl: user.image ?? null,
    }
  }

  // ─────────────────────────────────────────────────────────────────
  // Private: Agent Operations
  // ─────────────────────────────────────────────────────────────────

  private async listAgents(): Promise<AgentActor[]> {
    const agents = await getCachedAgents(this.organizationId)
    return agents.filter((a) => a.userId !== null).map((a) => this.toAgentActor(a))
  }

  private async searchAgents(pattern: string, limit?: number): Promise<AgentActor[]> {
    const agents = await getCachedAgents(this.organizationId)
    const searchTerm = pattern.replace(/%/g, '').toLowerCase()
    return agents
      .filter(
        (a) =>
          a.userId !== null &&
          ((a.name ?? '').toLowerCase().includes(searchTerm) ||
            a.slug.toLowerCase().includes(searchTerm))
      )
      .map((a) => this.toAgentActor(a))
      .slice(0, limit ?? 50)
  }

  /**
   * Resolve a cached agent to an `AgentActor`. Caller must ensure
   * `agent.userId` is non-null (drafts have no actor identity); this is
   * enforced at every site in this file via a `userId !== null` guard.
   */
  private toAgentActor(agent: CachedAgent): AgentActor {
    if (!agent.userId) {
      throw new Error(`Cannot build AgentActor for draft agent ${agent.id} (no userId)`)
    }
    return {
      actorId: toActorId('agent', agent.id),
      type: 'agent',
      name: agent.name ?? 'Untitled agent',
      avatarUrl: agent.avatarUrl ?? null,
      agentId: agent.id,
      userId: agent.userId,
      slug: agent.slug,
      mentionable: agent.mentionable,
    }
  }

  // ─────────────────────────────────────────────────────────────────
  // Private: Group Operations
  // ─────────────────────────────────────────────────────────────────

  private async listGroups(options: ListActorsOptions): Promise<GroupActor[]> {
    // Use existing listAccessibleGroups for permission filtering
    if (options.accessibleGroupsOnly !== false) {
      const { listAccessibleGroups } = await import('../groups/group-functions')
      const groups = await listAccessibleGroups(
        { db: this.db, organizationId: this.organizationId, userId: this.userId },
        { limit: 100 }
      )

      if (options.groupIds?.length) {
        return groups
          .filter((g) => options.groupIds!.includes(g.id))
          .map((g) => this.toGroupActor(g))
      }

      return groups.map((g) => this.toGroupActor(g))
    }

    // Admin/direct path: use cache
    const cachedGroups = await getCachedGroups(this.organizationId)
    const filtered = options.groupIds?.length
      ? cachedGroups.filter((g) => options.groupIds!.includes(g.id))
      : cachedGroups

    return filtered.map((g) => this.toGroupActorFromCache(g))
  }

  private async fetchGroups(groupIds: string[]): Promise<GroupActor[]> {
    const cachedGroups = await getCachedGroups(this.organizationId)
    const idSet = new Set(groupIds)
    return cachedGroups.filter((g) => idSet.has(g.id)).map((g) => this.toGroupActorFromCache(g))
  }

  private async searchGroups(
    pattern: string,
    options: ListActorsOptions,
    limit: number
  ): Promise<GroupActor[]> {
    const cachedGroups = await getCachedGroups(this.organizationId)
    const searchTerm = pattern.replace(/%/g, '').toLowerCase()

    let filtered = cachedGroups.filter((g) => g.displayName?.toLowerCase().includes(searchTerm))

    if (options.groupIds?.length) {
      filtered = filtered.filter((g) => options.groupIds!.includes(g.id))
    }

    return filtered.slice(0, limit).map((g) => this.toGroupActorFromCache(g))
  }

  private toGroupActor(group: {
    id: string
    displayName: string | null
    secondaryDisplayValue: string | null
    avatarUrl?: string | null
    metadata: unknown
  }): GroupActor {
    const metadata = (group.metadata ?? {}) as {
      memberCount?: number
      visibility?: string
    }

    return {
      actorId: toActorId('group', group.id),
      type: 'group',
      name: group.displayName ?? 'Unnamed Group',
      description: group.secondaryDisplayValue ?? null,
      avatarUrl: group.avatarUrl ?? null,
      memberCount: metadata.memberCount ?? 0,
      visibility: (metadata.visibility as 'public' | 'private') ?? 'private',
    }
  }

  private toGroupActorFromCache(group: CachedGroup): GroupActor {
    return {
      actorId: toActorId('group', group.id),
      type: 'group',
      name: group.displayName ?? 'Unnamed Group',
      description: group.secondaryDisplayValue ?? null,
      avatarUrl: group.avatarUrl ?? null,
      memberCount: group.metadata.memberCount ?? 0,
      visibility: (group.metadata.visibility as 'public' | 'private') ?? 'private',
    }
  }
}
