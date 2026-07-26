// packages/lib/src/groups/permissions.ts

import { ResourcePermission } from '@auxx/database/enums'
import type { GroupContext } from '@auxx/types/groups'
import { toRecordId } from '@auxx/types/resource'
import { getOrgCache } from '../cache'
import { ForbiddenError } from '../errors'
import { checkAccess, hasPermission as resourceHasPermission } from '../resource-access'

/**
 * Get the entity_group entityDefinitionId using cached entity defs
 */
async function getGroupEntityDefId(ctx: GroupContext): Promise<string> {
  const { entityDefs } = await getOrgCache().getOrRecompute(ctx.organizationId, ['entityDefs'])
  const defId = entityDefs.entity_group
  if (!defId)
    throw new Error(`entity_group EntityDefinition not found for org ${ctx.organizationId}`)
  return defId
}

/**
 * Whether `userId` is the org OWNER — the one role that still short-circuits the
 * group gates below (doc 19 §0.10 recovery guarantee). Cache-only, no DB query.
 */
async function isOrgOwner(ctx: GroupContext): Promise<boolean> {
  const { memberRoleMap } = await getOrgCache().getOrRecompute(ctx.organizationId, [
    'memberRoleMap',
  ])
  return memberRoleMap[ctx.userId]?.role === 'OWNER'
}

/**
 * Get user's permission level on a group. OWNER short-circuits to `admin`;
 * everyone else — **including ADMIN** — resolves through `ResourceAccess`.
 *
 * ADMIN used to short-circuit here too. That bypass was *independent* of the one
 * in `checkAccess`, and it ran BEFORE it, so narrowing `checkAccess` to OWNER
 * (doc 19 §5.3 piece 2) was a complete no-op for groups until this went with it
 * (step 10). An admin now reaches a group through their own grantee union: their
 * creator grant, the `role:org_member` baseline on public groups, a group grant,
 * or a `granteeType:'profile'` grant naming the org's `admin` profile — which is
 * how "admins administer every group" is re-authored when an org wants it
 * (`entityGroup.grantPermission`, or a def-wide `resourceAccess.grantType` on the
 * `entity_group` definition; both accept a profile grantee since step 9).
 */
export async function getGroupPermission(
  ctx: GroupContext,
  groupId: string
): Promise<ResourcePermission | null> {
  const { db, userId, organizationId } = ctx

  if (await isOrgOwner(ctx)) {
    return ResourcePermission.admin
  }

  // Get entity_group entityDefinitionId (cached)
  const entityDefinitionId = await getGroupEntityDefId(ctx)

  // Check ResourceAccess
  const result = await checkAccess(
    { db, organizationId, userId },
    {
      recordId: toRecordId(entityDefinitionId, groupId),
      userId,
    }
  )

  return result.permission
}

/**
 * Check if user has at least the required permission level. OWNER-only
 * short-circuit — see {@link getGroupPermission} for why ADMIN was removed.
 */
export async function hasGroupPermission(
  ctx: GroupContext,
  groupId: string,
  required: ResourcePermission
): Promise<boolean> {
  const { db, organizationId, userId } = ctx

  if (await isOrgOwner(ctx)) {
    return true // Owner satisfies any permission
  }

  // Get entity_group entityDefinitionId (cached)
  const entityDefinitionId = await getGroupEntityDefId(ctx)

  // Use ResourceAccess hasPermission
  return resourceHasPermission(
    { db, organizationId, userId },
    toRecordId(entityDefinitionId, groupId),
    required
  )
}

/**
 * Assert user has permission, throw ForbiddenError if not
 */
export async function requireGroupPermission(
  ctx: GroupContext,
  groupId: string,
  required: ResourcePermission
): Promise<void> {
  const hasIt = await hasGroupPermission(ctx, groupId, required)
  if (!hasIt) {
    throw new ForbiddenError(`Missing '${required}' permission on group`)
  }
}
