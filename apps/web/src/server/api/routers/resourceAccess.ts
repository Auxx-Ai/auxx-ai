// apps/web/src/server/api/routers/resourceAccess.ts

import { ResourceGranteeType, RungValues } from '@auxx/database/enums'
import { getCachedResources, getCachedUserInstanceGrants } from '@auxx/lib/cache'
import { BadRequestError, ForbiddenError } from '@auxx/lib/errors'
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
  getAllInstanceAccess,
  getAllTypeAccess,
  getInstanceAccess,
  getTypeAccess,
  grantInstanceAccess,
  grantTypeAccess,
  isMailSharingDef,
  ORG_MEMBER_GRANTEE_ID,
  revokeInstanceAccess,
  revokeTypeAccess,
  setInstanceAccess,
  setTypeAccess,
} from '@auxx/lib/resource-access'
// DEEP SUBPATH on purpose (plan v3/04 §10.2, and the same rule HANDOFF §5
// correction 5 states for `field-value-host-access.ts`): the guard's whole point
// is that it does NOT drag the dataset/connector service graph in behind it, and
// routing it through the `@auxx/lib/resource-access` barrel would give that back.
import {
  assertCanManageRecordSharing,
  // The record plan gate MOVED into lib (plan v3/04 §3.5). It used to be a
  // private copy in this file, which meant the approval-decision handler — which
  // runs in `packages/lib` and also calls `grantInstanceAccess` — bypassed it
  // entirely: a non-Enterprise org could not share a record through this router
  // but COULD through an approved access request. Two copies of a gate that must
  // never disagree is the bug that closed; this file now imports the one copy.
  assertRecordSharingFeature,
} from '@auxx/lib/resource-access/record-sharing-guard'
import type { RecordId } from '@auxx/types/resource'
import { parseRecordId, toRecordId } from '@auxx/types/resource'
import { TRPCError } from '@trpc/server'
import { z } from 'zod'
import { recordAuditFromCtx } from '~/server/api/audit-context'
import { assertProfileGranteesAuthorable, granteeTypeSchema } from '~/server/api/grantee-schema'
import { createTRPCRouter, protectedProcedure } from '../trpc'

/**
 * The grant ladder on the wire (plan v3/03 §3). ONE field where `permission` +
 * `lens` used to be two — the mail tiers (`metadata`, `identity`) and the
 * config-scale tiers (`read`, `edit`, `admin`) are rungs on the same ladder, so
 * the input no longer has to express a two-column encoding the storage layer
 * stopped having.
 *
 * `none` is included and is a RESTRICTION marker, never a grant; the mutations
 * below narrow WHERE it is legal (instance-access resources only, and at type
 * level only for `role:org_member`).
 */
const rungSchema = z.enum(RungValues)

/**
 * {@link rungSchema} minus `none` — for the two `set*` replace-all mutations,
 * which never author a restriction (a removed grantee is expressed by ABSENCE
 * from the array, not by a `none` row).
 */
const grantRungSchema = z.enum(['metadata', 'identity', 'read', 'edit', 'admin'])

/**
 * Mail grants live in the entity-SLUG keyspace (`inbox:<id>`, `contact:<id>`):
 * `composeUserInstanceGrants` buckets rows by `entityDefinitionId === 'inbox'`,
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
 * Authorize a per-INSTANCE sharing mutation (§1.6). Answers `true` when it has
 * FULLY authorized the target, `false` only for the mail-share targets that must
 * fall through to {@link assertCanManageMailSharing} (`thread:<id>`,
 * `contact:<id>`).
 *
 * Three lanes, in this order — the ordering is load-bearing:
 *  1. **instance-access resources** (datasets, KBs, and since plan 40 phase 1
 *     `inbox`/`personal_inbox`): `canAdminInstance(key, instanceId)`, scoped to
 *     the exact `entityInstanceId` so there is no cross-instance escalation.
 *     Checked FIRST because `inbox` is both an instance-access key and a
 *     mail-sharing def, and phase 1 deliberately routes it here rather than to
 *     the mail guard (§5.3).
 *  2. **the remaining mail-share defs** — `thread` and `contact`, which are
 *     excluded from the instance-access registry on purpose — hand back `false`.
 *  3. **everything else is a record def**: {@link assertCanManageRecordSharing}.
 *     This arm used to be a bare `return false`, which authorized nothing.
 */
async function authorizeInstanceTarget(
  ctx: { db: any; session: { organizationId: string; userId: string } },
  recordId: string
): Promise<boolean> {
  const { entityDefinitionId, entityInstanceId } = parseRecordId(recordId as RecordId)
  // Lane 2 before the capability read: `thread`/`contact` answer to the mail
  // guard, which resolves its own (mail-visibility) authority.
  if (!isInstanceAccessKey(entityDefinitionId) && isMailSharingDef(entityDefinitionId)) {
    return false
  }
  const capabilities = await getCapabilities(ctx.session.userId, ctx.session.organizationId)
  if (isInstanceAccessKey(entityDefinitionId)) {
    capabilities.assertAdminInstance(entityDefinitionId, entityInstanceId)
    return true
  }
  await assertCanManageRecordSharing(toContext(ctx), capabilities, recordId as RecordId)
  return true
}

/**
 * Authorize READING one instance's grantee list (plan v3/03 §7.2).
 *
 * `forInstance` shipped with **no authorization at all**: any member could
 * enumerate the grantees (user / group / profile ids, rung) of any
 * `recordId` — `inbox:*`, `thread:*`, `contact:*` included — because
 * `getInstanceAccess` filters on org + def + instance only.
 *
 * **The bar is "may the caller SEE the target", not "may they manage its
 * sharing".** Deliberately weaker than the write authorizer, because every share
 * surface in the tree renders a READ-ONLY grantee list to non-managers once a
 * target has grants: `ThreadSharePopover` (a `read`-lens viewer who is not an
 * inbox Manager), `ContactSharedWithCard` (non-admins), `InboxInfoCard` (the
 * inbox detail page's info panel), and `InstanceShareBody`'s disabled state.
 * Gating on the write authority would blank all four. Gating on visibility is
 * also the honest rule: knowing who else can see a thing you can see leaks
 * nothing about a thing you cannot.
 *
 * Three lanes, mirroring {@link authorizeInstanceTarget}:
 *  - instance-access keys → `assertViewInstance` (Read rung on that instance);
 *  - `thread` → the caller's composed lens must be above `none`. `canViewEntity`
 *    is useless here: `thread` is in `NON_RECORD_DEF_SLUGS`, so it answers `true`
 *    unconditionally and mail visibility is the only real authority;
 *  - `contact` and every record def → `assertViewEntity(def)`, which is what the
 *    contact drawer / record drawer the list is mounted in already requires.
 */
async function assertCanReadInstanceAccess(
  ctx: { db: any; session: { organizationId: string; userId: string } },
  recordId: RecordId
): Promise<void> {
  const { entityDefinitionId, entityInstanceId } = parseRecordId(recordId)
  const { organizationId, userId } = ctx.session
  if (isInstanceAccessKey(entityDefinitionId)) {
    const capabilities = await getCapabilities(userId, organizationId)
    capabilities.assertViewInstance(entityDefinitionId, entityInstanceId)
    return
  }
  if (entityDefinitionId === 'thread') {
    // Lazy import: the visibility barrel is heavy (it pulls the mail composer),
    // and this is the only branch that needs it — the same shape
    // `api/messages/[messageId]/body/route.ts` uses.
    const { getThreadLens } = await import('@auxx/lib/permissions/visibility')
    const viewer = await getCachedUserInstanceGrants(userId, organizationId)
    const lens = await getThreadLens(ctx.db, organizationId, viewer, entityInstanceId)
    if (lens === 'none') {
      throw new ForbiddenError("You don't have permission to view this conversation.")
    }
    return
  }
  const capabilities = await getCapabilities(userId, organizationId)
  capabilities.assertViewEntity(entityDefinitionId)
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
        rung: rungSchema,
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
        input.rung === 'none' &&
        !isInstanceAccessKey(parseRecordId(recordId).entityDefinitionId)
      ) {
        throw new BadRequestError('The "none" rung is only valid for instance-access resources')
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
      // taken the `granularPermissions` plan gate with it. §2 lists that gate
      // (sub-`read` rungs and NEW Manager rows) as explicitly out of scope, so it
      // stays on its own line here. No-op for every non-mail def.
      await assertMailSharingFeature(context, recordId, [input])
      await assertRecordSharingFeature(context, recordId)
      await grantInstanceAccess(context, {
        recordId,
        granteeType: input.granteeType,
        granteeId: input.granteeId,
        rung: input.rung,
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
          rung: input.rung,
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
        rung: rungSchema,
      })
    )
    .mutation(async ({ ctx, input }) => {
      // `none` is a RESTRICTION marker, never a grant — and at type level the only
      // thing it may restrict is the WORKSPACE BASELINE (`role:org_member`), which
      // is what the doc comment above has always claimed and nothing enforced.
      // Unenforced, a `profile`/`group`/`user` row at `none` did two wrong things
      // at once: it granted that grantee nothing, and it put the def into the
      // grantee-agnostic `restrictedEntityDefIds` set — silently converting the
      // whole definition to grantees-only for the entire org (§7.3's sibling hole).
      // `setType`/`setInstance` exclude `none` at the schema level; this endpoint
      // is the one write path that still accepts it.
      if (
        input.rung === 'none' &&
        !(
          input.granteeType === ResourceGranteeType.role &&
          input.granteeId === ORG_MEMBER_GRANTEE_ID
        )
      ) {
        throw new BadRequestError(
          'The "none" rung is only valid for the workspace baseline (role:org_member)'
        )
      }
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
          rung: input.rung,
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
      // `granularPermissions` plan gate lives on `grantInstance`/`setInstance`,
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
            rung: grantRungSchema,
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
      await assertRecordSharingFeature(context, recordId)
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
            rung: grantRungSchema,
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

  /**
   * Get all access grants for a specific instance.
   *
   * Gated by {@link assertCanReadInstanceAccess} — "may the caller see the
   * target" (plan v3/03 §7.2), deliberately weaker than the write authorizer so
   * the read-only grantee lists on the thread popover / contact card / inbox
   * info panel keep rendering.
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
        await assertCanReadInstanceAccess(ctx, recordId)
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
