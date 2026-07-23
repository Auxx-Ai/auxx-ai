// apps/web/src/server/api/routers/permissions.ts

import { getCachedUserCapabilities } from '@auxx/lib/cache'
import { Area, clearGranteeLevels, Level, setGranteeLevels } from '@auxx/lib/permissions'
import { z } from 'zod'
import { recordAuditFromCtx } from '~/server/api/audit-context'
import { adminProcedure, createTRPCRouter, protectedProcedure } from '~/server/api/trpc'

/** Grantee vocabulary for capability grants (§3.2). */
const granteeType = z.enum(['role', 'group', 'user'])

/** A sparse per-area level payload: `{ [areaSlug]: 0-3 }`; missing areas fall through. */
const levelsInput = z.record(z.nativeEnum(Area), z.nativeEnum(Level))

/**
 * Thin write/read surface for Layer-2 capability grants — enough to exercise
 * enforcement before the v2 permissions settings page ships (§2.J). Grant/revoke
 * are admin-only and delegate to the functional grant-service (which validates
 * the levels, applies the `granularPermissions` plan gate, and busts caches).
 */
export const permissionsRouter = createTRPCRouter({
  /** The current member's composed capability keys (for the client provider). */
  myCapabilities: protectedProcedure.query(async ({ ctx }) => {
    const caps = await getCachedUserCapabilities(ctx.session.userId, ctx.session.organizationId)
    return { keys: caps.keys }
  }),

  /** Set (upsert) the per-area levels for one grantee. */
  grant: adminProcedure
    .input(
      z.object({
        granteeType,
        granteeId: z.string(),
        levels: levelsInput,
      })
    )
    .mutation(async ({ ctx, input }) => {
      const grant = await setGranteeLevels({
        db: ctx.db,
        organizationId: ctx.session.organizationId,
        granteeType: input.granteeType,
        granteeId: input.granteeId,
        levels: input.levels,
        grantedById: ctx.session.userId,
      })

      await recordAuditFromCtx(ctx, {
        category: 'members',
        action: 'permission.granted',
        targetType: 'PermissionGrant',
        targetId: grant.id,
        newState: {
          granteeType: input.granteeType,
          granteeId: input.granteeId,
          levels: input.levels,
        },
      })

      return grant
    }),

  /** Remove the grant row for one grantee. */
  revoke: adminProcedure
    .input(
      z.object({
        granteeType,
        granteeId: z.string(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const removed = await clearGranteeLevels({
        db: ctx.db,
        organizationId: ctx.session.organizationId,
        granteeType: input.granteeType,
        granteeId: input.granteeId,
      })

      await recordAuditFromCtx(ctx, {
        category: 'members',
        action: 'permission.revoked',
        targetType: 'PermissionGrant',
        targetId: `${input.granteeType}:${input.granteeId}`,
        newState: { granteeType: input.granteeType, granteeId: input.granteeId, removed },
      })

      return { removed }
    }),
})
