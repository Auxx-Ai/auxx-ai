// apps/web/src/server/api/routers/resourceAccess.ts

import { z } from 'zod'
import { createTRPCRouter, protectedProcedure } from '../trpc'
import {
  grantInstanceAccess,
  grantTypeAccess,
  revokeInstanceAccess,
  revokeTypeAccess,
  setInstanceAccess,
  setTypeAccess,
  checkAccess,
  checkTypeAccess,
  getInstanceAccess,
  getTypeAccess,
  getUserAccessibleInstances,
} from '@auxx/lib/resource-access'
import type { ResourceAccessContext } from '@auxx/lib/resource-access'
import type { RecordId } from '@auxx/types/resource'
import { ResourceGranteeType, ResourcePermission } from '@auxx/database/enums'

/** Convert tRPC context to ResourceAccessContext */
function toContext(ctx: { db: any; session: { organizationId: string; userId: string } }): ResourceAccessContext {
  return {
    db: ctx.db,
    organizationId: ctx.session.organizationId,
    userId: ctx.session.userId,
  }
}

export const resourceAccessRouter = createTRPCRouter({
  /** Grant access to a specific entity instance */
  grantInstance: protectedProcedure
    .input(
      z.object({
        recordId: z.string(),
        granteeType: z.enum([
          ResourceGranteeType.group,
          ResourceGranteeType.user,
          ResourceGranteeType.team,
          ResourceGranteeType.role,
        ]),
        granteeId: z.string(),
        permission: z.enum([ResourcePermission.view, ResourcePermission.edit, ResourcePermission.admin]),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await grantInstanceAccess(toContext(ctx), {
        recordId: input.recordId as RecordId,
        granteeType: input.granteeType,
        granteeId: input.granteeId,
        permission: input.permission,
      })
      return { success: true }
    }),

  /** Grant type-level access (all instances of an entity type) */
  grantType: protectedProcedure
    .input(
      z.object({
        entityDefinitionId: z.string(),
        granteeType: z.enum([
          ResourceGranteeType.group,
          ResourceGranteeType.user,
          ResourceGranteeType.team,
          ResourceGranteeType.role,
        ]),
        granteeId: z.string(),
        permission: z.enum([ResourcePermission.view, ResourcePermission.edit, ResourcePermission.admin]),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await grantTypeAccess(toContext(ctx), input)
      return { success: true }
    }),

  /** Revoke instance-level access */
  revokeInstance: protectedProcedure
    .input(
      z.object({
        recordId: z.string(),
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
      const revoked = await revokeInstanceAccess(toContext(ctx), {
        recordId: input.recordId as RecordId,
        granteeType: input.granteeType,
        granteeId: input.granteeId,
      })
      return { revoked }
    }),

  /** Revoke type-level access */
  revokeType: protectedProcedure
    .input(
      z.object({
        entityDefinitionId: z.string(),
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
      const revoked = await revokeTypeAccess(toContext(ctx), input)
      return { revoked }
    }),

  /** Set all instance-level access grants (replace existing) */
  setInstance: protectedProcedure
    .input(
      z.object({
        recordId: z.string(),
        granteeType: z.enum([
          ResourceGranteeType.group,
          ResourceGranteeType.user,
          ResourceGranteeType.team,
          ResourceGranteeType.role,
        ]),
        grants: z.array(
          z.object({
            granteeId: z.string(),
            permission: z.enum([ResourcePermission.view, ResourcePermission.edit, ResourcePermission.admin]),
          })
        ),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await setInstanceAccess(toContext(ctx), input.recordId as RecordId, input.granteeType, input.grants)
      return { success: true }
    }),

  /** Set all type-level access grants (replace existing) */
  setType: protectedProcedure
    .input(
      z.object({
        entityDefinitionId: z.string(),
        granteeType: z.enum([
          ResourceGranteeType.group,
          ResourceGranteeType.user,
          ResourceGranteeType.team,
          ResourceGranteeType.role,
        ]),
        grants: z.array(
          z.object({
            granteeId: z.string(),
            permission: z.enum([ResourcePermission.view, ResourcePermission.edit, ResourcePermission.admin]),
          })
        ),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await setTypeAccess(toContext(ctx), input.entityDefinitionId, input.granteeType, input.grants)
      return { success: true }
    }),

  /** Check current user's access to a specific entity instance */
  check: protectedProcedure
    .input(
      z.object({
        recordId: z.string(),
      })
    )
    .query(async ({ ctx, input }) => {
      return checkAccess(toContext(ctx), {
        recordId: input.recordId as RecordId,
        userId: ctx.session.userId,
      })
    }),

  /** Check current user's type-level access (access to ALL instances) */
  checkType: protectedProcedure
    .input(
      z.object({
        entityDefinitionId: z.string(),
      })
    )
    .query(async ({ ctx, input }) => {
      return checkTypeAccess(toContext(ctx), {
        entityDefinitionId: input.entityDefinitionId,
        userId: ctx.session.userId,
      })
    }),

  /** Get all access grants for a specific instance */
  forInstance: protectedProcedure
    .input(
      z.object({
        recordId: z.string(),
      })
    )
    .query(async ({ ctx, input }) => {
      return getInstanceAccess(toContext(ctx), input.recordId as RecordId)
    }),

  /** Get all type-level access grants for an entity type */
  forType: protectedProcedure
    .input(
      z.object({
        entityDefinitionId: z.string(),
      })
    )
    .query(async ({ ctx, input }) => {
      return getTypeAccess(toContext(ctx), input.entityDefinitionId)
    }),

  /** Get instances accessible by current user for an entity type */
  myInstances: protectedProcedure
    .input(
      z.object({
        entityDefinitionId: z.string(),
      })
    )
    .query(async ({ ctx, input }) => {
      return getUserAccessibleInstances(toContext(ctx), ctx.session.userId, input.entityDefinitionId)
    }),
})
