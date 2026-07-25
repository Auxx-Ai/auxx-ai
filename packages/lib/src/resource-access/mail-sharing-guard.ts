// packages/lib/src/resource-access/mail-sharing-guard.ts

import { database, schema } from '@auxx/database'
import { ResourcePermission } from '@auxx/database/enums'
import type { RecordId } from '@auxx/types/resource'
import { parseRecordId, toRecordId } from '@auxx/types/resource'
import { and, eq } from 'drizzle-orm'
import { getCachedUserMailVisibility } from '../cache'
import { ForbiddenError } from '../errors'
import { FeaturePermissionService } from '../permissions/feature-permission-service'
import { FeatureKey } from '../permissions/types'
import { getThreadLens } from '../permissions/visibility'
import { hasPermission } from './resource-access-service'
import type { GrantLens, ResourceAccessContext } from './types'

/**
 * The ResourceAccess entityDefinitionId slugs whose grants feed the mail
 * visibility evaluator (mail-permissions §2/§7). Mutations on these go
 * through the sharing authorization + enterprise feature gate below; every
 * other definition keeps its existing surface-level checks.
 */
const MAIL_SHARING_DEFS = new Set(['inbox', 'thread', 'contact'])

/** True when grants on this definition affect mail visibility. */
export function isMailSharingDef(entityDefinitionId: string): boolean {
  return MAIL_SHARING_DEFS.has(entityDefinitionId)
}

/**
 * Authorization for mutating mail-visibility grants (§7):
 * - org admins may manage sharing anywhere;
 * - `inbox`: inbox Managers (instance `admin` grant) may manage their inbox;
 * - `thread`: viewers with `full` on the thread who are also a Manager of the
 *   thread's inbox (admins short-circuit above) — a sub-full viewer must never
 *   self-raise, and full-lens members don't get to re-share by default;
 * - `contact`: org admins only in v1 (contact shares derive to every thread
 *   the contact participates in — the widest blast radius in the model).
 *
 * `selfRevokeGranteeId` allows a user to remove their OWN user grant (leave a
 * shared thread) without manager rights. No-op for non-mail definitions.
 */
export async function assertCanManageMailSharing(
  ctx: ResourceAccessContext,
  recordId: RecordId,
  opts?: { selfRevokeGranteeId?: string; selfRevokeGranteeType?: string }
): Promise<void> {
  const { entityDefinitionId, entityInstanceId } = parseRecordId(recordId)
  if (!isMailSharingDef(entityDefinitionId)) return

  const { organizationId, userId } = ctx
  // DELIBERATELY `'user'` ONLY — do not widen to the other grantee kinds when
  // teaching the codebase a new one (doc 19 step 9 / 19a #13). Self-revoke means
  // "remove the grant that names ME"; a group/profile/role row is shared policy,
  // and letting one holder delete it would silently revoke everyone else. This
  // fails closed on purpose: a member who wants out of a profile-scoped share
  // needs an admin, not a leave button.
  if (
    opts?.selfRevokeGranteeType === 'user' &&
    opts.selfRevokeGranteeId &&
    opts.selfRevokeGranteeId === userId
  ) {
    return
  }

  const vis = await getCachedUserMailVisibility(userId, organizationId)
  if (vis.isAdmin) return

  if (entityDefinitionId === 'inbox') {
    if (await hasPermission(ctx, recordId, ResourcePermission.admin)) return
    throw new ForbiddenError('Only inbox managers can change inbox access')
  }

  if (entityDefinitionId === 'thread') {
    const lens = await getThreadLens(database, organizationId, vis, entityInstanceId)
    if (lens === 'full') {
      const [thread] = await database
        .select({ inboxId: schema.Thread.inboxId })
        .from(schema.Thread)
        .where(
          and(
            eq(schema.Thread.id, entityInstanceId),
            eq(schema.Thread.organizationId, organizationId)
          )
        )
        .limit(1)
      if (
        thread?.inboxId &&
        (await hasPermission(ctx, toRecordId('inbox', thread.inboxId), ResourcePermission.admin))
      ) {
        return
      }
    }
    throw new ForbiddenError('Only admins or inbox managers can share this conversation')
  }

  // contact
  throw new ForbiddenError('Only admins can share a contact’s conversations')
}

/**
 * Authorization for TYPE-level grant mutations on mail definitions: org
 * admins only. The evaluator deliberately ignores type-level view grants
 * (April decision), but a type-level `admin` grant on `inbox` would make the
 * grantee a Manager of every inbox — never something a non-admin may set up.
 * No-op for non-mail definitions.
 */
export async function assertCanManageMailTypeAccess(
  ctx: ResourceAccessContext,
  entityDefinitionId: string
): Promise<void> {
  if (!isMailSharingDef(entityDefinitionId)) return
  const vis = await getCachedUserMailVisibility(ctx.userId, ctx.organizationId)
  if (vis.isAdmin) return
  throw new ForbiddenError('Only admins can manage type-level access')
}

/**
 * Enterprise gate for lens-bearing sharing (§7.1 / plan decision 4). Throws
 * unless the org has `FeatureKey.mailPermissions` when the mutation:
 * - grants a sub-`full` lens (metadata/subject shares), or
 * - adds a NEW inbox Manager (`admin` permission) — delegation. Re-submitting
 *   an existing Manager row (the inbox form's replace-all save includes the
 *   non-removable creator row) stays ungated so free-plan saves don't trip.
 *
 * Full-lens grants stay ungated: they only widen access, which assignment
 * already does on every plan. No-op for non-mail definitions.
 */
export async function assertMailSharingFeature(
  ctx: ResourceAccessContext,
  recordId: RecordId,
  grants: Array<{ granteeId: string; permission: string; lens?: GrantLens | null }>
): Promise<void> {
  const { entityDefinitionId, entityInstanceId } = parseRecordId(recordId)
  if (!isMailSharingDef(entityDefinitionId)) return

  let gated = grants.some((g) => g.lens != null && g.lens !== 'full')

  if (!gated && entityDefinitionId === 'inbox') {
    const newManagers = grants.filter((g) => g.permission === ResourcePermission.admin)
    if (newManagers.length > 0) {
      const existing = await ctx.db
        .select({ granteeId: schema.ResourceAccess.granteeId })
        .from(schema.ResourceAccess)
        .where(
          and(
            eq(schema.ResourceAccess.organizationId, ctx.organizationId),
            eq(schema.ResourceAccess.entityDefinitionId, entityDefinitionId),
            eq(schema.ResourceAccess.entityInstanceId, entityInstanceId),
            eq(schema.ResourceAccess.permission, ResourcePermission.admin)
          )
        )
      const existingIds = new Set(existing.map((r: { granteeId: string }) => r.granteeId))
      gated = newManagers.some((g) => !existingIds.has(g.granteeId))
    }
  }

  if (gated) {
    await new FeaturePermissionService(ctx.db).requireAccess(
      ctx.organizationId,
      FeatureKey.mailPermissions
    )
  }
}
