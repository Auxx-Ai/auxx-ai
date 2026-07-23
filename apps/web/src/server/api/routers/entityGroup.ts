// apps/web/src/server/api/routers/entityGroup.ts

import {
  GroupVisibility,
  MemberType,
  ResourceGranteeType,
  ResourcePermission,
} from '@auxx/database/enums'
import * as groups from '@auxx/lib/groups'
import type { GroupContext } from '@auxx/types/groups'
import { z } from 'zod'
import { recordAuditFromCtx } from '../audit-context'
import { createTRPCRouter, protectedProcedure } from '../trpc'

/**
 * Helper to create GroupContext from tRPC context
 */
function toGroupContext(ctx: {
  db: any
  session: { organizationId: string; userId: string }
}): GroupContext {
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
        visibility: z
          .enum([GroupVisibility.public, GroupVisibility.private])
          .default(GroupVisibility.private),
        color: z.string().optional(),
        icon: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const groupCtx = toGroupContext(ctx)
      const created = await groups.createGroup(groupCtx, input)
      await recordAuditFromCtx(ctx, {
        category: 'settings',
        action: 'group.created',
        targetType: 'EntityGroup',
        targetId: (created as { id?: string } | null)?.id ?? null,
        metadata: { name: input.name, visibility: input.visibility },
      })
      return created
    }),

  /** Update a group's name / description / icon / visibility */
  update: protectedProcedure
    .input(
      z.object({
        groupId: z.string(),
        name: z.string().min(1).optional(),
        description: z.string().optional(),
        icon: z.string().optional(),
        visibility: z.enum([GroupVisibility.public, GroupVisibility.private]).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const groupCtx = toGroupContext(ctx)
      const { groupId, ...changes } = input
      const updated = await groups.updateGroup(groupCtx, groupId, changes)
      await recordAuditFromCtx(ctx, {
        category: 'settings',
        action: 'group.updated',
        targetType: 'EntityGroup',
        targetId: groupId,
        metadata: { name: input.name, visibility: input.visibility },
      })
      return updated
    }),

  /** Delete a group */
  delete: protectedProcedure
    .input(z.object({ groupId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const groupCtx = toGroupContext(ctx)
      await groups.deleteGroup(groupCtx, input.groupId)
      await recordAuditFromCtx(ctx, {
        category: 'settings',
        action: 'group.deleted',
        targetType: 'EntityGroup',
        targetId: input.groupId,
      })
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
      const result = await groups.addMembers(groupCtx, input)
      await recordAuditFromCtx(ctx, {
        category: 'settings',
        action: 'group.member_added',
        targetType: 'EntityGroup',
        targetId: input.groupId,
        metadata: { memberCount: input.members.length },
      })
      return result
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
      await recordAuditFromCtx(ctx, {
        category: 'settings',
        action: 'group.member_removed',
        targetType: 'EntityGroup',
        targetId: input.groupId,
        metadata: { memberCount: input.members.length },
      })
      return { removed }
    }),

  /** Get groups a user belongs to */
  forUser: protectedProcedure
    .input(z.object({ userId: z.string() }))
    .query(async ({ ctx, input }) => {
      const groupCtx = toGroupContext(ctx)
      return groups.getGroupsForUser(groupCtx, input.userId)
    }),

  /** Get groups an entity belongs to */
  forEntity: protectedProcedure
    .input(z.object({ entityId: z.string() }))
    .query(async ({ ctx, input }) => {
      const groupCtx = toGroupContext(ctx)
      return groups.getGroupsForEntity(groupCtx, input.entityId)
    }),

  // ═══════════════════════════════════════════════════════════════════════════
  // PERMISSION OPERATIONS
  // ═══════════════════════════════════════════════════════════════════════════

  /** Get permissions for a group */
  permissions: protectedProcedure
    .input(z.object({ groupId: z.string() }))
    .query(async ({ ctx, input }) => {
      const groupCtx = toGroupContext(ctx)
      return groups.getPermissions(groupCtx, input.groupId)
    }),

  /** Grant permission on a group */
  grantPermission: protectedProcedure
    .input(
      z.object({
        groupId: z.string(),
        granteeType: z.enum([
          ResourceGranteeType.group,
          ResourceGranteeType.user,
          ResourceGranteeType.team,
          ResourceGranteeType.role,
        ]),
        granteeId: z.string(),
        permission: z.enum([
          ResourcePermission.view,
          ResourcePermission.edit,
          ResourcePermission.admin,
        ]),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const groupCtx = toGroupContext(ctx)
      const result = await groups.grantPermission(groupCtx, input)
      await recordAuditFromCtx(ctx, {
        category: 'security',
        action: 'group.permission_granted',
        targetType: 'EntityGroup',
        targetId: input.groupId,
        metadata: {
          granteeType: input.granteeType,
          granteeId: input.granteeId,
          permission: input.permission,
        },
      })
      return result
    }),

  /** Revoke permission on a group */
  revokePermission: protectedProcedure
    .input(
      z.object({
        groupId: z.string(),
        granteeType: z.enum([
          ResourceGranteeType.group,
          ResourceGranteeType.user,
          ResourceGranteeType.team,
          ResourceGranteeType.role,
        ]),
        granteeId: z.string(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const groupCtx = toGroupContext(ctx)
      const revoked = await groups.revokePermission(
        groupCtx,
        input.groupId,
        input.granteeType,
        input.granteeId
      )
      await recordAuditFromCtx(ctx, {
        category: 'security',
        action: 'group.permission_revoked',
        targetType: 'EntityGroup',
        targetId: input.groupId,
        metadata: { granteeType: input.granteeType, granteeId: input.granteeId },
      })
      return { revoked }
    }),

  /** Check current user's permission on a group */
  myPermission: protectedProcedure
    .input(z.object({ groupId: z.string() }))
    .query(async ({ ctx, input }) => {
      const groupCtx = toGroupContext(ctx)
      const permission = await groups.getGroupPermission(groupCtx, input.groupId)
      return { permission }
    }),
})
