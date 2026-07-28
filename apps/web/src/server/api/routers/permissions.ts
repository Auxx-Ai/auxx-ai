// apps/web/src/server/api/routers/permissions.ts

import {
  type AgentPermissionPolicy,
  type Area,
  clearGranteeLevels,
  createPermissionProfile,
  getCapabilities,
  getPermissionProfile,
  Level,
  listGranteeGrants,
  listPermissionProfiles,
  PermissionKey,
  ROLE_DEFAULTS,
  savePermissionProfile,
  setGranteeLevels,
} from '@auxx/lib/permissions'
import { z } from 'zod'
import { recordAuditFromCtx } from '~/server/api/audit-context'
import { createTRPCRouter, protectedProcedure } from '~/server/api/trpc'

/**
 * Grantee vocabulary for capability grants (§3.2) — the two **override** tiers,
 * and only those.
 *
 * `'profile'` is absent because a profile is the composition BASE, not a raise
 * above it, and every base write must go through {@link
 * permissionsRouter.saveProfile}: that is the only path running the §6.1
 * escalation guard over each holder's resulting effective state.
 * `setGranteeLevels` runs `assertGrantableLevels` alone, which today blocks only
 * the single `adminOnly` area (`settings`) — so a `profile` grantee here would
 * let a non-admin `permissionsManage` holder write `billing`/`members`/
 * `permissions` into a profile's base with no authority check at all.
 *
 * `'role'` is absent for the same reason, one step removed: plan 19 §0.8 deleted
 * the `role:org_member` `PermissionGrant` tier (no composer reads it — see
 * `compute-user-capabilities.ts`'s grantee union), and the interim bridge that
 * redirected that address onto the org's `member` profile was exactly the
 * guard-free side door described above. Both are gone; the Member profile is
 * edited in one place, Profiles → Member.
 */
const granteeType = z.enum(['group', 'user'])

/**
 * A sparse per-area level payload: `{ [areaSlug]: 0-3 }`; missing areas fall
 * through. Keys are accepted as plain strings and values coerced to `0..3`
 * numbers — `setGranteeLevels` runs `parseAreaLevels`, which is the real gate
 * (drops unknown/renamed area slugs, clamps each value). Keeping this loose
 * avoids brittle enum-shape mismatches (e.g. a client sending `"3"` vs `3`).
 */
const levelsInput = z.record(z.string(), z.coerce.number().int().min(Level.None).max(Level.Full))

/** Profile identity chrome (§7): an icon id + colour token, or nothing. */
const iconInput = z.object({ iconId: z.string(), color: z.string() }).nullable()

/**
 * One exact-policy keyspace of an agent profile: an explicit `default` plus
 * sparse `overrides` (plan 19 §2.3).
 *
 * The rung vocabulary is closed, so it is a `z.enum` rather than a loose string —
 * a typo'd rung must be a 400, not a value silently dropped into "reads as the
 * default". Keys stay free strings (area slugs, entity `apiSlug`s, instance ids);
 * `parseAgentPolicy` inside the save is the gate that normalizes them.
 */
const exactAgentPolicyInput = z.object({
  default: z.enum(['none', 'read', 'read_write', 'full']),
  overrides: z.record(z.string(), z.enum(['none', 'read', 'read_write', 'full'])),
})

/**
 * `PermissionProfile.agentPolicy` — the agent half of a profile (§2.3). Typed as
 * `ZodType<AgentPermissionPolicy>` on purpose: if the stored shape gains a
 * keyspace, this input fails to compile instead of quietly stripping it, which is
 * exactly the failure this field shipped with (the whole editor reported saved and
 * persisted nothing).
 */
const agentPolicyInput: z.ZodType<AgentPermissionPolicy> = z.object({
  areas: exactAgentPolicyInput,
  definitions: exactAgentPolicyInput,
  resourceDefault: z.enum(['none', 'read', 'read_write', 'full']),
  resources: z.record(z.string(), exactAgentPolicyInput),
})

/**
 * The Layer-2 gate for this router: the `permissions` area itself.
 *
 * Doc 19 §0.25 makes `permissions` grantable (it was `adminOnly`), which was only
 * true once the routers behind it stopped being binary role checks — otherwise
 * the area would render as a lever that does nothing. OWNER/ADMIN still pass
 * unconditionally: they hold every key through `ROLE_DEFAULTS`, so this is strictly
 * wider than the since-deleted `adminProcedure` it replaced, never narrower.
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
 * Profile READS are also served to `agentsManage` holders: the agent builder's
 * Permissions tab renders the bound profile and its resolved policy read-only
 * for anyone who can open the builder (doc 14 §0.9 — only *editing* is
 * restricted, and binding still runs through `agent.update`'s own guards).
 * Without this, a member granted `agents` but not `permissions` 403s on the tab.
 */
const profileReadProcedure = protectedProcedure.use(async ({ ctx, next }) => {
  const capabilities = await getCapabilities(ctx.session.userId, ctx.session.organizationId)
  if (!capabilities.has(PermissionKey.agentsManage)) {
    capabilities.assert(PermissionKey.permissionsManage)
  }
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
 * **The two write surfaces are not interchangeable.** `grant`/`revoke` reach the
 * raise-only override tiers (`group`, `user`); `saveProfile` is the ONLY way to
 * write a profile's per-area base, because it is the only one that runs the §6.1
 * escalation guard. See {@link granteeType} for why `'profile'`/`'role'` are not
 * on the wire.
 *
 * `ResourceAccess`'s `role:org_member` rows (the per-def / per-instance workspace
 * defaults) are a DIFFERENT, still-live mechanism on a different table and are
 * not touched here — they are written through the `resourceAccess` router.
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
   * The USER role's per-area level defaults. Post plan-22 (member baseline
   * strip) this is the all-`None` floor, not an informational baseline —
   * `ROLE_DEFAULTS.USER` is what an area falls through to when NOTHING sets
   * it, and nothing does by default anymore. The baseline an override grid
   * shows beside each area (what a grant deviates from) lives in the Member
   * profile's seeded `PermissionGrant` row, which arrives as an ordinary
   * `profile` row through {@link permissionsRouter.listGrants}.
   */
  roleDefaults: permissionsProcedure.query(() => ROLE_DEFAULTS.USER),

  /**
   * Every stored grant row for the org — the profile bases plus the group and
   * user overrides — each a sparse per-area level map. One query hydrates the
   * whole permissions settings page.
   *
   * Rows are returned verbatim: the org's `member` profile is one `profile` row
   * among the others, with no address rewriting. (It used to be presented as
   * `role:org_member` for the retired Member-baseline grid; that bridge, and the
   * guard-free write path it implied, are gone.)
   */
  listGrants: permissionsProcedure.query(async ({ ctx }) => {
    const grants = await listGranteeGrants(ctx.session.organizationId, ctx.db)
    return { grants }
  }),

  /**
   * Set (upsert) the per-area levels for one **override** grantee (group or
   * user). Profile bases are not writable here — see {@link granteeType}.
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
      const grant = await setGranteeLevels({
        db: ctx.db,
        organizationId: ctx.session.organizationId,
        granteeType: input.granteeType,
        granteeId: input.granteeId,
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
        newState: {
          granteeType: input.granteeType,
          granteeId: input.granteeId,
          levels: input.levels,
        },
      })

      return grant
    }),

  /** Remove the grant row for one override grantee (group or user). */
  revoke: permissionsProcedure
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

  /**
   * Every permission profile in the org (system + custom), off the cached
   * `profiles` projection — the same rows `computeUserCapabilities` composes from,
   * so the editor can never show a profile the composer does not read.
   *
   * Returns a bare, deterministically ordered array of picker rows
   * (`{ id, slug, name, description, icon, seat, appliesTo, isSystem, baseLevel }`):
   * seeded profiles in their §5.1 ladder order first, then custom ones by name.
   * `ceiling` / `agentPolicy` are deliberately NOT here — a list renders identity,
   * not policy; use {@link permissionsRouter.getProfile} for those.
   *
   * A READ, therefore **not** plan-gated (§0.26): a Free org must still be able to
   * see the system profiles supplying its `ROLE_DEFAULTS`, it simply cannot edit
   * them.
   */
  listProfiles: profileReadProcedure.query(async ({ ctx }) =>
    listPermissionProfiles(ctx.session.organizationId)
  ),

  /**
   * One profile with its policy payload — the summary fields plus `agentPolicy`
   * (agent exact policy, §2.3) and `updatedAt`. `ceiling` rides along as the
   * narrowed, unauthored per-area clamp (plan 20 §2.a.3) and is `null` for every
   * profile; no editor control reads it.
   *
   * Scoped to the session org by construction: it reads that org's `profiles`
   * cache entry, so an id from another org is indistinguishable from a missing
   * one and both raise `NotFoundError` (404) rather than leaking existence.
   *
   * Reading a profile is served to `permissionsManage` OR `agentsManage`
   * holders (see {@link profileReadProcedure}); *writing* one stays
   * OWNER/ADMIN-only inside `savePermissionProfile` (doc 14 §0.9).
   */
  getProfile: profileReadProcedure
    .input(z.object({ profileId: z.string() }))
    .query(async ({ ctx, input }) =>
      getPermissionProfile(ctx.session.organizationId, input.profileId)
    ),

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
   * The ONE transactional profile save (§6.1.4) — metadata and area levels in a
   * single mutation, because a save spanning several requests cannot enforce one
   * atomic "resulting effective state" check. There is deliberately no
   * metadata-only side door.
   *
   * There is no `ceiling` field: the profile ceiling lost its authoring surface in
   * plan 20 §2.a.1. It survives as an unauthored clamp inside
   * `composeUserCapabilities`, so nothing on the wire can set it.
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
        /**
         * The agent-profile exact policy. OWNER/ADMIN-only — the save enforces
         * that, not this input. `null` clears it; omit to leave it untouched.
         */
        agentPolicy: agentPolicyInput.nullish(),
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
        agentPolicy: input.agentPolicy,
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
          // The policy IS the authority for an agent profile — an audit row that
          // omits it records that permissions changed without recording to what.
          agentPolicy: input.agentPolicy === undefined ? undefined : input.agentPolicy,
        },
      })

      return profile
    }),
})
