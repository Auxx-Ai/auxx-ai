// apps/web/src/server/api/routers/signature.ts

import { type Database, schema } from '@auxx/database'
import { ResourceGranteeType, ResourcePermission } from '@auxx/database/enums'
import { getUserCache, onCacheEvent } from '@auxx/lib/cache'
import { PermissionKey } from '@auxx/lib/permissions'
import { emitResourceAccessInstanceChanged } from '@auxx/lib/resource-access'
import { UnifiedCrudHandler } from '@auxx/lib/resources'
import { updateUserSetting } from '@auxx/lib/settings'
import { toRecordId } from '@auxx/types/resource'
import { and, asc, eq, inArray } from 'drizzle-orm'
import { z } from 'zod'
import {
  assertSignatureAccess,
  resolveSignatureDefinitionId,
  SIGNATURE_INSTANCE_KEY,
  signatureListScope,
} from '~/server/lib/signature-instance-access'
import { capabilityProcedure, createTRPCRouter } from '../trpc'

/**
 * The dedicated signature router (plan 36 §3 recommendation (a), §5).
 *
 * Signatures are `EntityInstance` rows on the `signature` def, so until this
 * slice they rode the generic `record.*` CRUD path — whose def-level gate
 * (`canViewEntity('signature')`) returned `true` unconditionally via
 * `isMailInfraDef`. Gating only here would therefore have closed nothing, so
 * `record.ts` now REFUSES every instance-access def outright and this router is
 * the only door. See `assertNotInstanceAccessDef` there for that half.
 *
 * Tiers, one line each:
 *  - `list` / `get` / `getDefault` → `view` (`list` FILTERS, it never 403s)
 *  - `create` → `PermissionKey.signaturesManage` (no instance exists yet)
 *  - `update` → `edit`
 *  - `delete` → `admin`
 *  - `setDefault` → `view` on the target, and it writes ONLY the caller's row
 *
 * **There is no share surface here, by design.** `resourceAccess.grantInstance`
 * / `setInstance` / `revokeInstance` already resolve any
 * `INSTANCE_ACCESS_RESOURCES` key generically and gate on
 * `assertAdminInstance(key, instanceId)` (`resourceAccess.ts:114-123`), so
 * `signature` picked up a fully-gated share surface the moment it joined the
 * registry. Sharing sends `recordId: 'signature:<instanceId>'` — the SLUG form,
 * because that is the `entityDefinitionId` the `ResourceAccess` rows are keyed
 * on (see the 056 migration), NOT the `EntityDefinition` UUID that a generic
 * `RecordId` carries. {@link SignatureView.recordId} is emitted in that form for
 * exactly this reason. Duplicating the mutations here would be a second access
 * authority, which is what `project_all_sharing_funnels_through_grantinstance`
 * exists to prevent.
 */

/** One signature as the client consumes it. */
export interface SignatureView {
  id: string
  /**
   * The SHARING record id — `signature:<instanceId>`, the form
   * `resourceAccess.*` and the instance-share components expect. Deliberately
   * not the generic `<defUuid>:<instanceId>` record id: nothing routes
   * signatures through `record.*` any more.
   */
  recordId: string
  name: string
  body: string
  createdById: string | null
}

const NAME_ATTR = 'signature_name'
const BODY_ATTR = 'signature_body'

/**
 * Hydrate `signature_name` / `signature_body` for a set of instances in one
 * round-trip. Both are stored in `FieldValue.valueText` (TEXT and RICH_TEXT
 * respectively), keyed by the `CustomField.systemAttribute` — the same join
 * `MessageComposerService.appendSignature` uses for the body.
 */
async function loadSignatureFields(
  db: Database,
  entityDefinitionId: string,
  instanceIds: string[]
): Promise<Map<string, { name?: string; body?: string }>> {
  const byInstance = new Map<string, { name?: string; body?: string }>()
  if (instanceIds.length === 0) return byInstance

  const rows = await db
    .select({
      entityId: schema.FieldValue.entityId,
      attribute: schema.CustomField.systemAttribute,
      value: schema.FieldValue.valueText,
    })
    .from(schema.FieldValue)
    .innerJoin(schema.CustomField, eq(schema.CustomField.id, schema.FieldValue.fieldId))
    .where(
      and(
        inArray(schema.FieldValue.entityId, instanceIds),
        eq(schema.CustomField.entityDefinitionId, entityDefinitionId),
        inArray(schema.CustomField.systemAttribute, [NAME_ATTR, BODY_ATTR])
      )
    )

  for (const row of rows) {
    const entry = byInstance.get(row.entityId) ?? {}
    if (row.attribute === NAME_ATTR) entry.name = row.value ?? undefined
    else if (row.attribute === BODY_ATTR) entry.body = row.value ?? undefined
    byInstance.set(row.entityId, entry)
  }
  return byInstance
}

/** One signature by id (no access check — callers assert first). */
async function loadSignature(
  db: Database,
  organizationId: string,
  id: string
): Promise<SignatureView | null> {
  const entityDefinitionId = await resolveSignatureDefinitionId(organizationId)
  const [instance] = await db
    .select({
      id: schema.EntityInstance.id,
      displayName: schema.EntityInstance.displayName,
      createdById: schema.EntityInstance.createdById,
    })
    .from(schema.EntityInstance)
    .where(
      and(
        eq(schema.EntityInstance.id, id),
        eq(schema.EntityInstance.organizationId, organizationId),
        eq(schema.EntityInstance.entityDefinitionId, entityDefinitionId)
      )
    )
    .limit(1)
  if (!instance) return null

  const fields = await loadSignatureFields(db, entityDefinitionId, [instance.id])
  const field = fields.get(instance.id)
  return {
    id: instance.id,
    recordId: `${SIGNATURE_INSTANCE_KEY}:${instance.id}`,
    name: field?.name ?? instance.displayName ?? 'Untitled',
    body: field?.body ?? '',
    createdById: instance.createdById,
  }
}

export const signatureRouter = createTRPCRouter({
  /**
   * Every signature the caller may VIEW.
   *
   * FILTERS rather than 403s — the shape all five `*.list` precedents settled
   * on, so a server-warmed page render never blows up on a member who happens
   * to hold no grants. The filter is the `privateInstanceListScope` id set
   * pushed into the WHERE clause, not a post-fetch `.filter()`: `signature` is
   * `baselineAtCreate: true`, so `CapabilitySet.instanceListScope` is a compile
   * error for it by construction and the visible set is always an allow-list.
   */
  list: capabilityProcedure.query(async ({ ctx }): Promise<SignatureView[]> => {
    const { organizationId } = ctx.session
    const scope = signatureListScope(ctx.capabilities)
    if (scope.kind === 'none') return []

    const entityDefinitionId = await resolveSignatureDefinitionId(organizationId)
    const filters = [
      eq(schema.EntityInstance.organizationId, organizationId),
      eq(schema.EntityInstance.entityDefinitionId, entityDefinitionId),
    ]
    // `include` names the caller's own ≥`view` rows, and is the ONLY arm left
    // besides `'none'`: `signature` is `baselineAtCreate: true`, so the scope is
    // always an allow-list. There is no `exclude` arm to handle — not even for
    // OWNER, whose bypass was scoped to `baselineAtCreate: false` when §0.6 was
    // revised. `PrivateInstanceListScope` encodes that, so a re-added branch is
    // a compile error rather than dead code.
    filters.push(inArray(schema.EntityInstance.id, scope.includeIds))

    const instances = await ctx.db
      .select({
        id: schema.EntityInstance.id,
        displayName: schema.EntityInstance.displayName,
        createdById: schema.EntityInstance.createdById,
      })
      .from(schema.EntityInstance)
      .where(and(...filters))
      .orderBy(asc(schema.EntityInstance.createdAt))

    const fields = await loadSignatureFields(
      ctx.db,
      entityDefinitionId,
      instances.map((i) => i.id)
    )

    return instances.map((instance) => {
      const field = fields.get(instance.id)
      return {
        id: instance.id,
        recordId: `${SIGNATURE_INSTANCE_KEY}:${instance.id}`,
        name: field?.name ?? instance.displayName ?? 'Untitled',
        body: field?.body ?? '',
        createdById: instance.createdById,
      }
    })
  }),

  /** One signature. Read — 404 before 403, per `signature-instance-access.ts`. */
  get: capabilityProcedure
    .input(z.object({ id: z.string().min(1) }))
    .query(async ({ ctx, input }): Promise<SignatureView | null> => {
      const { organizationId } = ctx.session
      await assertSignatureAccess({
        db: ctx.db,
        capabilities: ctx.capabilities,
        organizationId,
        signatureId: input.id,
        tier: 'view',
      })
      return loadSignature(ctx.db, organizationId, input.id)
    }),

  /**
   * Create a signature, owned privately by its creator.
   *
   * Full — there is no instance to key on yet, so it gates on the area's Manage
   * rung (the `dashboard.create` precedent). The owner `admin` `ResourceAccess`
   * row is NOT optional bookkeeping: `signature` is `baselineAtCreate: true`, so
   * a signature born without it is invisible to EVERYONE including the member
   * who just created it. No `role:org_member` baseline row is written — private
   * is the posture (§0.2), and sharing goes through `resourceAccess.grantInstance`.
   *
   * The row lands just after the instance rather than inside its transaction:
   * `UnifiedCrudHandler.create` owns its own tx (field values, hooks, realtime,
   * cache invalidation), and nothing can read the instance through this router
   * before the row exists, because every read path here is gated on it.
   */
  create: capabilityProcedure
    .input(
      z.object({
        name: z.string().min(1).max(200),
        body: z.string().min(1),
      })
    )
    .mutation(async ({ ctx, input }): Promise<SignatureView | null> => {
      const { organizationId, userId } = ctx.session
      ctx.capabilities.assert(PermissionKey.signaturesManage)

      // No `capabilities` on the handler: THIS router is the access authority
      // for signatures, and the def-level records gate it would otherwise apply
      // is exactly the one plan 36 §7.6 removed.
      const handler = new UnifiedCrudHandler(organizationId, userId, ctx.db)
      const result = await handler.create(SIGNATURE_INSTANCE_KEY, {
        [NAME_ATTR]: input.name,
        [BODY_ATTR]: input.body,
      })
      const signatureId = result.instance.id

      await ctx.db
        .insert(schema.ResourceAccess)
        .values({
          organizationId,
          entityDefinitionId: SIGNATURE_INSTANCE_KEY,
          entityInstanceId: signatureId,
          granteeType: ResourceGranteeType.user,
          granteeId: userId,
          permission: ResourcePermission.admin,
          grantedById: userId,
        })
        .onConflictDoNothing()

      // Without this the creator's composed capabilities blob still predates the
      // row and they cannot see their own new signature until the TTL expires.
      await emitResourceAccessInstanceChanged(organizationId, [
        { granteeType: ResourceGranteeType.user, granteeId: userId },
      ])

      return loadSignature(ctx.db, organizationId, signatureId)
    }),

  /** Edit — name/body are the whole editable surface. */
  update: capabilityProcedure
    .input(
      z.object({
        id: z.string().min(1),
        name: z.string().min(1).max(200).optional(),
        body: z.string().min(1).optional(),
      })
    )
    .mutation(async ({ ctx, input }): Promise<SignatureView | null> => {
      const { organizationId, userId } = ctx.session
      const signatureId = await assertSignatureAccess({
        db: ctx.db,
        capabilities: ctx.capabilities,
        organizationId,
        signatureId: input.id,
        tier: 'edit',
      })

      const values: Record<string, unknown> = {}
      if (input.name !== undefined) values[NAME_ATTR] = input.name
      if (input.body !== undefined) values[BODY_ATTR] = input.body

      if (Object.keys(values).length > 0) {
        const handler = new UnifiedCrudHandler(organizationId, userId, ctx.db)
        await handler.update(toRecordId(SIGNATURE_INSTANCE_KEY, signatureId), values)
      }
      return loadSignature(ctx.db, organizationId, signatureId)
    }),

  /**
   * Full — destroying the signature. Also clears the CALLER's default pointer
   * when it named this signature; other members' pointers are left dangling on
   * purpose, because `getDefault` re-checks the target on read and a
   * cross-member `UserSetting` write is precisely the org-global cross-write
   * §12.2 exists to delete.
   */
  delete: capabilityProcedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const { organizationId, userId } = ctx.session
      const signatureId = await assertSignatureAccess({
        db: ctx.db,
        capabilities: ctx.capabilities,
        organizationId,
        signatureId: input.id,
        tier: 'admin',
      })

      const handler = new UnifiedCrudHandler(organizationId, userId, ctx.db)
      await handler.delete(toRecordId(SIGNATURE_INSTANCE_KEY, signatureId))

      // `ResourceAccess` rows are keyed by the slug + instance id, so they are
      // not FK-cascaded by the instance delete — clear them explicitly or the
      // ids linger in every member's `governingInstanceIds`.
      await ctx.db
        .delete(schema.ResourceAccess)
        .where(
          and(
            eq(schema.ResourceAccess.organizationId, organizationId),
            eq(schema.ResourceAccess.entityDefinitionId, SIGNATURE_INSTANCE_KEY),
            eq(schema.ResourceAccess.entityInstanceId, signatureId)
          )
        )
      await emitResourceAccessInstanceChanged(organizationId, [
        { granteeType: ResourceGranteeType.role, granteeId: 'org_member' },
      ])

      const settings = await getUserCache().get(userId, 'userSettings', organizationId)
      if (settings['signature.defaultId'] === signatureId) {
        await updateUserSetting({
          userId,
          organizationId,
          key: 'signature.defaultId',
          value: null,
          db: ctx.db,
        })
        await onCacheEvent('user.settings.changed', { orgId: organizationId, userId })
      }

      return { success: true }
    }),

  /**
   * The caller's default signature id, or `null`.
   *
   * Viewability is re-checked on READ rather than trusted from the stored
   * pointer: a signature can be deleted or un-shared after it was defaulted, and
   * a stale pointer must degrade to "no default" instead of handing the composer
   * an id it will 403 on. Cheap — `canViewInstance` is zero-I/O.
   */
  getDefault: capabilityProcedure.query(async ({ ctx }): Promise<string | null> => {
    const { organizationId, userId } = ctx.session
    const settings = await getUserCache().get(userId, 'userSettings', organizationId)
    const id = settings['signature.defaultId']
    if (typeof id !== 'string' || id.length === 0) return null
    if (!ctx.capabilities.canViewInstance(SIGNATURE_INSTANCE_KEY, id)) return null
    return id
  }),

  /**
   * Point the CALLER's default signature at `id` (or clear it with `null`).
   *
   * Per-user, not per-org (plan 36 §12.2). The old org-global
   * `signature_is_default` FieldValue made "set default" a write to ANOTHER
   * member's record to unset theirs — a 403 under instance access — and let one
   * pointer name a signature most members cannot see. Both problems disappear
   * here: the assert is `view` (you cannot default to something you cannot see,
   * but you need no write rung on someone else's shared signature to prefer it),
   * and the write touches one `UserSetting` row keyed on
   * (userId, organizationId, 'signature.defaultId').
   */
  setDefault: capabilityProcedure
    .input(z.object({ id: z.string().min(1).nullable() }))
    .mutation(async ({ ctx, input }) => {
      const { organizationId, userId } = ctx.session

      let value: string | null = null
      if (input.id !== null) {
        value = await assertSignatureAccess({
          db: ctx.db,
          capabilities: ctx.capabilities,
          organizationId,
          signatureId: input.id,
          tier: 'view',
        })
      }

      await updateUserSetting({
        userId,
        organizationId,
        key: 'signature.defaultId',
        value,
        db: ctx.db,
      })
      await onCacheEvent('user.settings.changed', { orgId: organizationId, userId })

      return { success: true }
    }),
})
