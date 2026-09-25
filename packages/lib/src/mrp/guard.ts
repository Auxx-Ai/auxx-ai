// packages/lib/src/mrp/guard.ts

import { FeaturePermissionService } from '../permissions/feature-permission-service'
import { FeatureKey } from '../permissions/types'

/** Whether the org's plan has MRP (always true self-hosted); read through the org `features` cache. */
export async function isMrpEnabled(organizationId: string): Promise<boolean> {
  return new FeaturePermissionService().hasAccess(organizationId, FeatureKey.mrp)
}

/** Throws `ForbiddenError` when the org's plan lacks MRP. */
export async function assertMrpEnabled(organizationId: string): Promise<void> {
  await new FeaturePermissionService().requireAccess(organizationId, FeatureKey.mrp)
}
