// packages/lib/src/inboxes/inbox-floor.ts

import type { Database } from '@auxx/database'
import { schema } from '@auxx/database'
import { ResourceGranteeType } from '@auxx/database/enums'
import { parseRecordId, type RecordId } from '@auxx/types/resource'
import { and, eq, inArray, isNotNull } from 'drizzle-orm'
import { onCacheEvent } from '../cache/invalidate'
import { BadRequestError } from '../errors'
import { type Lens, normalizeLens } from '../permissions/visibility/lens'
import { ORG_MEMBER_GRANTEE_ID } from '../resource-access/grantee-resolution'
import { INBOX_DEFS, isInboxDef } from '../resource-access/mail-sharing-defs'
import { emitResourceAccessInstanceChanged } from '../resource-access/resource-access-service'

/**
 * The inbox's ORG-WIDE VISIBILITY FLOOR, as a `ResourceAccess` row (plan 40 §6).
 *
 * The floor used to be the `inbox_default_lens` FieldValue. Since phase 2 the
 * READ path (`composeUserInstanceGrants`) resolves it from the
 * `role:org_member` baseline row plus the `Area.inboxes` fallback and never
 * looks at the field again — so until this module landed, **editing an inbox's
 * org-wide access level in the UI was a live no-op**: the write went to a field
 * nothing read. This is the write half, and it is the ONE authority (the router,
 * `InboxService.createInbox`/`updateInbox` and the seeder all funnel here).
 *
 * ### The encoding
 *
 * | floor                  | row                                                 |
 * |------------------------|-----------------------------------------------------|
 * | `read`                 | **no row** — `baselineAtCreate: false` + no baseline |
 * |                        | row ⇒ the member's `Area.inboxes` level, which IS   |
 * |                        | the org-shared default                              |
 * | `metadata` / `identity`| `role:org_member @ <that rung>`                      |
 * | `none`                 | `role:org_member @ none` — the RESTRICTION marker    |
 *
 * Since plan v3/03 P3b the floor IS the stored rung — the `(permission, lens)`
 * round-trip is gone, and with it {@link floorFromBaselineRow}'s decode.
 *
 * **`rung: 'none'` is a restriction, never a grant.** It is what tells
 * `composeUserInstanceGrants` to stand the area fallback down; reading it as a
 * grant is the fail-open the old `grantLens` had to be fixed for (RECON §16).
 * Both readers still skip it explicitly.
 *
 * **Presence, not rung, is what governs.** An `identity` baseline is as much an
 * authored statement of the org-wide default as a `none` one, and both must
 * suppress the area fallback — otherwise the down-tier is silently raised
 * straight back to `read`. `isWorkspaceBaselineRow` in the composer keys on
 * exactly that, and {@link floorFromBaselineRow} is its inverse.
 *
 * ### Why the writes are raw rather than `grantInstanceAccess`
 *
 * `grantInstanceAccess` writes `grantedById: ctx.userId`, a live FK to `User` —
 * and a floor is also written by system paths that carry no user (the org
 * seeder's default inbox, provisioning), where an empty string aborts the
 * insert. It also runs the share-notification funnel, which a workspace baseline
 * has no business entering (a floor is not "X shared an inbox with you"; the
 * recipient resolver returns `[]` for a role grantee anyway, so the funnel is
 * pure overhead). Migration 056 set the precedent for writing `ResourceAccess`
 * rows directly with explicit conflict handling; the cache events below are
 * emitted by hand for exactly the keys the funnel would have busted.
 */

/**
 * The plan gate on a sub-`read` floor (mail-permissions §7.1), moved off
 * the retired `inbox_default_lens` field wall.
 *
 * `guardInboxDefaultLens` gated the FieldValue write; with the floor on a row
 * that hook never fires, so the gate has to travel with the write or the
 * paywall quietly disappears. Same two rules it carried:
 *
 *  - raising back to `read` is ALWAYS allowed (never gate a tightening-to-open
 *    that removes a paid capability's effect);
 *  - system paths without a user (org seeder, provisioning, workers) pass
 *    through — that is the trusted-provisioning carve-out.
 *
 * NOT covered by `assertMailSharingFeature`, deliberately: that gate keys on a
 * sub-`read` GRANT rung, and the RESTRICTED floor is `rung: 'none'` — a
 * restriction, not a grant — so it would sail straight past. The two
 * gates now read the SAME feature key (plan v3/03 §7.6 retired
 * `FeatureKey.mailPermissions` onto `granularPermissions`) — that is a key
 * change, NOT a merge. They stay separate functions for the reason above.
 */
export async function assertInboxFloorFeature(
  db: Database,
  organizationId: string,
  userId: string | null | undefined,
  lens: Lens
): Promise<void> {
  if (!userId || lens === 'read') return
  // Lazy import — `feature-permission-service` pulls the billing surface, and
  // this module is imported by the inbox service on every create.
  const { FeaturePermissionService } = await import('../permissions/feature-permission-service')
  const { FeatureKey } = await import('../permissions/types')
  await new FeaturePermissionService(db).requireAccess(
    organizationId,
    FeatureKey.granularPermissions
  )
}

/** Rows this module writes are always workspace-baseline rows. */
const BASELINE_GRANTEE = {
  granteeType: ResourceGranteeType.role,
  granteeId: ORG_MEMBER_GRANTEE_ID,
} as const

/** The column {@link floorFromBaselineRow} decides on. */
export interface BaselineFloorRow {
  rung: string
}

/**
 * The floor a `role:org_member` baseline row encodes.
 *
 * The inverse of what {@link setInboxFloor} writes. Now a CLAMP rather than a
 * decode: one column, so the floor is the rung itself — except that `edit` and
 * `admin` are dead vocabulary for the inbox keys (plan 40 §1.3) and mean
 * "manages the mailbox" rather than a wider thread lens, so both floor at
 * `read`. `normalizeLens` still guards the unknown-string case, which the CHECK
 * constraint now makes a data bug rather than a routine one.
 */
export function floorFromBaselineRow(row: BaselineFloorRow): Lens {
  if (row.rung === 'edit' || row.rung === 'admin') return 'read'
  return normalizeLens(row.rung, 'read')
}

/**
 * Every inbox's authored floor for one org, keyed by instance id.
 *
 * An inbox ABSENT from the result has no baseline row, which means its floor is
 * the org-shared default (`read`) — callers default rather than being handed a
 * synthesised entry, so "authored" and "defaulted" stay distinguishable at the
 * call site. Both inbox defs are queried: migration 060 re-keys a personal
 * mailbox's rows to `'personal_inbox'`, and a personal mailbox should never
 * carry a baseline row at all — reading both is how a stray one stays visible
 * instead of silently doing nothing.
 */
export async function readInboxFloors(
  db: Database,
  organizationId: string,
  instanceIds?: readonly string[]
): Promise<Record<string, Lens>> {
  if (instanceIds && instanceIds.length === 0) return {}

  const rows = await db
    .select({
      entityInstanceId: schema.ResourceAccess.entityInstanceId,
      rung: schema.ResourceAccess.rung,
    })
    .from(schema.ResourceAccess)
    .where(
      and(
        eq(schema.ResourceAccess.organizationId, organizationId),
        inArray(schema.ResourceAccess.entityDefinitionId, [...INBOX_DEFS]),
        isNotNull(schema.ResourceAccess.entityInstanceId),
        eq(schema.ResourceAccess.granteeType, BASELINE_GRANTEE.granteeType),
        eq(schema.ResourceAccess.granteeId, BASELINE_GRANTEE.granteeId),
        ...(instanceIds ? [inArray(schema.ResourceAccess.entityInstanceId, [...instanceIds])] : [])
      )
    )

  const floors: Record<string, Lens> = {}
  for (const row of rows) {
    if (!row.entityInstanceId) continue
    floors[row.entityInstanceId] = floorFromBaselineRow(row)
  }
  return floors
}

/**
 * Author an inbox's org-wide floor.
 *
 * `recordId` MUST be slug-keyed on the def the instance actually lives on
 * (`toInboxRecordId` / `Inbox.recordId`) — mail rows are matched literally, so a
 * def-CUID RecordId writes a row nothing reads. Rejected rather than normalized,
 * for the same reason `assertCanonicalMailKey` throws: normalizing at the write
 * would promote a row that skipped the caller's authorization into an effective
 * one.
 *
 * **No authorization here.** This is the storage layer; "may this member change
 * this inbox's floor" is the router's (`inbox.setAccessFloor` →
 * `requireInboxManageAccess` + the `granularPermissions` plan gate on any
 * sub-`read` floor), exactly where `guardInboxDefaultLens` enforced it for the
 * field.
 */
export async function setInboxFloor(
  input: { db: Database; organizationId: string; userId?: string | null },
  recordId: RecordId,
  lens: Lens
): Promise<void> {
  const { db, organizationId } = input
  const { entityDefinitionId, entityInstanceId } = parseRecordId(recordId)
  if (!isInboxDef(entityDefinitionId)) {
    throw new BadRequestError(
      `An inbox floor must be keyed by an inbox definition slug, not "${entityDefinitionId}".`
    )
  }

  const where = and(
    eq(schema.ResourceAccess.organizationId, organizationId),
    eq(schema.ResourceAccess.entityDefinitionId, entityDefinitionId),
    eq(schema.ResourceAccess.entityInstanceId, entityInstanceId),
    eq(schema.ResourceAccess.granteeType, BASELINE_GRANTEE.granteeType),
    eq(schema.ResourceAccess.granteeId, BASELINE_GRANTEE.granteeId)
  )

  if (lens === 'read') {
    // `read` is the ABSENCE of a baseline row, not a row saying `read`: the area
    // fallback already supplies it, and storing one would put every member in
    // the inbox's grant index for no reason.
    const removed = await db.delete(schema.ResourceAccess).where(where).returning()
    if (removed.length === 0) return
  } else {
    await db
      .insert(schema.ResourceAccess)
      .values({
        organizationId,
        entityDefinitionId,
        entityInstanceId,
        granteeType: BASELINE_GRANTEE.granteeType,
        granteeId: BASELINE_GRANTEE.granteeId,
        rung: lens,
        // Nullable on purpose: a real FK to `User`, and system writers (seeder,
        // provisioning) have no actor. Nothing reads it for authorization.
        grantedById: input.userId || null,
      })
      .onConflictDoUpdate({
        target: [
          schema.ResourceAccess.organizationId,
          schema.ResourceAccess.entityDefinitionId,
          schema.ResourceAccess.entityInstanceId,
          schema.ResourceAccess.granteeType,
          schema.ResourceAccess.granteeId,
        ],
        set: {
          rung: lens,
          grantedById: input.userId || null,
          updatedAt: new Date(),
        },
      })
  }

  // The floor is org-wide, so every member's mail blob is stale — the same
  // broadcast `emitResourceAccessChanged` resolves a `role` grantee to.
  // `resource-access.changed` carries `userInstanceGrants` + `mailGrantIndex`;
  // `inbox.updated` carries the `org:inboxes` shape, whose `defaultLens` is now
  // derived from these rows.
  await onCacheEvent('resource-access.changed', { orgId: organizationId, broadcastUserKeys: true })
  await onCacheEvent('inbox.updated', { orgId: organizationId, broadcastUserKeys: true })
  // Both inbox defs are `INSTANCE_ACCESS_RESOURCES` keys since phase 1, so a
  // baseline row also moves the org-wide `governingInstanceIds` set and every
  // member's `instanceAccess` map.
  await emitResourceAccessInstanceChanged(
    organizationId,
    [{ ...BASELINE_GRANTEE }],
    entityDefinitionId
  )
}
