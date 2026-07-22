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
    return agents
      .filter((a) => a.userId !== null)
      .map((a) => ({
        actorId: toActorId('agent', a.id),
        type: 'agent' as const,
        name: a.name ?? 'Untitled agent',
        avatarUrl: a.avatarUrl ?? null,
        agentId: a.id,
        userId: a.userId as string,
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

    // Index agents by id so `agent:<id>` actors expand to their backing user id.
    // Drafts have no backing user — skip them by filtering on userId.
    const agents = await getCachedAgents(this.organizationId)
    const agentById = new Map(agents.filter((a) => a.userId !== null).map((a) => [a.id, a]))
    const agentUserIdSet = new Set(
      agents.map((a) => a.userId).filter((id): id is string => id !== null)
    )

    for (const actorId of actorIds) {
      try {
        const { type, id } = parseActorId(actorId)

        if (type === 'user') {
          // Defensive: if a caller still passes user:<agentUserId> (legacy),
          // route through includeAgents the same way it would for an agent.
          if (includeAgents || !agentUserIdSet.has(id)) {
            userIds.add(id)
          }
        } else if (type === 'agent') {
          if (!includeAgents) continue
          const agent = agentById.get(id)
          if (agent?.userId) userIds.add(agent.userId)
        } else if (type === 'group') {
          const members = includeAgents
            ? await this.getAllMemberActors(id)
            : await this.getUserActors(id)
          for (const member of members) {
            const parsed = parseActorId(member.actorId)
            if (parsed.type === 'user') {
              userIds.add(parsed.id)
            } else if (parsed.type === 'agent') {
              const agent = agentById.get(parsed.id)
              if (agent?.userId) userIds.add(agent.userId)
            }
          }
        } else if (type === 'worker') {
          // Dispatch worker: an individual → its user, a team → its members' users
          // (plans/dispatch/45-teams.md §5A). Lazy import to keep the actors↔dispatch edge one-way.
          const { resolveWorkerUserIds } = await import('../dispatch/workers')
          const workerUserIds = await resolveWorkerUserIds(this.organizationId, id)
          for (const uid of workerUserIds) userIds.add(uid)
        }
      } catch {}
    }

    return Array.from(userIds)
  }
}
