// packages/lib/src/permissions/capabilities/grant-service.ts

import { type Database, database, type PermissionGrantEntity, schema } from '@auxx/database'
import { generateId } from '@auxx/utils'
import { and, eq } from 'drizzle-orm'
import { onCacheEvent } from '../../cache'
import { DehydrationCacheService } from '../../dehydration/cache'
import { ForbiddenError } from '../../errors'
import { FeaturePermissionService } from '../feature-permission-service'
import { FeatureKey } from '../types'
import { type Area, Level, PERMISSION_AREAS, parseAreaLevels } from './registry'

/**
 * PermissionGrant write service (Layer-2 capability overrides, §7).
 *
 * Leveled model: ONE row per grantee (org role policy, group, or user) holding a
 * sparse per-area level map `{ areaSlug: Level }` as jsonb. Writes upsert on the
 * unique `(organizationId, granteeType, granteeId)` key and emit the
 * `permission-grant.changed` cache event (+ dehydration invalidation) after commit.
 *
 * The seat-ceiling clamp lives at compose time (`composeUserCapabilities`), so no
 * grant row can ever escape a worker seat's ceiling — this service does NOT
 * re-derive that. It only validates that `adminOnly` areas are never raised.
 */

/** Grantee vocabulary shared with `ResourceAccess` (§3.2). */
export type GrantGranteeType = 'role' | 'group' | 'user'

/** Identifies one grantee (org-scoped). */
export interface GranteeRef {
  organizationId: string
  granteeType: GrantGranteeType
  granteeId: string
}

/**
 * Reject any grant that raises an `adminOnly` area (settings/billing/members/
 * permissions) above `None`. OWNER/ADMIN already hold these by role; granting
 * one to a user, group, or the `org_member` policy would elevate a non-admin
 * past the seat/role model. Mirrors v1's `assertGrantableKey`.
 */
function assertGrantableLevels(levels: Partial<Record<Area, Level>>): void {
  for (const area of Object.keys(levels) as Area[]) {
    if (PERMISSION_AREAS[area].adminOnly && (levels[area] ?? Level.None) > Level.None) {
      throw new ForbiddenError(
        `'${area}' is an admin-only area and cannot be granted; ` +
          'admins and owners already hold it by their role.'
      )
    }
  }
}

/** Enterprise gate — writing override grants requires the plan feature (§2.H/§8). */
async function requireGranularPermissions(db: Database, organizationId: string): Promise<void> {
  await new FeaturePermissionService(db).requireAccess(
    organizationId,
    FeatureKey.granularPermissions
  )
}

/**
 * Emit `permission-grant.changed` + bust dehydration after a grant mutation.
 * User grants target a single user's keys; role/group grants fan out org-wide
 * (`broadcastUserKeys`). Mirrors `emitResourceAccessChanged`. Call AFTER commit.
 */
async function emitGrantChanged(grantee: GranteeRef): Promise<void> {
  const dehydration = new DehydrationCacheService()

  if (grantee.granteeType === 'user') {
    await onCacheEvent('permission-grant.changed', {
      orgId: grantee.organizationId,
      userId: grantee.granteeId,
    })
    await dehydration.invalidateUser(grantee.granteeId)
    return
  }

  // role/group grants fan out to every member.
  await onCacheEvent('permission-grant.changed', {
    orgId: grantee.organizationId,
    broadcastUserKeys: true,
  })
  await dehydration.invalidateOrganization(grantee.organizationId)
}

/**
 * Set (upsert) the sparse per-area levels for one grantee. Normalizes the input
 * through {@link parseAreaLevels} (drops unknown areas, clamps each value),
 * validates admin-only areas, gates on the `granularPermissions` feature, then
 * upserts the single grantee row. Only the areas present in `levels` are stored;
 * absent areas fall through to the code default at compose time. Passing `{}`
 * writes an empty override row; prefer {@link clearGranteeLevels} to remove it.
 */
export async function setGranteeLevels(
  input: GranteeRef & {
    levels: Partial<Record<Area, Level>>
    grantedById: string
    db?: Database
  }
): Promise<PermissionGrantEntity> {
  const { organizationId, granteeType, granteeId, grantedById } = input
  const db = input.db ?? database

  const levels = parseAreaLevels(input.levels)
  assertGrantableLevels(levels)
  await requireGranularPermissions(db, organizationId)

  const [row] = await db
    .insert(schema.PermissionGrant)
    .values({
      id: generateId(),
      organizationId,
      granteeType,
      granteeId,
      levels,
      grantedById,
    })
    .onConflictDoUpdate({
      target: [
        schema.PermissionGrant.organizationId,
        schema.PermissionGrant.granteeType,
        schema.PermissionGrant.granteeId,
      ],
      set: {
        levels,
        grantedById,
        updatedAt: new Date(),
      },
    })
    .returning()

  await emitGrantChanged({ organizationId, granteeType, granteeId })
  return row as PermissionGrantEntity
}

/**
 * Remove the grant row for one grantee. Removal only tightens access, so — like
 * ResourceAccess revoke — it is NOT plan-gated. Returns whether a row was removed.
 */
export async function clearGranteeLevels(input: GranteeRef & { db?: Database }): Promise<boolean> {
  const { organizationId, granteeType, granteeId } = input
  const db = input.db ?? database

  const result = await db
    .delete(schema.PermissionGrant)
    .where(
      and(
        eq(schema.PermissionGrant.organizationId, organizationId),
        eq(schema.PermissionGrant.granteeType, granteeType),
        eq(schema.PermissionGrant.granteeId, granteeId)
      )
    )
    .returning({ id: schema.PermissionGrant.id })

  if (result.length > 0) {
    await emitGrantChanged({ organizationId, granteeType, granteeId })
  }
  return result.length > 0
}

/**
 * Read the sparse per-area levels currently stored for one grantee, or
 * `undefined` when no row exists (grantee falls through to the code default /
 * policy at compose time). The stored value is coerced via {@link parseAreaLevels}.
 */
export async function getGranteeLevels(
  input: GranteeRef & { db?: Database }
): Promise<Partial<Record<Area, Level>> | undefined> {
  const { organizationId, granteeType, granteeId } = input
  const db = input.db ?? database

  const [row] = await db
    .select({ levels: schema.PermissionGrant.levels })
    .from(schema.PermissionGrant)
    .where(
      and(
        eq(schema.PermissionGrant.organizationId, organizationId),
        eq(schema.PermissionGrant.granteeType, granteeType),
        eq(schema.PermissionGrant.granteeId, granteeId)
      )
    )
    .limit(1)

  if (!row) return undefined
  return parseAreaLevels(row.levels)
}

/** An empty sparse levels payload (no area overrides — everything falls through). */
export function emptyLevels(): Partial<Record<Area, Level>> {
  return {}
}
