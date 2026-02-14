// packages/lib/src/actors/actor-service.ts

import { schema } from '@auxx/database'
import type { Actor, ActorContext, ActorId, GroupActor, UserActor } from '@auxx/types/actor'
import { parseActorId, toActorId } from '@auxx/types/actor'
import { and, eq, inArray, like } from 'drizzle-orm'

// ============================================================================
// Service Options Types
// ============================================================================

/** Options for listing actors */
export interface ListActorsOptions {
  /** Filter to specific target: 'user', 'group', or 'both' (default: 'both') */
  target?: 'user' | 'group' | 'both'
  /** Filter users by role */
  roles?: ('OWNER' | 'ADMIN' | 'USER')[]
  /** Filter to specific group IDs */
  groupIds?: string[]
  /** Include only groups user can access (default: true) */
  accessibleGroupsOnly?: boolean
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
 * Service for resolving and listing actors (users and groups).
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
    const results: Actor[] = []

    if (target === 'user' || target === 'both') {
      const users = await this.listUsers(options.roles)
      results.push(...users)
    }

    if (target === 'group' || target === 'both') {
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

    for (const actorId of actorIds) {
      try {
        const { type, id } = parseActorId(actorId)
        if (type === 'user') userIds.push(id)
        else groupIds.push(id)
      } catch {}
    }

    // Batch fetch
    const [users, groups] = await Promise.all([
      userIds.length > 0 ? this.fetchUsers(userIds) : [],
      groupIds.length > 0 ? this.fetchGroups(groupIds) : [],
    ])

    // Map results
    for (const user of users) {
      result.set(user.actorId, user)
    }
    for (const group of groups) {
      result.set(group.actorId, group)
    }

    return result
  }

  /**
   * Get a single actor by ActorId.
   */
  async getById(actorId: ActorId): Promise<Actor | null> {
    const { type, id } = parseActorId(actorId)

    if (type === 'user') {
      const users = await this.fetchUsers([id])
      return users[0] ?? null
    } else {
      const groups = await this.fetchGroups([id])
      return groups[0] ?? null
    }
  }

  /**
   * Search actors by name/email.
   */
  async searchActors(options: SearchActorsOptions): Promise<Actor[]> {
    const { query, limit = 20, target = 'both' } = options
    const results: Actor[] = []
    const searchPattern = `%${query}%`

    if (target === 'user' || target === 'both') {
      const users = await this.searchUsers(searchPattern, options.roles, limit)
      results.push(...users)
    }

    if (target === 'group' || target === 'both') {
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
    const db = this.db as any
    const conditions = [
      eq(schema.OrganizationMember.organizationId, this.organizationId),
      eq(schema.OrganizationMember.status, 'ACTIVE'),
    ]

    if (roles?.length) {
      conditions.push(inArray(schema.OrganizationMember.role, roles))
    }

    const members = await db.query.OrganizationMember.findMany({
      where: and(...conditions),
      with: { user: true },
    })

    return members.map((m: any) => this.toUserActor(m))
  }

  private async fetchUsers(userIds: string[]): Promise<UserActor[]> {
    const db = this.db as any
    const members = await db.query.OrganizationMember.findMany({
      where: and(
        eq(schema.OrganizationMember.organizationId, this.organizationId),
        inArray(schema.OrganizationMember.userId, userIds)
      ),
      with: { user: true },
    })

    return members.map((m: any) => this.toUserActor(m))
  }

  private async searchUsers(
    pattern: string,
    roles?: ('OWNER' | 'ADMIN' | 'USER')[],
    limit?: number
  ): Promise<UserActor[]> {
    const db = this.db as any
    const conditions = [
      eq(schema.OrganizationMember.organizationId, this.organizationId),
      eq(schema.OrganizationMember.status, 'ACTIVE'),
    ]

    if (roles?.length) {
      conditions.push(inArray(schema.OrganizationMember.role, roles))
    }

    const members = await db.query.OrganizationMember.findMany({
      where: and(...conditions),
      with: { user: true },
      limit: limit ?? 50,
    })

    // Filter by search pattern (on user name/email)
    const searchTerm = pattern.replace(/%/g, '').toLowerCase()
    return members
      .filter(
        (m: any) =>
          m.user.name?.toLowerCase().includes(searchTerm) ||
          m.user.email?.toLowerCase().includes(searchTerm)
      )
      .map((m: any) => this.toUserActor(m))
  }

  private toUserActor(member: {
    userId: string
    role: string
    user: { name: string | null; email: string; image: string | null }
  }): UserActor {
    return {
      actorId: toActorId('user', member.userId),
      type: 'user',
      name: member.user.name ?? member.user.email,
      email: member.user.email,
      avatarUrl: member.user.image,
      role: member.role as 'OWNER' | 'ADMIN' | 'USER',
    }
  }

  // ─────────────────────────────────────────────────────────────────
  // Private: Group Operations
  // ─────────────────────────────────────────────────────────────────

  private async listGroups(options: ListActorsOptions): Promise<GroupActor[]> {
    // Get entity_group definition
    const groupDef = await this.getGroupDefinition()
    if (!groupDef) return []

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

    // Direct query (admin use case)
    const db = this.db as any
    const groups = await db.query.EntityInstance.findMany({
      where: and(
        eq(schema.EntityInstance.entityDefinitionId, groupDef.id),
        eq(schema.EntityInstance.organizationId, this.organizationId)
      ),
      limit: 100,
    })

    return groups.map((g: any) => this.toGroupActor(g))
  }

  private async fetchGroups(groupIds: string[]): Promise<GroupActor[]> {
    const db = this.db as any
    const groups = await db.query.EntityInstance.findMany({
      where: and(
        inArray(schema.EntityInstance.id, groupIds),
        eq(schema.EntityInstance.organizationId, this.organizationId)
      ),
    })

    return groups.map((g: any) => this.toGroupActor(g))
  }

  private async searchGroups(
    pattern: string,
    options: ListActorsOptions,
    limit: number
  ): Promise<GroupActor[]> {
    const groupDef = await this.getGroupDefinition()
    if (!groupDef) return []

    const db = this.db as any
    const groups = await db.query.EntityInstance.findMany({
      where: and(
        eq(schema.EntityInstance.entityDefinitionId, groupDef.id),
        eq(schema.EntityInstance.organizationId, this.organizationId),
        like(schema.EntityInstance.displayName, pattern)
      ),
      limit,
    })

    // Filter by groupIds if specified
    if (options.groupIds?.length) {
      return groups
        .filter((g: any) => options.groupIds!.includes(g.id))
        .map((g: any) => this.toGroupActor(g))
    }

    return groups.map((g: any) => this.toGroupActor(g))
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

  private async getGroupDefinition(): Promise<{ id: string } | null> {
    const db = this.db as any
    return db.query.EntityDefinition.findFirst({
      where: and(
        eq(schema.EntityDefinition.entityType, 'entity_group'),
        eq(schema.EntityDefinition.organizationId, this.organizationId)
      ),
      columns: { id: true },
    })
  }
}
