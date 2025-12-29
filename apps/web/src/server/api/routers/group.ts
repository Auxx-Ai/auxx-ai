// server/api/routers/group.ts
import { z } from 'zod'
import { TRPCError } from '@trpc/server'
import { createTRPCRouter, protectedProcedure } from '../trpc'
import { schema } from '@auxx/database'
import { and, or, eq, ilike, inArray, desc } from 'drizzle-orm'
import { createScopedLogger } from '@auxx/logger'
import { PermissionService } from '@auxx/lib/permissions'

const logger = createScopedLogger('api-group')

/**
 * TRPC router for group management operations.
 *
 * This router provides endpoints for:
 * - Retrieving groups (all, by ID)
 * - Creating, updating, and deleting groups
 * - Managing group members (listing, adding, removing, updating status)
 *
 * Groups belong to organizations, and all operations verify that the requested
 * group belongs to the user's current organization context.
 *
 * @remarks
 * Groups can have custom properties including emoji and color for UI display.
 * Group members can be active or inactive, allowing for temporary removal without losing history.
 */
export const groupRouter = createTRPCRouter({
  // Get all groups for the organization
  all: protectedProcedure
    .input(z.object({ search: z.string().optional() }).optional())
    .query(async ({ ctx, input }) => {
      const { organizationId } = ctx.session
      const searchQuery = input?.search

      try {
        // Fetch groups
        const groups = await ctx.db
          .select()
          .from(schema.Group)
          .where(
            and(
              eq(schema.Group.organizationId, organizationId),
              ...(searchQuery
                ? [
                    or(
                      ilike(schema.Group.name, `%${searchQuery}%`),
                      ilike(schema.Group.description, `%${searchQuery}%`)
                    ),
                  ]
                : [])
            )
          )
          .orderBy(desc(schema.Group.updatedAt))

        if (groups.length === 0) return { groups: [] }

        const groupIds = groups.map((g) => g.id)
        const membersAll = await ctx.db
          .select({
            id: schema.GroupMember.id,
            groupId: schema.GroupMember.groupId,
            userId: schema.GroupMember.userId,
            isActive: schema.GroupMember.isActive,
            joinedAt: schema.GroupMember.joinedAt,
            user: {
              id: schema.User.id,
              name: schema.User.name,
              email: schema.User.email,
              image: schema.User.image,
            },
          })
          .from(schema.GroupMember)
          .innerJoin(schema.User, eq(schema.GroupMember.userId, schema.User.id))
          .where(
            and(
              inArray(schema.GroupMember.groupId, groupIds),
              eq(schema.GroupMember.isActive, true)
            )
          )
          .orderBy(desc(schema.GroupMember.joinedAt))

        const groupsWithMembers = groups.map((g) => {
          const membersForGroup = membersAll.filter((m) => m.groupId === g.id)
          return {
            ...g,
            _count: { members: membersForGroup.length },
            members: membersForGroup.slice(0, 5),
          }
        })

        return { groups: groupsWithMembers }
      } catch (error) {
        logger.error('Error getting organization groups:', { error })
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to get organization groups',
        })
      }
    }),

  // Get a specific group by ID
  byId: protectedProcedure.input(z.object({ id: z.string() })).query(async ({ ctx, input }) => {
    const { organizationId } = ctx.session
    const { id } = input
    try {
      const [group] = await ctx.db
        .select()
        .from(schema.Group)
        .where(and(eq(schema.Group.id, id), eq(schema.Group.organizationId, organizationId)))
        .limit(1)

      if (!group) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Group not found' })
      }

      const members = await ctx.db
        .select({
          id: schema.GroupMember.id,
          groupId: schema.GroupMember.groupId,
          userId: schema.GroupMember.userId,
          isActive: schema.GroupMember.isActive,
          joinedAt: schema.GroupMember.joinedAt,
          deactivatedAt: schema.GroupMember.deactivatedAt,
          user: {
            id: schema.User.id,
            name: schema.User.name,
            email: schema.User.email,
            image: schema.User.image,
          },
        })
        .from(schema.GroupMember)
        .innerJoin(schema.User, eq(schema.GroupMember.userId, schema.User.id))
        .where(eq(schema.GroupMember.groupId, id))
        .orderBy(desc(schema.GroupMember.joinedAt))

      return { group: { ...group, _count: { members: members.length }, members } }
    } catch (error) {
      logger.error('Error getting group details:', { error, groupId: id })
      throw error instanceof TRPCError
        ? error
        : new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to get group details' })
    }
  }),

  // Create a new group
  create: protectedProcedure
    .input(
      z.object({
        name: z.string().min(1).max(100),
        description: z.string().optional(),
        emoji: z.string().optional(),
        color: z.string().optional(),
        properties: z.any().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { organizationId, userId } = ctx.session
      const { name, description, emoji, color, properties } = input
      try {
        // Check if a group with the same name already exists
        const [existingGroup] = await ctx.db
          .select({ id: schema.Group.id })
          .from(schema.Group)
          .where(and(eq(schema.Group.name, name), eq(schema.Group.organizationId, organizationId)))
          .limit(1)
        const permissionService = new PermissionService(organizationId, userId, ctx.db)
        const hasPermission = await permissionService.checkPermission('group')
        if (!hasPermission) {
          throw new TRPCError({
            code: 'FORBIDDEN',
            message: 'You do not have permission to create groups',
          })
        }

        if (existingGroup) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'A group with this name already exists',
          })
        }

        // Create the group
        const [newGroup] = await ctx.db
          .insert(schema.Group)
          .values({
            name,
            description,
            organizationId,
            properties: {
              emoji: emoji || '👥',
              color: color || '#4f46e5',
              ...(properties || {}),
            } as any,
            updatedAt: new Date(),
          })
          .returning()

        return { success: true, group: newGroup }
      } catch (error) {
        logger.error('Error creating group:', { error, input })
        throw error instanceof TRPCError
          ? error
          : new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to create group' })
      }
    }),

  // Update a group
  update: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        name: z.string().min(1).max(100).optional(),
        description: z.string().optional(),
        emoji: z.string().optional(),
        color: z.string().optional(),
        properties: z.any().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { organizationId, userId } = ctx.session
      const { id, name, description, emoji, color, properties } = input
      try {
        const permissionService = new PermissionService(organizationId, userId, ctx.db)
        const hasPermission = await permissionService.checkPermission('group')
        if (!hasPermission) {
          throw new TRPCError({
            code: 'FORBIDDEN',
            message: 'You do not have permission to update groups',
          })
        }

        // Check if the group exists and belongs to this organization
        const [existingGroup] = await ctx.db
          .select()
          .from(schema.Group)
          .where(and(eq(schema.Group.id, id), eq(schema.Group.organizationId, organizationId)))
          .limit(1)

        if (!existingGroup) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Group not found' })
        }

        // If name is being updated, check for uniqueness
        if (name && name !== existingGroup.name) {
          const [duplicateName] = await ctx.db
            .select({ id: schema.Group.id })
            .from(schema.Group)
            .where(
              and(
                eq(schema.Group.name, name),
                eq(schema.Group.organizationId, organizationId),
                eq(schema.Group.id, id)
              )
            )
            .limit(1)

          if (duplicateName) {
            throw new TRPCError({
              code: 'BAD_REQUEST',
              message: 'A group with this name already exists',
            })
          }
        }

        // Prepare the updated properties
        let updatedProperties = (existingGroup.properties as Record<string, any>) || {}

        if (emoji) updatedProperties.emoji = emoji
        if (color) updatedProperties.color = color
        if (properties) {
          updatedProperties = { ...updatedProperties, ...properties }
        }

        // Update the group
        const [updatedGroup] = await ctx.db
          .update(schema.Group)
          .set({
            name,
            description,
            properties: updatedProperties as any,
            updatedAt: new Date(),
          })
          .where(eq(schema.Group.id, id))
          .returning()

        return { success: true, group: updatedGroup }
      } catch (error) {
        logger.error('Error updating group:', { error, groupId: id })
        throw error instanceof TRPCError
          ? error
          : new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to update group' })
      }
    }),

  // Delete a group
  delete: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const { organizationId, userId } = ctx.session
      const { id } = input
      try {
        const permissionService = new PermissionService(organizationId, userId, ctx.db)
        const hasPermission = await permissionService.checkPermission('group')
        if (!hasPermission) {
          throw new TRPCError({
            code: 'FORBIDDEN',
            message: 'You do not have permission to delete groups',
          })
        }

        // Check if the group exists and belongs to this organization
        const [existingGroup] = await ctx.db
          .select({ id: schema.Group.id })
          .from(schema.Group)
          .where(and(eq(schema.Group.id, id), eq(schema.Group.organizationId, organizationId)))
          .limit(1)

        if (!existingGroup) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Group not found' })
        }

        // Delete the group
        await ctx.db.delete(schema.Group).where(eq(schema.Group.id, id))

        return { success: true }
      } catch (error) {
        logger.error('Error deleting group:', { error, groupId: id })
        throw error instanceof TRPCError
          ? error
          : new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to delete group' })
      }
    }),

  // Get members of a group
  allMembers: protectedProcedure
    .input(
      z.object({
        groupId: z.string(),
        includeInactive: z.boolean().default(false),
        searchQuery: z.string().optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      const { organizationId } = ctx.session
      const { groupId, includeInactive, searchQuery } = input

      try {
        // Verify the group belongs to this organization
        const [group] = await ctx.db
          .select({ id: schema.Group.id })
          .from(schema.Group)
          .where(and(eq(schema.Group.id, groupId), eq(schema.Group.organizationId, organizationId)))
          .limit(1)

        if (!group) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Group not found' })
        }

        const members = await ctx.db
          .select({
            id: schema.GroupMember.id,
            groupId: schema.GroupMember.groupId,
            userId: schema.GroupMember.userId,
            isActive: schema.GroupMember.isActive,
            joinedAt: schema.GroupMember.joinedAt,
            deactivatedAt: schema.GroupMember.deactivatedAt,
            user: {
              id: schema.User.id,
              name: schema.User.name,
              email: schema.User.email,
              image: schema.User.image,
            },
          })
          .from(schema.GroupMember)
          .innerJoin(schema.User, eq(schema.GroupMember.userId, schema.User.id))
          .where(
            and(
              eq(schema.GroupMember.groupId, groupId),
              ...(includeInactive ? [] : [eq(schema.GroupMember.isActive, true)]),
              ...(searchQuery
                ? [
                    or(
                      ilike(schema.User.name, `%${searchQuery}%`),
                      ilike(schema.User.email, `%${searchQuery}%`)
                    ),
                  ]
                : [])
            )
          )
          .orderBy(desc(schema.GroupMember.isActive), desc(schema.GroupMember.joinedAt))

        return { members }
      } catch (error) {
        logger.error('Error getting group members:', { error, groupId })
        throw error instanceof TRPCError
          ? error
          : new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to get group members' })
      }
    }),

  // Add a member to a group
  addMember: protectedProcedure
    .input(z.object({ groupId: z.string(), userId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const { organizationId } = ctx.session
      const { groupId, userId } = input
      try {
        const permissionService = new PermissionService(organizationId, ctx.session.userId, ctx.db)

        const hasPermission = await permissionService.checkPermission('group')
        if (!hasPermission) {
          throw new TRPCError({
            code: 'FORBIDDEN',
            message: 'You do not have permission to add members to groups',
          })
        }

        // Verify the group belongs to this organization
        const [group] = await ctx.db
          .select({ id: schema.Group.id })
          .from(schema.Group)
          .where(and(eq(schema.Group.id, groupId), eq(schema.Group.organizationId, organizationId)))
          .limit(1)

        if (!group) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Group not found' })
        }

        // Verify the user belongs to this organization
        const [membership] = await ctx.db
          .select({ id: schema.OrganizationMember.id })
          .from(schema.OrganizationMember)
          .where(
            and(
              eq(schema.OrganizationMember.userId, userId),
              eq(schema.OrganizationMember.organizationId, organizationId)
            )
          )
          .limit(1)

        if (!membership) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'User is not a member of this organization',
          })
        }

        // Check if the user is already a member of the group
        const [existingMember] = await ctx.db
          .select()
          .from(schema.GroupMember)
          .where(
            and(eq(schema.GroupMember.groupId, groupId), eq(schema.GroupMember.userId, userId))
          )
          .limit(1)

        if (existingMember) {
          // If inactive, reactivate
          if (!existingMember.isActive) {
            const [updatedMember] = await ctx.db
              .update(schema.GroupMember)
              .set({ isActive: true, deactivatedAt: null })
              .where(eq(schema.GroupMember.id, existingMember.id))
              .returning()

            return { success: true, member: updatedMember, action: 'reactivated' }
          }

          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'User is already a member of this group',
          })
        }

        // Add the user to the group
        const [newMemberBase] = await ctx.db
          .insert(schema.GroupMember)
          .values({ groupId, userId, isActive: true, joinedAt: new Date() })
          .returning()
        const [user] = await ctx.db
          .select({
            id: schema.User.id,
            name: schema.User.name,
            email: schema.User.email,
            image: schema.User.image,
          })
          .from(schema.User)
          .where(eq(schema.User.id, userId))
          .limit(1)
        const newMember = { ...newMemberBase, user }

        return { success: true, member: newMember, action: 'added' }
      } catch (error) {
        logger.error('Error adding group member:', { error, groupId, userId })
        throw error instanceof TRPCError
          ? error
          : new TRPCError({
              code: 'INTERNAL_SERVER_ERROR',
              message: 'Failed to add member to group',
            })
      }
    }),

  // Add multiple members to a group
  addMembers: protectedProcedure
    .input(z.object({ groupId: z.string(), userIds: z.array(z.string()) }))
    .mutation(async ({ ctx, input }) => {
      const { organizationId } = ctx.session
      const { groupId, userIds } = input
      try {
        const permissionService = new PermissionService(organizationId, ctx.session.userId, ctx.db)
        const hasPermission = await permissionService.checkPermission('group')
        if (!hasPermission) {
          throw new TRPCError({
            code: 'FORBIDDEN',
            message: 'You do not have permission to add members to groups',
          })
        }

        // Verify the group belongs to this organization
        const [group] = await ctx.db
          .select({ id: schema.Group.id })
          .from(schema.Group)
          .where(and(eq(schema.Group.id, groupId), eq(schema.Group.organizationId, organizationId)))
          .limit(1)

        if (!group) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Group not found' })
        }

        // Get existing members to avoid duplicates
        const existingMembers =
          userIds.length === 0
            ? []
            : await ctx.db
                .select()
                .from(schema.GroupMember)
                .where(
                  and(
                    eq(schema.GroupMember.groupId, groupId),
                    inArray(schema.GroupMember.userId, userIds)
                  )
                )

        const existingMemberIds = new Set(existingMembers.map((m) => m.userId))

        // Reactivate inactive members
        const inactiveMembers = existingMembers.filter((m) => !m.isActive)

        if (inactiveMembers.length > 0) {
          const inactiveMemberIds = inactiveMembers.map((m) => m.id)

          if (inactiveMemberIds.length > 0) {
            await ctx.db
              .update(schema.GroupMember)
              .set({ isActive: true, deactivatedAt: null })
              .where(inArray(schema.GroupMember.id, inactiveMemberIds))
          }
        }

        // Filter out user IDs that are already members
        const newUserIds = userIds.filter((id) => !existingMemberIds.has(id))

        // Add new members
        if (newUserIds.length > 0) {
          await ctx.db.insert(schema.GroupMember).values(
            newUserIds.map((userId) => ({
              groupId,
              userId,
              isActive: true,
              joinedAt: new Date(),
            }))
          )
        }

        return {
          success: true,
          stats: {
            total: userIds.length,
            added: newUserIds.length,
            reactivated: inactiveMembers.length,
            alreadyActive: existingMembers.length - inactiveMembers.length,
          },
        }
      } catch (error) {
        logger.error('Error adding group members:', {
          error,
          groupId,
          userCount: input.userIds.length,
        })
        throw error instanceof TRPCError
          ? error
          : new TRPCError({
              code: 'INTERNAL_SERVER_ERROR',
              message: 'Failed to add members to group',
            })
      }
    }),

  // Remove a member from a group
  removeMember: protectedProcedure
    .input(
      z.object({
        groupId: z.string(),
        userId: z.string(),
        deactivateOnly: z.boolean().default(false),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { organizationId } = ctx.session
      const { groupId, userId, deactivateOnly } = input
      try {
        const permissionService = new PermissionService(organizationId, ctx.session.userId, ctx.db)
        const hasPermission = await permissionService.checkPermission('group')
        if (!hasPermission) {
          throw new TRPCError({
            code: 'FORBIDDEN',
            message: 'You do not have permission to remove members from groups',
          })
        }

        // Verify the group belongs to this organization
        const [group] = await ctx.db
          .select()
          .from(schema.Group)
          .where(and(eq(schema.Group.id, groupId), eq(schema.Group.organizationId, organizationId)))
          .limit(1)

        if (!group) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Group not found' })
        }

        // Find the member
        const [member] = await ctx.db
          .select()
          .from(schema.GroupMember)
          .where(
            and(eq(schema.GroupMember.groupId, groupId), eq(schema.GroupMember.userId, userId))
          )
          .limit(1)

        if (!member) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'User is not a member of this group' })
        }

        if (deactivateOnly) {
          // Deactivate the member
          await ctx.db
            .update(schema.GroupMember)
            .set({ isActive: false, deactivatedAt: new Date() })
            .where(eq(schema.GroupMember.id, member.id))

          return { success: true, action: 'deactivated' }
        } else {
          // Completely remove the member
          await ctx.db.delete(schema.GroupMember).where(eq(schema.GroupMember.id, member.id))

          return { success: true, action: 'removed' }
        }
      } catch (error) {
        logger.error('Error removing group member:', { error, groupId, userId })
        throw error instanceof TRPCError
          ? error
          : new TRPCError({
              code: 'INTERNAL_SERVER_ERROR',
              message: 'Failed to remove member from group',
            })
      }
    }),

  // Update member status
  updateMemberStatus: protectedProcedure
    .input(z.object({ groupId: z.string(), userId: z.string(), isActive: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const { organizationId } = ctx.session
      const { groupId, userId, isActive } = input
      try {
        const permissionService = new PermissionService(organizationId, ctx.session.userId, ctx.db)
        const hasPermission = await permissionService.checkPermission('group')
        if (!hasPermission) {
          throw new TRPCError({
            code: 'FORBIDDEN',
            message: 'You do not have permission to update member status in groups',
          })
        }

        // Verify the group belongs to this organization
        const [group] = await ctx.db
          .select({ id: schema.Group.id })
          .from(schema.Group)
          .where(and(eq(schema.Group.id, groupId), eq(schema.Group.organizationId, organizationId)))
          .limit(1)

        if (!group) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Group not found' })
        }

        // Find the member
        const [member] = await ctx.db
          .select()
          .from(schema.GroupMember)
          .where(
            and(eq(schema.GroupMember.groupId, groupId), eq(schema.GroupMember.userId, userId))
          )
          .limit(1)

        if (!member) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'User is not a member of this group' })
        }

        // Update member status
        const [updated] = await ctx.db
          .update(schema.GroupMember)
          .set({ isActive, deactivatedAt: isActive ? null : new Date() })
          .where(eq(schema.GroupMember.id, member.id))
          .returning()
        const [u] = await ctx.db
          .select({
            id: schema.User.id,
            name: schema.User.name,
            email: schema.User.email,
            image: schema.User.image,
          })
          .from(schema.User)
          .where(eq(schema.User.id, userId))
          .limit(1)
        const updatedMember = { ...updated, user: u }

        return {
          success: true,
          member: updatedMember,
          action: isActive ? 'activated' : 'deactivated',
        }
      } catch (error) {
        logger.error('Error updating member status:', { error, groupId, userId })
        throw error instanceof TRPCError
          ? error
          : new TRPCError({
              code: 'INTERNAL_SERVER_ERROR',
              message: 'Failed to update member status',
            })
      }
    }),
})
