// packages/lib/src/actors/group-member-service.ts

import type { ActorContext, ActorId, UserActor } from '@auxx/types/actor'
import { parseActorId, toActorId } from '@auxx/types/actor'
import type { GroupMember } from '@auxx/types/groups'
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
   * Get only user members of a group as UserActors.
   * Useful for expanding a group assignment to its user members.
   */
  async getUserActors(groupId: string): Promise<UserActor[]> {
    const members = await getMembers(this.ctx, groupId)

    return members
      .filter((m) => m.memberType === 'user' && m.user)
      .map((m) => ({
        actorId: toActorId('user', m.memberRefId),
        type: 'user' as const,
        name: m.user!.name ?? m.user!.email ?? 'Unknown',
        email: m.user!.email ?? '',
        avatarUrl: m.user!.image ?? null,
        role: 'USER' as const, // Role not stored in membership, default to USER
      }))
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
   * Expand ActorIds - if any are groups, include their user members.
   * Useful for notifications, permissions checks, etc.
   * @returns Array of unique user IDs
   */
  async expandToUsers(actorIds: ActorId[]): Promise<string[]> {
    const userIds = new Set<string>()

    for (const actorId of actorIds) {
      try {
        const { type, id } = parseActorId(actorId)

        if (type === 'user') {
          userIds.add(id)
        } else if (type === 'group') {
          const members = await this.getUserActors(id)
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
