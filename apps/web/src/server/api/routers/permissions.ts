// apps/web/src/server/api/routers/permissions.ts

import { getCachedPermissionProfiles } from '@auxx/lib/cache'
import {
  type Area,
  clearGranteeLevels,
  createPermissionProfile,
  getCapabilities,
  Level,
  listGranteeGrants,
  PermissionKey,
  type ProfileCeiling,
  ROLE_DEFAULTS,
  savePermissionProfile,
  setGranteeLevels,
} from '@auxx/lib/permissions'
import { z } from 'zod'
import { recordAuditFromCtx } from '~/server/api/audit-context'
import { createTRPCRouter, protectedProcedure } from '~/server/api/trpc'
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

/** A profile's own intrinsic cap (§0.13/§0.14) — areas plus the def allow/deny list. */
const ceilingInput = z
  .object({
    areas: levelsInput.optional(),
    defs: z.object({ mode: z.enum(['only', 'except']), slugs: z.array(z.string()) }).nullish(),
  })
  .nullable()

/** Profile identity chrome (§7): an icon id + colour token, or nothing. */
const iconInput = z.object({ iconId: z.string(), color: z.string() }).nullable()

/**
 * The Layer-2 gate for this router: the `permissions` area itself.
 *
 * Doc 19 §0.25 makes `permissions` grantable (it was `adminOnly`), which is only
 * true if the routers behind it stop being binary `adminProcedure` checks —
 * otherwise the area renders as a lever that does nothing. OWNER/ADMIN still pass
 * unconditionally: they hold every key through `ROLE_DEFAULTS`, so this is strictly
 * wider than the `adminProcedure` it replaces, never narrower.
 *
 * Deliberately capability-ONLY, with no `FeatureKey.granularPermissions` check:
 * §0.26 plan-gates profile **writes** and never composition or reads. The write
 * gate lives in `savePermissionProfile` / `createPermissionProfile` /
 * `setGranteeLevels` (and pointedly NOT in `clearGranteeLevels` — removal only
 * tightens, so a downgraded org must still be able to clean up). Using
 * `permissionProcedure(permissionsManage)` here would hoist that plan check onto
 * every read and every revoke, which is exactly the §0.26 failure mode.
 */
const permissionsProcedure = protectedProcedure.use(async ({ ctx, next }) => {
  const capabilities = await getCapabilities(ctx.session.userId, ctx.session.organizationId)
  capabilities.assert(PermissionKey.permissionsManage)
  return next({ ctx: { capabilities } })
})

/**
 * Thin write/read surface for Layer-2 capability grants and permission profiles.
 * Every procedure below (except `myCapabilities`, which is every member's own
 * snapshot) is gated on the `permissions` area via {@link permissionsProcedure};
 * the grant/revoke pair delegates to the functional grant-service (which validates
 * the levels, applies the `granularPermissions` plan gate, and busts caches) and
 * the profile pair to `profiles/profile-save.ts`, which runs the §6.1 escalation
 * guard inside its own transaction.
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
  roleDefaults: permissionsProcedure.query(() => ROLE_DEFAULTS.USER),

  /**
   * Every stored grant row for the org (the member baseline + group + user
   * overrides), each a sparse per-area level map. One query hydrates all three
   * sections of the permissions settings page.
   *
   * TODO(plan-19-step-7): the `member` profile's row is presented as
   * `role:org_member` so the shipped baseline tab reads back exactly what the
   * redirected write stored — see `permissions-member-baseline.ts`.
   */
  listGrants: permissionsProcedure.query(async ({ ctx }) => {
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
  grant: permissionsProcedure
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
  revoke: permissionsProcedure
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

  /**
   * Every permission profile in the org (system + custom), off the cached
   * `profiles` projection — the same rows `computeUserCapabilities` composes from,
   * so the editor can never show a profile the composer does not read.
   *
   * A READ, therefore **not** plan-gated (§0.26): a Free org must still be able to
   * see the system profiles supplying its `ROLE_DEFAULTS`, it simply cannot edit
   * them.
   */
  listProfiles: permissionsProcedure.query(async ({ ctx }) => {
    const profiles = await getCachedPermissionProfiles(ctx.session.organizationId)
    return { profiles }
  }),

  /**
   * Create a custom profile. `seat` / `appliesTo` are accepted here and nowhere
   * else — they are immutable after creation (§0.18).
   *
   * No escalation guard: a brand-new profile has no holders, so the §6.1
   * resulting-state comparison is vacuous. The authority check bites on the first
   * save that gives it content and on assignment (step 8).
   */
  createProfile: permissionsProcedure
    .input(
      z.object({
        slug: z.string().min(1).max(64),
        name: z.string().min(1).max(120),
        description: z.string().max(500).nullish(),
        icon: iconInput.optional(),
        seat: z.enum(['full', 'worker']).optional(),
        appliesTo: z.enum(['member', 'agent', 'any']).optional(),
        baseLevel: z.number().int().min(Level.None).max(Level.Full).nullish(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const profile = await createPermissionProfile({
        db: ctx.db,
        organizationId: ctx.session.organizationId,
        actorUserId: ctx.session.userId,
        slug: input.slug,
        name: input.name,
        description: input.description ?? null,
        icon: input.icon ?? null,
        seat: input.seat,
        appliesTo: input.appliesTo,
        baseLevel: input.baseLevel ?? null,
      })

      await recordAuditFromCtx(ctx, {
        category: 'members',
        action: 'permission.profile.created',
        targetType: 'PermissionProfile',
        targetId: profile.id,
        newState: { slug: profile.slug, name: profile.name, seat: profile.seat },
      })

      return profile
    }),

  /**
   * The ONE transactional profile save (§6.1.4) — metadata, area levels and the
   * ceiling in a single mutation, because a save spanning several requests cannot
   * enforce one atomic "resulting effective state" check. There is deliberately no
   * metadata-only side door.
   *
   * `savePermissionProfile` owns the gates: the `granularPermissions` plan gate
   * (writes only), cross-org ownership, `owner`-profile immutability, the
   * OWNER/ADMIN-only rule for agent profiles, `assertGrantableLevels`, and the
   * §6.1 escalation guard over every affected holder's post-write state.
   */
  saveProfile: permissionsProcedure
    .input(
      z.object({
        profileId: z.string(),
        name: z.string().min(1).max(120).optional(),
        description: z.string().max(500).nullish(),
        icon: iconInput.optional(),
        levels: levelsInput.nullish(),
        baseLevel: z.number().int().min(Level.None).max(Level.Full).nullish(),
        ceiling: ceilingInput.optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const profile = await savePermissionProfile({
        db: ctx.db,
        organizationId: ctx.session.organizationId,
        actorUserId: ctx.session.userId,
        profileId: input.profileId,
        name: input.name,
        description: input.description,
        icon: input.icon,
        // Coerced `Record<string, number>` maps; `parseAreaLevels` inside the save
        // is the real gate (drops unknown areas, clamps each value).
        levels: input.levels as Partial<Record<Area, Level>> | null | undefined,
        baseLevel: input.baseLevel as Level | null | undefined,
        ceiling: input.ceiling as ProfileCeiling | null | undefined,
      })

      await recordAuditFromCtx(ctx, {
        category: 'members',
        action: 'permission.profile.updated',
        targetType: 'PermissionProfile',
        targetId: profile.id,
        newState: {
          slug: profile.slug,
          name: profile.name,
          levels: input.levels ?? undefined,
          baseLevel: input.baseLevel ?? undefined,
          ceiling: input.ceiling ?? undefined,
        },
      })

      return profile
    }),
})
