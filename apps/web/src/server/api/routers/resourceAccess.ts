// apps/web/src/server/api/routers/resourceAccess.ts

import { ResourceGranteeType, ResourcePermission } from '@auxx/database/enums'
import type { ResourceAccessContext } from '@auxx/lib/resource-access'
import {
  assertCanManageMailSharing,
  assertCanManageMailTypeAccess,
  assertMailSharingFeature,
  checkAccess,
  checkTypeAccess,
  getInstanceAccess,
  getTypeAccess,
  getUserAccessibleInstances,
  grantInstanceAccess,
  grantTypeAccess,
  revokeInstanceAccess,
  revokeTypeAccess,
  setInstanceAccess,
  setTypeAccess,
} from '@auxx/lib/resource-access'
import type { RecordId } from '@auxx/types/resource'
import { z } from 'zod'
import { recordAuditFromCtx } from '~/server/api/audit-context'
import { createTRPCRouter, protectedProcedure } from '../trpc'

/** Visibility lens on mail grants (mail-permissions §2.1). Optional everywhere. */
const lensSchema = z.enum(['metadata', 'subject', 'full']).nullish()

/** Convert tRPC context to ResourceAccessContext */
function toContext(ctx: {
  db: any
  session: { organizationId: string; userId: string }
}): ResourceAccessContext {
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
        permission: z.enum([
          ResourcePermission.view,
          ResourcePermission.edit,
          ResourcePermission.admin,
        ]),
        lens: lensSchema,
      })
    )
    .mutation(async ({ ctx, input }) => {
      const context = toContext(ctx)
      const recordId = input.recordId as RecordId
      await assertCanManageMailSharing(context, recordId)
      await assertMailSharingFeature(context, recordId, [input])
      await grantInstanceAccess(context, {
        recordId,
        granteeType: input.granteeType,
        granteeId: input.granteeId,
        permission: input.permission,
        lens: input.lens,
      })
      await recordAuditFromCtx(ctx, {
        category: 'security',
        action: 'permission.granted',
        targetType: 'Resource',
        targetId: input.recordId,
        metadata: {
          scope: 'instance',
          granteeType: input.granteeType,
          granteeId: input.granteeId,
          permission: input.permission,
          lens: input.lens ?? null,
        },
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
        permission: z.enum([
          ResourcePermission.view,
          ResourcePermission.edit,
          ResourcePermission.admin,
        ]),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await assertCanManageMailTypeAccess(toContext(ctx), input.entityDefinitionId)
      await grantTypeAccess(toContext(ctx), input)
      await recordAuditFromCtx(ctx, {
        category: 'security',
        action: 'permission.granted',
        targetType: 'EntityDefinition',
        targetId: input.entityDefinitionId,
        metadata: {
          scope: 'type',
          granteeType: input.granteeType,
          granteeId: input.granteeId,
          permission: input.permission,
        },
      })
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
      const context = toContext(ctx)
      await assertCanManageMailSharing(context, input.recordId as RecordId, {
        selfRevokeGranteeId: input.granteeId,
        selfRevokeGranteeType: input.granteeType,
      })
      const revoked = await revokeInstanceAccess(context, {
        recordId: input.recordId as RecordId,
        granteeType: input.granteeType,
        granteeId: input.granteeId,
      })
      await recordAuditFromCtx(ctx, {
        category: 'security',
        action: 'permission.revoked',
        targetType: 'Resource',
        targetId: input.recordId,
        metadata: {
          scope: 'instance',
          granteeType: input.granteeType,
          granteeId: input.granteeId,
        },
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
      await assertCanManageMailTypeAccess(toContext(ctx), input.entityDefinitionId)
      const revoked = await revokeTypeAccess(toContext(ctx), input)
      await recordAuditFromCtx(ctx, {
        category: 'security',
        action: 'permission.revoked',
        targetType: 'EntityDefinition',
        targetId: input.entityDefinitionId,
        metadata: {
          scope: 'type',
          granteeType: input.granteeType,
          granteeId: input.granteeId,
        },
      })
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
            permission: z.enum([
              ResourcePermission.view,
              ResourcePermission.edit,
              ResourcePermission.admin,
            ]),
            lens: lensSchema,
          })
        ),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const context = toContext(ctx)
      const recordId = input.recordId as RecordId
      await assertCanManageMailSharing(context, recordId)
      await assertMailSharingFeature(context, recordId, input.grants)
      await setInstanceAccess(context, recordId, input.granteeType, input.grants)
      await recordAuditFromCtx(ctx, {
        category: 'security',
        action: 'permission.set',
        targetType: 'Resource',
        targetId: input.recordId,
        newState: { granteeType: input.granteeType, grants: input.grants },
        metadata: { scope: 'instance' },
      })
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
            permission: z.enum([
              ResourcePermission.view,
              ResourcePermission.edit,
              ResourcePermission.admin,
            ]),
          })
        ),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await assertCanManageMailTypeAccess(toContext(ctx), input.entityDefinitionId)
      await setTypeAccess(toContext(ctx), input.entityDefinitionId, input.granteeType, input.grants)
      await recordAuditFromCtx(ctx, {
        category: 'security',
        action: 'permission.set',
        targetType: 'EntityDefinition',
        targetId: input.entityDefinitionId,
        newState: { granteeType: input.granteeType, grants: input.grants },
        metadata: { scope: 'type' },
      })
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
      return getUserAccessibleInstances(
        toContext(ctx),
        ctx.session.userId,
        input.entityDefinitionId
      )
    }),
})
