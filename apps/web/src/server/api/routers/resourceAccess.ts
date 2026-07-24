// apps/web/src/server/api/routers/resourceAccess.ts

import { ResourceGranteeType, ResourcePermission } from '@auxx/database/enums'
import { isAdminOrOwner } from '@auxx/lib/members'
import type { ResourceAccessContext } from '@auxx/lib/resource-access'
import {
  assertCanManageMailSharing,
  assertCanManageMailTypeAccess,
  assertMailSharingFeature,
  checkAccess,
  checkTypeAccess,
  getAllTypeAccess,
  getInstanceAccess,
  getTypeAccess,
  grantInstanceAccess,
  grantTypeAccess,
  isMailSharingDef,
  revokeInstanceAccess,
  revokeTypeAccess,
  setInstanceAccess,
  setTypeAccess,
} from '@auxx/lib/resource-access'
import type { RecordId } from '@auxx/types/resource'
import { TRPCError } from '@trpc/server'
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

/**
 * Authorization for TYPE-level (def-wide) ResourceAccess reads/writes. Mail-infra
 * defs keep their mail-sharing authorization (inbox managers etc.); every other
 * def — the entity-def **Permissions** (Access) tab — is **OWNER/ADMIN only**.
 *
 * Managing record access is org-level: even a def-`admin` grantee (who can manage
 * a def's fields/name/icon via `canAdministerDef`) may NOT set who can see/edit
 * that def's records — that stays with admins. Enforced at the endpoint
 * independently of the page's role guard (defense in depth: a non-admin must not
 * self-grant def access via a raw call).
 */
async function assertCanManageTypeAccess(
  ctx: { db: any; session: { organizationId: string; userId: string } },
  entityDefinitionId: string
): Promise<void> {
  if (isMailSharingDef(entityDefinitionId)) {
    await assertCanManageMailTypeAccess(toContext(ctx), entityDefinitionId)
    return
  }
  if (!(await isAdminOrOwner(ctx.session.organizationId, ctx.session.userId))) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'You must be an admin or owner to manage record access',
    })
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

  /**
   * Grant type-level access (all instances of an entity type). `none` is
   * accepted only for the workspace baseline (`role:org_member`) — a def
   * lockdown marker that grants nobody (capability layer v2 phase 3).
   */
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
          ResourcePermission.none,
          ResourcePermission.view,
          ResourcePermission.edit,
          ResourcePermission.admin,
        ]),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await assertCanManageTypeAccess(ctx, input.entityDefinitionId)
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
      await assertCanManageTypeAccess(ctx, input.entityDefinitionId)
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
      await assertCanManageTypeAccess(ctx, input.entityDefinitionId)
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
      // Non-mail def-access grants are admin-only to read (they reveal the org's
      // access configuration); mail-infra defs keep their existing read surface.
      await assertCanManageTypeAccess(ctx, input.entityDefinitionId)
      return getTypeAccess(toContext(ctx), input.entityDefinitionId)
    }),

  /**
   * All type-level access rows for the org, across every def — the grantee-centric
   * Access UI (capability layer v2 grantee-def-access) reads this once and derives
   * each def's baseline + a given grantee's grant client-side. Admin-only: it
   * reveals the whole org's restriction map (no single def to branch mail-vs-admin
   * on, so gate directly on admin/owner).
   */
  allTypeAccess: protectedProcedure.query(async ({ ctx }) => {
    if (!(await isAdminOrOwner(ctx.session.organizationId, ctx.session.userId))) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'You must be an admin or owner to view type-level access',
      })
    }
    return getAllTypeAccess(toContext(ctx))
  }),
})
