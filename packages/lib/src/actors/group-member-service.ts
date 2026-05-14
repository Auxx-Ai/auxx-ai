// packages/lib/src/actors/group-member-service.ts

import type { ActorContext, ActorId, AgentActor, UserActor } from '@auxx/types/actor'
import { parseActorId, toActorId } from '@auxx/types/actor'
import type { GroupMember } from '@auxx/types/groups'
import { getCachedAgents, getCachedAgentsByUserIds } from '../cache'
import { getGroupsForUser, getMembers } from '../groups/group-functions'

/**
 * Service for group member operations.
 * Extends existing group-functions with actor-focused methods.
 */
export class GroupMemberService {
  private db: ActorContext['db']
  private organizationId: string
  private userId: string

  constructor(ctx: ActorContext) {
    this.db = ctx.db
    this.organizationId = ctx.organizationId
    this.userId = ctx.userId
  }

  /**
   * Get the context object for group functions.
   */
  private get ctx(): ActorContext {
    return {
      db: this.db,
      organizationId: this.organizationId,
      userId: this.userId,
    }
  }

  /**
   * Get all members of a group.
   */
  async getMembers(groupId: string): Promise<GroupMember[]> {
    return getMembers(this.ctx, groupId)
  }

  /**
   * Get only human user members of a group as UserActors.
   * Excludes agents (synthetic users) — use getAgentActors for those, or
   * getAllMemberActors for both.
   */
  async getUserActors(groupId: string): Promise<UserActor[]> {
    const members = await getMembers(this.ctx, groupId)
    if (members.length === 0) return []

    const candidateIds = members
      .filter((m) => m.memberType === 'user' && m.user)
      .map((m) => m.memberRefId)

    const agentUserIds = new Set(
      (await getCachedAgentsByUserIds(this.organizationId, candidateIds)).map((a) => a.userId)
    )

    return members
      .filter((m) => m.memberType === 'user' && m.user && !agentUserIds.has(m.memberRefId))
      .map((m) => ({
        actorId: toActorId('user', m.memberRefId),
        type: 'user' as const,
        name: m.user!.name ?? m.user!.email ?? 'Unknown',
        email: m.user!.email ?? '',
        avatarUrl: m.user!.image ?? null,
        role: 'USER' as const,
      }))
  }

  /**
   * Get only agent members of a group as AgentActors.
   */
  async getAgentActors(groupId: string): Promise<AgentActor[]> {
    const members = await getMembers(this.ctx, groupId)
    if (members.length === 0) return []

    const candidateIds = members
      .filter((m) => m.memberType === 'user' && m.user)
      .map((m) => m.memberRefId)

    const agents = await getCachedAgentsByUserIds(this.organizationId, candidateIds)
    return agents.map((a) => ({
      actorId: toActorId('user', a.userId),
      type: 'agent' as const,
      name: a.name,
      avatarUrl: a.avatarUrl ?? null,
      agentId: a.id,
      slug: a.slug,
      mentionable: a.mentionable,
    }))
  }

  /**
   * Get all member actors of a group — humans and agents combined.
   */
  async getAllMemberActors(groupId: string): Promise<(UserActor | AgentActor)[]> {
    const [users, agents] = await Promise.all([
      this.getUserActors(groupId),
      this.getAgentActors(groupId),
    ])
    return [...users, ...agents]
  }

  /**
   * Check if a user is a member of a group.
   */
  async isUserInGroup(userId: string, groupId: string): Promise<boolean> {
    const members = await getMembers(this.ctx, groupId)
    return members.some((m) => m.memberType === 'user' && m.memberRefId === userId)
  }

  /**
   * Get all groups that contain a specific user.
   */
  async getGroupsContainingUser(userId: string): Promise<string[]> {
    const groups = await getGroupsForUser(this.ctx, userId)
    return groups.map((g) => g.id)
  }

  /**
   * Expand ActorIds - if any are groups, include their member user IDs.
   * Useful for notifications, permissions checks, etc.
   *
   * Default behavior excludes agents (their synthetic users must never
   * receive email/notification fan-out). Pass `includeAgents: true` for
   * agent-aware paths (e.g. agent trigger routing).
   *
   * @returns Array of unique user IDs
   */
  async expandToUsers(
    actorIds: ActorId[],
    options: { includeAgents?: boolean } = {}
  ): Promise<string[]> {
    const includeAgents = options.includeAgents ?? false
    const userIds = new Set<string>()

    // Pre-load agent userId set once if we need to filter
    const agentUserIdSet = includeAgents
      ? null
      : new Set((await getCachedAgents(this.organizationId)).map((a) => a.userId))

    for (const actorId of actorIds) {
      try {
        const { type, id } = parseActorId(actorId)

        if (type === 'user') {
          if (includeAgents || !agentUserIdSet?.has(id)) {
            userIds.add(id)
          }
        } else if (type === 'group') {
          const members = includeAgents
            ? await this.getAllMemberActors(id)
            : await this.getUserActors(id)
          for (const member of members) {
            const parsed = parseActorId(member.actorId)
            userIds.add(parsed.id)
          }
        }
      } catch {}
    }

    return Array.from(userIds)
  }
}
