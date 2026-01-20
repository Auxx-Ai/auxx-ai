// apps/web/src/server/api/routers/entityGroup.ts

import { z } from 'zod'
import { createTRPCRouter, protectedProcedure } from '../trpc'
import * as groups from '@auxx/lib/groups'
import type { GroupContext } from '@auxx/types/groups'
import { MemberType, GroupVisibility, PermissionLevel } from '@auxx/database/enums'

/**
 * Helper to create GroupContext from tRPC context
 */
function toGroupContext(ctx: { db: any; session: { organizationId: string; userId: string } }): GroupContext {
  return {
    db: ctx.db,
    organizationId: ctx.session.organizationId,
    userId: ctx.session.userId,
  }
}

/**
 * TRPC router for entity group management.
 *
 * Entity groups are collections of entities and/or users.
 * They use the EntityInstance table with resourceType: 'entity_group'.
 */
export const entityGroupRouter = createTRPCRouter({
  // ═══════════════════════════════════════════════════════════════════════════
  // GROUP CRUD
  // ═══════════════════════════════════════════════════════════════════════════

  /** List groups accessible to the current user */
  list: protectedProcedure
    .input(
      z
        .object({
          search: z.string().optional(),
          limit: z.number().optional(),
          offset: z.number().optional(),
        })
        .optional()
    )
    .query(async ({ ctx, input }) => {
      const groupCtx = toGroupContext(ctx)
      return groups.listAccessibleGroups(groupCtx, input)
    }),

  /** Create a new entity group */
  create: protectedProcedure
    .input(
      z.object({
        name: z.string().min(1),
        description: z.string().optional(),
        memberType: z.string().default('any'),
        visibility: z.enum([GroupVisibility.public, GroupVisibility.private]).default(GroupVisibility.private),
        color: z.string().optional(),
        icon: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const groupCtx = toGroupContext(ctx)
      return groups.createGroup(groupCtx, input)
    }),

  /** Delete a group */
  delete: protectedProcedure
    .input(z.object({ groupId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const groupCtx = toGroupContext(ctx)
      await groups.deleteGroup(groupCtx, input.groupId)
      return { success: true }
    }),

  // ═══════════════════════════════════════════════════════════════════════════
  // MEMBER OPERATIONS
  // ═══════════════════════════════════════════════════════════════════════════

  /** Get members of a group */
  members: protectedProcedure
    .input(
      z.object({
        groupId: z.string(),
        limit: z.number().optional(),
        offset: z.number().optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      const groupCtx = toGroupContext(ctx)
      return groups.getMembers(groupCtx, input.groupId, input)
    }),

  /** Add members to a group */
  addMembers: protectedProcedure
    .input(
      z.object({
        groupId: z.string(),
        members: z.array(
          z.object({
            type: z.enum([MemberType.entity, MemberType.user]),
            id: z.string(),
          })
        ),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const groupCtx = toGroupContext(ctx)
      return groups.addMembers(groupCtx, input)
    }),

  /** Remove members from a group */
  removeMembers: protectedProcedure
    .input(
      z.object({
        groupId: z.string(),
        members: z.array(
          z.object({
            type: z.enum([MemberType.entity, MemberType.user]),
            id: z.string(),
          })
        ),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const groupCtx = toGroupContext(ctx)
      const removed = await groups.removeMembers(groupCtx, input.groupId, input.members)
      return { removed }
    }),

  /** Get groups a user belongs to */
  forUser: protectedProcedure.input(z.object({ userId: z.string() })).query(async ({ ctx, input }) => {
    const groupCtx = toGroupContext(ctx)
    return groups.getGroupsForUser(groupCtx, input.userId)
  }),

  /** Get groups an entity belongs to */
  forEntity: protectedProcedure.input(z.object({ entityId: z.string() })).query(async ({ ctx, input }) => {
    const groupCtx = toGroupContext(ctx)
    return groups.getGroupsForEntity(groupCtx, input.entityId)
  }),

  // ═══════════════════════════════════════════════════════════════════════════
  // PERMISSION OPERATIONS
  // ═══════════════════════════════════════════════════════════════════════════

  /** Get permissions for a group */
  permissions: protectedProcedure.input(z.object({ groupId: z.string() })).query(async ({ ctx, input }) => {
    const groupCtx = toGroupContext(ctx)
    return groups.getPermissions(groupCtx, input.groupId)
  }),

  /** Grant permission on a group */
  grantPermission: protectedProcedure
    .input(
      z.object({
        groupId: z.string(),
        granteeType: z.enum(['user', 'team', 'role']),
        granteeId: z.string(),
        permission: z.enum([
          PermissionLevel.view,
          PermissionLevel.edit,
          PermissionLevel.manage_members,
          PermissionLevel.admin,
        ]),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const groupCtx = toGroupContext(ctx)
      return groups.grantPermission(groupCtx, input)
    }),

  /** Revoke permission on a group */
  revokePermission: protectedProcedure
    .input(
      z.object({
        groupId: z.string(),
        granteeType: z.enum(['user', 'team', 'role']),
        granteeId: z.string(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const groupCtx = toGroupContext(ctx)
      const revoked = await groups.revokePermission(groupCtx, input.groupId, input.granteeType, input.granteeId)
      return { revoked }
    }),

  /** Check current user's permission on a group */
  myPermission: protectedProcedure.input(z.object({ groupId: z.string() })).query(async ({ ctx, input }) => {
    const groupCtx = toGroupContext(ctx)
    const permission = await groups.getGroupPermission(groupCtx, input.groupId)
    return { permission }
  }),
})
