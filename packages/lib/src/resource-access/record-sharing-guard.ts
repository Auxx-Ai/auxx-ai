// packages/lib/src/resource-access/record-sharing-guard.ts

import { schema } from '@auxx/database'
import type { RecordId } from '@auxx/types/resource'
import { parseRecordId } from '@auxx/types/resource'
import { and, eq } from 'drizzle-orm'
import { getCachedResources } from '../cache'
import { ForbiddenError } from '../errors'
import type { CapabilitySet } from '../permissions/capabilities/capability-set'
import { isInstanceAccessKey } from '../permissions/capabilities/instance-access'
import {
  recordAccessRankSql,
  resolveRecordVisibilityScope,
} from '../permissions/capabilities/record-visibility-scope'
import { satisfiesRung } from '../permissions/capabilities/rung'
import { FeaturePermissionService } from '../permissions/feature-permission-service'
import { FeatureKey } from '../permissions/types'
import { isMailSharingDef } from './mail-sharing-defs'
import type { ResourceAccessContext } from './types'

/**
 * Authorize sharing ONE record-def row (plan v3/03 §7.1).
 *
 * **This is the fix for a live fail-OPEN.** `canonicalMailRecordId` passes a
 * record CUID straight through; `authorizeInstanceTarget` used to answer `false`
 * for it *without asserting anything*, and both mail funnels
 * (`assertCanManageMailSharing`, `assertMailSharingFeature`) early-return on a
 * non-mail def — so every `grantInstance` / `setInstance` / `revokeInstance` call
 * naming a record row was written unauthorized. It was inert only because the
 * capability composer filtered those rows back out on read; plan v3/03 §5 removes
 * that inertness, so the authorizer lands first.
 *
 * The bar is **row-effective `edit`**, not def `admin`: administering a
 * definition (fields, name, the Access tab) is a different, heavier authority
 * than "re-share one row I can already change" (plan 08 §4.4). Do NOT reach for
 * `CapabilityView.assertAdminInstance` here — that is the instance-access
 * registry's ladder, and record defs are deliberately not in it.
 *
 * **P5 swapped the stamp in — this is that swap.** The def read is still the
 * FIRST branch and still the common case (a member who may edit the def may
 * re-share any of its rows, exactly as before, with no query). What is new is
 * the SECOND branch: a member who cannot edit the def at all, but whose
 * ROW-EFFECTIVE `_access` reaches `admin`, may re-share that one row. Strictly
 * additive — nobody who could share before loses it, and the row-effective read
 * is only paid when the cheap def read has already said no.
 *
 * The `admin` bar on the row half, against `edit` on the def half, is not an
 * inconsistency: the def branch already carries an org-wide authority over every
 * row of the definition, whereas a per-row grant carries authority over exactly
 * one row — and "may pass this on to others" is the top rung of the per-instance
 * ladder everywhere else in the product (`canAdminInstance`). Handing re-share
 * rights to a row shared at `edit` would let a collaborator widen an audience the
 * grantor chose.
 *
 * Do NOT reach for `CapabilityView.assertAdminInstance` here — that is the
 * instance-access registry's ladder, and record defs are deliberately not in it.
 *
 * No self-revoke hatch, unlike {@link assertCanManageMailSharing}: mail's hatch
 * exists so a member can leave a shared conversation, and the record lane has no
 * such affordance yet. Adding one silently would be a widening, not a fix.
 *
 * **Lives in lib, not in the `resourceAccess` router** (plan v3/04 §10.2): the
 * approval-decision handler must re-assert the acting approver's CURRENT
 * authority *inside* the decision transaction, which it cannot do from
 * `apps/web`. The router calls this through the deep subpath
 * `@auxx/lib/resource-access/record-sharing-guard`, deliberately not the
 * `resource-access` barrel — same reason the row-effective read below is written
 * out longhand.
 */
export async function assertCanManageRecordSharing(
  ctx: ResourceAccessContext,
  capabilities: CapabilitySet,
  recordId: RecordId
): Promise<void> {
  const { entityDefinitionId, entityInstanceId } = parseRecordId(recordId)
  if (capabilities.canEditEntity(entityDefinitionId)) return

  // The ROW-EFFECTIVE read, in ONE query: the §5.1 visibility predicate in the
  // `WHERE`, the grantee-union `max(rung)` aggregate in the projection. Written
  // out here rather than through `UnifiedCrudHandler.getByIds` on purpose — this
  // module must not import the `../resources` barrel, which pulls the
  // dataset/connector service graph into every consumer of `resourceAccess`.
  const resources = await getCachedResources(ctx.organizationId)
  const resource = resources.find(
    (r) => r.id === entityDefinitionId || r.entityDefinitionId === entityDefinitionId
  )
  const defId = resource?.entityDefinitionId ?? resource?.id ?? entityDefinitionId

  const scope = await resolveRecordVisibilityScope({
    organizationId: ctx.organizationId,
    userId: ctx.userId,
    entityDefinitionId: defId,
    capabilities,
  })
  // Arm 4 — the member can reach no row of this def at all. Deny without querying.
  if (scope.arm === 'none') {
    throw new ForbiddenError("You don't have permission to manage sharing for this record.")
  }

  const rows = await ctx.db
    .select({
      grantRank: recordAccessRankSql({
        organizationId: ctx.organizationId,
        entityDefinitionId: defId,
        grantees: scope.grantees,
      }),
    })
    .from(schema.EntityInstance)
    .where(
      and(
        eq(schema.EntityInstance.id, entityInstanceId),
        eq(schema.EntityInstance.organizationId, ctx.organizationId),
        scope.where
      )
    )
    .limit(1)

  // A row that does not come back is one the read path itself hid — the
  // strongest possible denial, and the same non-enumeration answer `getById`
  // gives.
  const row = rows[0]
  if (!row || !satisfiesRung(capabilities.recordAccessAt(defId, row.grantRank), 'admin')) {
    throw new ForbiddenError("You don't have permission to manage sharing for this record.")
  }
}

/**
 * Plan gate for per-RECORD instance sharing (plan v3/03 §7.6 D9, moved into lib
 * by plan v3/04 §3.5).
 *
 * `assertMailSharingFeature` returns early for every non-mail def and the
 * type-axis gate only guards def-wide grants, so a record-def INSTANCE grant
 * took no plan gate at all until this existed.
 *
 * 🔴 **It lives HERE, not in the `resourceAccess` router, because the approval
 * decision handler is a second caller.** `applyRecordAccessDecision` runs in
 * `packages/lib` and writes through `grantInstanceAccess`; with the gate in the
 * router, a non-Enterprise org could not share a record through the share dialog
 * but COULD through an approved access request — a live escalation the moment
 * the request lane ships. Adding a *second* lib copy beside the router's would
 * leave two implementations of a gate that must never disagree, which is the
 * shape of the bug this closes, so the router imports this one and has no
 * private copy.
 *
 * Exemptions, both preserved verbatim from the router version:
 * - **instance-access resources** (dataset / KB / dashboard / workflow / inbox):
 *   sharing them is core product on every plan and has always been ungated.
 *   Keyed on `isInstanceAccessKey`, the BLOB-lane predicate — deliberately not
 *   `isDeclaredInstanceDomain`, which would additionally exempt `thread` and
 *   `sequence`.
 * - **mail-sharing defs**, which keep their own narrower gate (sub-`read` rungs
 *   and NEW Manager rows) in {@link assertMailSharingFeature}.
 *
 * Revokes stay ungated everywhere: revoking only tightens access.
 *
 * ⚠ Uses {@link FeaturePermissionService}, not a hand-rolled
 * `getOrgCache().get(orgId, 'features')`. The service already IS that read, and
 * it additionally carries the `isSelfHosted()` bypass and the falsy-limit
 * normalization (`undefined | false | 0` ⇒ denied) a raw blob read would have to
 * reimplement. Its constructor ignores its `db` argument, so construction is
 * free.
 */
export async function assertRecordSharingFeature(
  ctx: Pick<ResourceAccessContext, 'db' | 'organizationId'>,
  recordId: RecordId
): Promise<void> {
  const { entityDefinitionId } = parseRecordId(recordId)
  if (isInstanceAccessKey(entityDefinitionId) || isMailSharingDef(entityDefinitionId)) return
  await new FeaturePermissionService(ctx.db).requireAccess(
    ctx.organizationId,
    FeatureKey.granularPermissions
  )
}
