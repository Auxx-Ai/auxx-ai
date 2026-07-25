// apps/web/src/server/api/routers/permissions.ts

import {
  type Area,
  clearGranteeLevels,
  getCapabilities,
  Level,
  listGranteeGrants,
  ROLE_DEFAULTS,
  setGranteeLevels,
} from '@auxx/lib/permissions'
import { z } from 'zod'
import { recordAuditFromCtx } from '~/server/api/audit-context'
import { adminProcedure, createTRPCRouter, protectedProcedure } from '~/server/api/trpc'
import { bridgeMemberBaselineGrants, resolveGrantGrantee } from './permissions-member-baseline'

/**
 * Grantee vocabulary for capability grants (§3.2).
 *
 * TODO(plan-19-step-7): `'profile'` is deliberately absent. The shipped
 * Member-baseline tab still addresses the baseline as `role:org_member` and
 * `permissions-member-baseline.ts` redirects it onto the org's `member` profile in
 * both directions; no client sends `'profile'` until step 7 ships the Profiles
 * editor, and an unused write vocabulary is a surface nobody validated.
 */
const granteeType = z.enum(['role', 'group', 'user'])

/**
 * A sparse per-area level payload: `{ [areaSlug]: 0-3 }`; missing areas fall
 * through. Keys are accepted as plain strings and values coerced to `0..3`
 * numbers — `setGranteeLevels` runs `parseAreaLevels`, which is the real gate
 * (drops unknown/renamed area slugs, clamps each value). Keeping this loose
 * avoids brittle enum-shape mismatches (e.g. a client sending `"3"` vs `3`).
 */
const levelsInput = z.record(z.string(), z.coerce.number().int().min(Level.None).max(Level.Full))

/**
 * Thin write/read surface for Layer-2 capability grants — enough to exercise
 * enforcement before the v2 permissions settings page ships (§2.J). Grant/revoke
 * are admin-only and delegate to the functional grant-service (which validates
 * the levels, applies the `granularPermissions` plan gate, and busts caches).
 *
 * TODO(plan-19-step-7): the org-wide member baseline is addressed by the shipped
 * client as `role:org_member`, a `PermissionGrant` tier step 2 deleted. Both
 * directions are redirected onto the org's `member` permission profile — the tier
 * the composer actually reads (§0.8) — at this boundary, in
 * `permissions-member-baseline.ts`. Step 7 replaces the tab with the
 * Member-profile editor and deletes that module. `ResourceAccess`'s
 * `role:org_member` rows (per-def / per-instance baselines) are a DIFFERENT,
 * still-live mechanism and are not touched here.
 */
export const permissionsRouter = createTRPCRouter({
  /**
   * The current member's composed capability snapshot for the client provider —
   * the coarse verb `keys` PLUS the per-def access map (`defAccess` +
   * `restrictedEntityDefIds`) and `role`/`seatType`, so the client can run the
   * same most-specific-wins `canViewEntity`/`canEditEntity` math as the server
   * (capability layer v2 §11.1).
   */
  myCapabilities: protectedProcedure.query(async ({ ctx }) => {
    const caps = await getCapabilities(ctx.session.userId, ctx.session.organizationId)
    return caps.toClientCapabilities()
  }),

  /**
   * The USER role's per-area level defaults — the informational baseline the
   * settings page shows beside each editable area (what admins deviate from).
   */
  roleDefaults: adminProcedure.query(() => ROLE_DEFAULTS.USER),

  /**
   * Every stored grant row for the org (the member baseline + group + user
   * overrides), each a sparse per-area level map. One query hydrates all three
   * sections of the permissions settings page.
   *
   * TODO(plan-19-step-7): the `member` profile's row is presented as
   * `role:org_member` so the shipped baseline tab reads back exactly what the
   * redirected write stored — see `permissions-member-baseline.ts`.
   */
  listGrants: adminProcedure.query(async ({ ctx }) => {
    const rows = await listGranteeGrants(ctx.session.organizationId, ctx.db)
    const grants = await bridgeMemberBaselineGrants(ctx.session.organizationId, rows)
    return { grants }
  }),

  /**
   * Set (upsert) the per-area levels for one grantee.
   *
   * TODO(plan-19-step-7): a `role:org_member` target is redirected onto the org's
   * `member` profile — the only tier the composer reads (§0.8).
   */
  grant: adminProcedure
    .input(
      z.object({
        granteeType,
        granteeId: z.string(),
        levels: levelsInput,
      })
    )
    .mutation(async ({ ctx, input }) => {
      const grantee = await resolveGrantGrantee(ctx.session.organizationId, input)

      const grant = await setGranteeLevels({
        db: ctx.db,
        organizationId: ctx.session.organizationId,
        granteeType: grantee.granteeType,
        granteeId: grantee.granteeId,
        // Coerced `Record<string, number>`; `parseAreaLevels` in the service
        // normalizes to a trusted `Partial<Record<Area, Level>>`.
        levels: input.levels as Partial<Record<Area, Level>>,
        grantedById: ctx.session.userId,
      })

      await recordAuditFromCtx(ctx, {
        category: 'members',
        action: 'permission.granted',
        targetType: 'PermissionGrant',
        targetId: grant.id,
        // The RESOLVED grantee — the row that was actually written.
        newState: {
          granteeType: grantee.granteeType,
          granteeId: grantee.granteeId,
          levels: input.levels,
        },
      })

      return grant
    }),

  /**
   * Remove the grant row for one grantee. A `role:org_member` target is
   * redirected the same way as {@link permissionsRouter.grant}.
   */
  revoke: adminProcedure
    .input(
      z.object({
        granteeType,
        granteeId: z.string(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const grantee = await resolveGrantGrantee(ctx.session.organizationId, input)

      const removed = await clearGranteeLevels({
        db: ctx.db,
        organizationId: ctx.session.organizationId,
        granteeType: grantee.granteeType,
        granteeId: grantee.granteeId,
      })

      await recordAuditFromCtx(ctx, {
        category: 'members',
        action: 'permission.revoked',
        targetType: 'PermissionGrant',
        targetId: `${grantee.granteeType}:${grantee.granteeId}`,
        newState: { granteeType: grantee.granteeType, granteeId: grantee.granteeId, removed },
      })

      return { removed }
    }),
})
