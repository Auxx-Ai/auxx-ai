// apps/web/src/server/api/routers/resourceAccess.ts

import { ResourceGranteeType, ResourcePermission } from '@auxx/database/enums'
import { getCachedResources } from '@auxx/lib/cache'
import { BadRequestError } from '@auxx/lib/errors'
import { isAdminOrOwner } from '@auxx/lib/members'
import {
  buildDefIdToSlug,
  FeatureKey,
  FeaturePermissionService,
  getCapabilities,
  INSTANCE_ACCESS_RESOURCES,
  isInstanceAccessKey,
  type Level,
} from '@auxx/lib/permissions'
import type { ResourceAccessContext, ResourceAccessInfo } from '@auxx/lib/resource-access'
import {
  assertCanManageMailSharing,
  assertCanManageMailTypeAccess,
  assertMailSharingFeature,
  checkAccess,
  checkTypeAccess,
  getAllInstanceAccess,
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
import { parseRecordId, toRecordId } from '@auxx/types/resource'
import { TRPCError } from '@trpc/server'
import { z } from 'zod'
import { recordAuditFromCtx } from '~/server/api/audit-context'
import { assertProfileGranteesAuthorable, granteeTypeSchema } from '~/server/api/grantee-schema'
import { createTRPCRouter, protectedProcedure } from '../trpc'

/** Visibility lens on mail grants (mail-permissions §2.1). Optional everywhere. */
const lensSchema = z.enum(['metadata', 'subject', 'full']).nullish()

/**
 * Mail grants live in the entity-SLUG keyspace (`inbox:<id>`, `contact:<id>`):
 * `composeUserMailVisibility` buckets rows by `entityDefinitionId === 'inbox'`,
 * and `isMailSharingDef` gates authorization on the same literal. Record-layer
 * callers mint RecordIds from the EntityDefinition id instead (the inbox
 * settings page builds `toRecordId(inboxResource.id, inboxId)`), so their grants
 * landed under a key mail visibility never reads — a `subject` share silently did
 * nothing — AND skipped both `assertCanManageMailSharing` and the enterprise gate.
 *
 * Resolve the def part through the existing `buildDefIdToSlug` resolver and
 * rewrite ONLY when it lands on a mail-sharing def. Every other resource keeps
 * the key it was called with: instance rows for custom defs have no stable slug
 * (`entityType` is null, so the resolver falls back to the renameable apiSlug).
 */
async function canonicalMailRecordId(
  organizationId: string,
  recordId: RecordId
): Promise<RecordId> {
  const { entityDefinitionId, entityInstanceId } = parseRecordId(recordId)
  if (isMailSharingDef(entityDefinitionId)) return recordId
  const slug = buildDefIdToSlug(await getCachedResources(organizationId))(entityDefinitionId)
  return isMailSharingDef(slug) ? toRecordId(slug, entityInstanceId) : recordId
}

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
  // Deliberately role-based, not a capability — governance decision (doc 04 §9):
  // managing a def's record access is OWNER/ADMIN-only by rank (plan 21 §5.2).
  if (!(await isAdminOrOwner(ctx.session.organizationId, ctx.session.userId))) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'You must be an admin or owner to manage record access',
    })
  }
}

/**
 * Plan gate for per-def (type-level) record-access EDITING (plan 23 §2.1):
 * writing def-wide grants is part of the paid `granularPermissions` feature.
 * Mail-infra defs are exempt — inbox/mail sharing is core product on every
 * plan — and removals (`revokeType`) stay ungated because revoking only
 * tightens access (mirrors the `clearGranteeLevels` doctrine in the
 * permissions router). `requireAccess` throws an AuxxError which
 * `auxxErrorMiddleware` maps to the right HTTP status.
 */
async function assertTypeAccessEditFeature(
  ctx: { db: any; session: { organizationId: string } },
  entityDefinitionId: string
): Promise<void> {
  if (isMailSharingDef(entityDefinitionId)) return
  await new FeaturePermissionService(ctx.db).requireAccess(
    ctx.session.organizationId,
    FeatureKey.granularPermissions
  )
}

/**
 * Authorize a per-INSTANCE sharing mutation (§1.6). If the target's def id is an
 * instance-access resource (datasets etc.), managing its sharing requires
 * `canAdminInstance(key, instanceId)` **or** OWNER/ADMIN — scoped to the exact
 * `entityInstanceId` (no cross-instance escalation) — and returns `true` so the
 * caller SKIPS the mail-sharing authorizer + feature gate. Returns `false` for
 * generic mail targets (`contact:<id>`, `inbox:<id>`, …), which fall through to
 * {@link assertCanManageMailSharing}.
 */
async function authorizeInstanceTarget(
  ctx: { db: any; session: { organizationId: string; userId: string } },
  recordId: string
): Promise<boolean> {
  const { entityDefinitionId, entityInstanceId } = parseRecordId(recordId as RecordId)
  if (!isInstanceAccessKey(entityDefinitionId)) return false
  const capabilities = await getCapabilities(ctx.session.userId, ctx.session.organizationId)
  capabilities.assertAdminInstance(entityDefinitionId, entityInstanceId)
  return true
}

/**
 * Mail-share targets that {@link authorizeInstanceTarget} now claims — the ones
 * plan 40 phase 1 moved off {@link assertCanManageMailSharing} by making them
 * `INSTANCE_ACCESS_RESOURCES` keys. Today exactly `inbox` and `personal_inbox`:
 * they are the only members of `MAIL_SHARING_DEFS` that are also instance-access
 * keys, because `thread` and `contact` are deliberately excluded from that
 * registry (a per-record contact grant would fan a full lens across that
 * contact's entire conversation history) and must stay excluded.
 *
 * Derived from the two predicates rather than re-listing the slugs, so it says
 * what it means: "this target routes through the instance authorizer instead of
 * the mail guard, and therefore lost the guard's self-revoke hatch."
 */
function isInstanceRoutedMailDef(entityDefinitionId: string): boolean {
  return isMailSharingDef(entityDefinitionId) && isInstanceAccessKey(entityDefinitionId)
}

export const resourceAccessRouter = createTRPCRouter({
  /** Grant access to a specific entity instance */
  grantInstance: protectedProcedure
    .input(
      z.object({
        recordId: z.string(),
        granteeType: granteeTypeSchema,
        granteeId: z.string(),
        // `none` is accepted only as the workspace-baseline (`role:org_member`)
        // downward marker for instance-access resources (datasets etc. — §1.4):
        // it restricts the instance without granting anyone. Mail-share targets
        // never send it (their picker is view/manager). The compose + resolver
        // already keep `'none'` instance rows as an explicit floor.
        permission: z.enum([
          ResourcePermission.none,
          ResourcePermission.view,
          ResourcePermission.edit,
          ResourcePermission.admin,
        ]),
        lens: lensSchema,
      })
    )
    .mutation(async ({ ctx, input }) => {
      const context = toContext(ctx)
      const recordId = await canonicalMailRecordId(
        ctx.session.organizationId,
        input.recordId as RecordId
      )
      // `none` is the instance-access baseline lockdown marker (§1.4). The enum
      // permits it, but it must never land on a mail-share target — reject it for
      // any non-instance-access recordId (defense in depth; mail pickers never
      // send it). Keeps the shared enum honest without a per-consumer schema.
      if (
        input.permission === ResourcePermission.none &&
        !isInstanceAccessKey(parseRecordId(recordId).entityDefinitionId)
      ) {
        throw new BadRequestError(
          'The "none" permission is only valid for instance-access resources'
        )
      }
      await assertProfileGranteesAuthorable(ctx.session.organizationId, input.granteeType, [
        input.granteeId,
      ])
      if (!(await authorizeInstanceTarget(ctx, recordId))) {
        await assertCanManageMailSharing(context, recordId)
      }
      // The plan gate runs REGARDLESS of which authorizer answered. Since plan 40
      // phase 1 put `inbox`/`personal_inbox` in `INSTANCE_ACCESS_RESOURCES`, an
      // inbox target takes the `assertAdminInstance` branch above — which is the
      // intended replacement for the guard's `inbox` arm (§5.3), but would have
      // taken the Enterprise `mailPermissions` gate with it. §2 lists that gate
      // (sub-`full` lenses and NEW Manager rows) as explicitly out of scope, so it
      // stays on its own line here. No-op for every non-mail def.
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
        targetId: recordId,
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
        granteeType: granteeTypeSchema,
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
      await assertTypeAccessEditFeature(ctx, input.entityDefinitionId)
      await assertProfileGranteesAuthorable(ctx.session.organizationId, input.granteeType, [
        input.granteeId,
      ])
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
        granteeType: granteeTypeSchema,
        granteeId: z.string(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const context = toContext(ctx)
      const recordId = await canonicalMailRecordId(
        ctx.session.organizationId,
        input.recordId as RecordId
      )
      // SELF-REVOKE — a grantee removing THEIR OWN row (§7's "leave a shared
      // thread", and the same affordance on an inbox).
      //
      // `assertCanManageMailSharing` has always carried this hatch, but plan 40
      // phase 1 made `inbox`/`personal_inbox` instance-access keys, so those
      // targets started routing through `authorizeInstanceTarget` →
      // `assertAdminInstance` and skipped the guard — and with it the hatch —
      // entirely. Net: a `view` grantee could no longer drop their own inbox
      // grant. Restored here for exactly the targets phase 1 re-routed; every
      // other revoke keeps `assertAdminInstance` / the mail guard unchanged.
      //
      // Two conditions, both copied from the guard for the same reasons:
      //  - **`user` grantees ONLY.** A group/profile/role row is shared policy;
      //    letting one holder delete it would silently revoke everyone else.
      //  - **The CALLER's own id ONLY.** This is "remove the grant that names
      //    ME", never "remove someone else's" — and `revokeInstanceAccess`
      //    deletes by the same `(recordId, granteeType, granteeId)` triple, so
      //    the row reached is provably the one that passed this test.
      //
      // It cannot become a plan-gate bypass: `revokeInstance` runs no
      // `assertMailSharingFeature` at all (revoking only tightens access, so the
      // Enterprise `mailPermissions` gate lives on `grantInstance`/`setInstance`,
      // where phase 3 hoisted it onto its own unconditional line). Nothing here
      // widens access, so there is no gate to route around.
      const isSelfRevoke =
        input.granteeType === ResourceGranteeType.user && input.granteeId === ctx.session.userId
      const selfRevokingMailGrant =
        isSelfRevoke && isInstanceRoutedMailDef(parseRecordId(recordId).entityDefinitionId)

      if (!selfRevokingMailGrant && !(await authorizeInstanceTarget(ctx, recordId))) {
        await assertCanManageMailSharing(context, recordId, {
          selfRevokeGranteeId: input.granteeId,
          selfRevokeGranteeType: input.granteeType,
        })
      }
      const revoked = await revokeInstanceAccess(context, {
        recordId,
        granteeType: input.granteeType,
        granteeId: input.granteeId,
      })
      await recordAuditFromCtx(ctx, {
        category: 'security',
        action: 'permission.revoked',
        targetType: 'Resource',
        targetId: recordId,
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
        granteeType: granteeTypeSchema,
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
        granteeType: granteeTypeSchema,
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
      const recordId = await canonicalMailRecordId(
        ctx.session.organizationId,
        input.recordId as RecordId
      )
      await assertProfileGranteesAuthorable(
        ctx.session.organizationId,
        input.granteeType,
        input.grants.map((g) => g.granteeId)
      )
      if (!(await authorizeInstanceTarget(ctx, recordId))) {
        await assertCanManageMailSharing(context, recordId)
      }
      // See `grantInstance` — the plan gate is independent of the authorizer.
      await assertMailSharingFeature(context, recordId, input.grants)
      await setInstanceAccess(context, recordId, input.granteeType, input.grants)
      await recordAuditFromCtx(ctx, {
        category: 'security',
        action: 'permission.set',
        targetType: 'Resource',
        targetId: recordId,
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
        granteeType: granteeTypeSchema,
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
      await assertTypeAccessEditFeature(ctx, input.entityDefinitionId)
      await assertProfileGranteesAuthorable(
        ctx.session.organizationId,
        input.granteeType,
        input.grants.map((g) => g.granteeId)
      )
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

  /**
   * Get all access grants for a specific instance.
   *
   * `user` grantees are annotated with `granteeAreaLevel` — their composed
   * Layer-2 level for the instance's L2 `area` (capability layer v2 Part B.2.8)
   * — so the Share UI can warn when a row is inert. Since plan 25 §2 an explicit
   * row BEATS the area floor, so `Level.None` alone no longer means dead: a
   * positive grant to such a member is exactly how a single-instance share
   * works. Only `Level.None` paired with an explicit `'none'` permission is
   * inert (it removes access they never had), which is the pairing
   * `instance-share-body.tsx` warns on. Skipped for non-`user` grantees
   * (group/team/role/profile are level *sources*, not subjects) and for defs
   * outside the instance-access registry.
   * `getCapabilities` is cache-backed, and only the few user grantees on one
   * instance are resolved, so this stays cheap even though it fans out to one
   * cache read per grantee.
   */
  forInstance: protectedProcedure
    .input(
      z.object({
        recordId: z.string(),
      })
    )
    .query(
      async ({ ctx, input }): Promise<Array<ResourceAccessInfo & { granteeAreaLevel?: Level }>> => {
        const recordId = await canonicalMailRecordId(
          ctx.session.organizationId,
          input.recordId as RecordId
        )
        const rows = await getInstanceAccess(toContext(ctx), recordId)
        const { entityDefinitionId } = parseRecordId(recordId)
        if (!isInstanceAccessKey(entityDefinitionId)) return rows

        const area = INSTANCE_ACCESS_RESOURCES[entityDefinitionId].area
        return Promise.all(
          rows.map(async (row) => {
            if (row.granteeType !== ResourceGranteeType.user) return row
            const capabilities = await getCapabilities(row.granteeId, ctx.session.organizationId)
            return { ...row, granteeAreaLevel: capabilities.areaLevel(area) }
          })
        )
      }
    ),

  /**
   * All instance-level access rows for the org's instance-access resources
   * (datasets/KB/dashboards — capability layer v2 Part B.2.5). The instance
   * twin of `allTypeAccess`: today only type-level rows can be read in bulk,
   * so a collapsed per-instance row in the permissions grid can't show a
   * "Restricted / Shared · N" badge without one query per instance. Same
   * admin gate as `allTypeAccess` — it reveals the org's per-instance sharing
   * map.
   */
  allInstanceAccess: protectedProcedure.query(async ({ ctx }): Promise<ResourceAccessInfo[]> => {
    if (!(await isAdminOrOwner(ctx.session.organizationId, ctx.session.userId))) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'You must be an admin or owner to view instance-level access',
      })
    }
    return getAllInstanceAccess(toContext(ctx))
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
    // Deliberately role-based, not a capability — governance decision (doc 04 §9):
    // managing org-wide record access is OWNER/ADMIN-only by rank (plan 21 §5.2).
    if (!(await isAdminOrOwner(ctx.session.organizationId, ctx.session.userId))) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'You must be an admin or owner to view type-level access',
      })
    }
    return getAllTypeAccess(toContext(ctx))
  }),
})
