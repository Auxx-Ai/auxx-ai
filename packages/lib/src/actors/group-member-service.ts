// packages/lib/src/actors/group-member-service.ts

import type { Database } from '@auxx/database'
import type { ActorContext, ActorId, AgentActor, UserActor } from '@auxx/types/actor'
import { parseActorId, toActorId } from '@auxx/types/actor'
import type { GroupContext, GroupMember } from '@auxx/types/groups'
import { getCachedAgents, getCachedAgentsByUserIds } from '../cache'
import { getGroupsForUser, getMembers } from '../groups/group-functions'

/**
 * Service for group member operations.
 * Extends existing group-functions with actor-focused methods.
 */
export class GroupMemberService {
  private db: Database
  private organizationId: string
  private userId: string

  constructor(ctx: ActorContext) {
    // `ActorContext.db` is declared `unknown` in `@auxx/types/actor` even though its sibling
    // `GroupContext` names `Database`. Narrow once here rather than at each `getMembers` call;
    // every construction site passes the real Drizzle client.
    this.db = ctx.db as Database
    this.organizationId = ctx.organizationId
    this.userId = ctx.userId
  }

  /**
   * Get the context object for group functions.
   */
  private get ctx(): GroupContext {
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
   * `canSeeAgent` applies per-agent instance access (plan 25 §4.2) when the
   * caller is a USER-facing surface. It belongs here rather than in the caller
   * because an agent reaches the output through **three** doors and only one is
   * visible in `actorIds`: the `agent:<id>` spelling, the legacy
   * `user:<backingUserId>` spelling that this method deliberately reroutes, and
   * group membership expanded inside the loop below. A caller that filtered its
   * input array would close one and look like it had closed all three.
   *
   * Omit it for system paths (trigger routing, notification fan-out), which run
   * with no invoking user and must not be clamped by anyone's visibility.
   *
   * @returns Array of unique user IDs
   */
  async expandToUsers(
    actorIds: ActorId[],
    options: { includeAgents?: boolean; canSeeAgent?: (agentId: string) => boolean } = {}
  ): Promise<string[]> {
    const includeAgents = options.includeAgents ?? false
    const canSeeAgent = options.canSeeAgent ?? (() => true)
    const userIds = new Set<string>()

    // Index agents by id so `agent:<id>` actors expand to their backing user id.
    // Drafts have no backing user — skip them by filtering on userId.
    const agents = await getCachedAgents(this.organizationId)
    const visibleAgents = agents.filter((a) => canSeeAgent(a.id))
    const agentById = new Map(visibleAgents.filter((a) => a.userId !== null).map((a) => [a.id, a]))
    // Door 2: the legacy `user:<backingUserId>` spelling. Two sets, not one —
    // `visible` decides whether an agent may be resolved, `all` decides whether
    // a given user id IS an agent at all. Collapsing them would let an agent the
    // caller cannot see fall through as an ordinary user.
    const visibleAgentUserIds = new Set(
      visibleAgents.map((a) => a.userId).filter((id): id is string => id !== null)
    )
    const allAgentUserIds = new Set(
      agents.map((a) => a.userId).filter((id): id is string => id !== null)
    )

    /**
     * Add a `user:`-spelled id, applying the agent rules when it turns out to
     * name an agent's backing user. A genuine human user is always added.
     */
    const addUserActor = (id: string) => {
      if (!allAgentUserIds.has(id)) {
        userIds.add(id)
        return
      }
      if (includeAgents && visibleAgentUserIds.has(id)) userIds.add(id)
    }

    for (const actorId of actorIds) {
      try {
        const { type, id } = parseActorId(actorId)

        if (type === 'user') {
          // Defensive: a caller may still pass user:<agentUserId> (legacy), so
          // route it through the same agent rules an `agent:` id would take.
          addUserActor(id)
        } else if (type === 'agent') {
          if (!includeAgents) continue
          // `agentById` holds VISIBLE agents only, so an unseeable id misses.
          const agent = agentById.get(id)
          if (agent?.userId) userIds.add(agent.userId)
        } else if (type === 'group') {
          // Door 3: group membership. A group the caller may see can still
          // contain an agent they may not — closed by `agentById` below holding
          // VISIBLE agents only.
          const members = includeAgents
            ? await this.getAllMemberActors(id)
            : await this.getUserActors(id)
          for (const member of members) {
            const parsed = parseActorId(member.actorId)
            if (parsed.type === 'user') {
              // `addUserActor` rather than a bare add, but note this arm is
              // currently DEFENSIVE, not load-bearing: `getUserActors` already
              // drops any member whose id belongs to an agent (see its
              // `!agentUserIds.has(...)` filter), so an agent member always
              // arrives on the `agent:` branch instead. Mutating this line to a
              // bare `userIds.add` therefore kills no test — verified, and said
              // out loud rather than left to imply coverage it does not have.
              // It stays because the day `getUserActors` stops pre-splitting,
              // this is the line that decides whether door 3 reopens.
              addUserActor(parsed.id)
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
