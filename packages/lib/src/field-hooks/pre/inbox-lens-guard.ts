// packages/lib/src/field-hooks/pre/inbox-lens-guard.ts

import { database, schema } from '@auxx/database'
import { ResourcePermission } from '@auxx/database/enums'
import { parseRecordId, toRecordId } from '@auxx/types/resource'
import { and, eq } from 'drizzle-orm'
import { getCachedUserMailVisibility } from '../../cache'
import { ForbiddenError } from '../../errors'
import { FeaturePermissionService } from '../../permissions/feature-permission-service'
import { FeatureKey } from '../../permissions/types'
import { hasPermission } from '../../resource-access'
import type { FieldPreHookHandler } from '../types'

/**
 * The field-write wall for `inbox_default_lens` (mail-permissions §7.1).
 * The generic records path (form edits, Kopilot record tools, workflow CRUD)
 * bypasses `InboxService`, so the actual enforcement lives here — the choke
 * point every writer shares:
 *
 * - only org admins or the inbox's Managers (`admin` instance grant) may
 *   change the floor;
 * - setting a floor below `full` requires `FeatureKey.mailPermissions`
 *   (Enterprise) — raising back to `full` is always allowed;
 * - system paths without a user (provisioning, workers) pass through, and
 *   seeder/migrations use the `bypass` set (the registry short-circuits this
 *   hook before it runs).
 */
/** True when the inbox already has at least one Manager (`admin`) grant. */
async function hasAnyManager(organizationId: string, instanceId: string): Promise<boolean> {
  const [row] = await database
    .select({ id: schema.ResourceAccess.id })
    .from(schema.ResourceAccess)
    .where(
      and(
        eq(schema.ResourceAccess.organizationId, organizationId),
        eq(schema.ResourceAccess.entityDefinitionId, 'inbox'),
        eq(schema.ResourceAccess.entityInstanceId, instanceId),
        eq(schema.ResourceAccess.permission, ResourcePermission.admin)
      )
    )
    .limit(1)
  return !!row
}

export const guardInboxDefaultLens: FieldPreHookHandler = async (event) => {
  // Trusted system writers (channel provisioning, workers) carry no userId.
  if (!event.userId) return event.newValue

  const ctx = { db: database, organizationId: event.organizationId, userId: event.userId }
  const vis = await getCachedUserMailVisibility(event.userId, event.organizationId)
  // ResourceAccess stores inbox grants under the fixed 'inbox' slug, while the
  // records CRUD passes the definition UUID — re-key before the grant lookup.
  const instanceId = parseRecordId(event.recordId).entityInstanceId
  const accessRecordId = toRecordId('inbox', instanceId)
  const canManage =
    vis.isAdmin ||
    (await hasPermission(ctx, accessRecordId, ResourcePermission.admin)) ||
    // Inbox creation (any member may create) writes the initial floor BEFORE
    // the creator's Manager grant lands — a manager-less inbox has no access
    // to protect yet, so the ownership check is skipped (feature gate below
    // still applies).
    !(await hasAnyManager(event.organizationId, instanceId))
  if (!canManage) {
    throw new ForbiddenError('Only inbox managers can change inbox access')
  }

  const lens = event.newValue
  if (typeof lens === 'string' && lens !== 'full') {
    await new FeaturePermissionService(database).requireAccess(
      event.organizationId,
      FeatureKey.mailPermissions
    )
  }

  return event.newValue
}
