// packages/lib/src/permissions/capabilities/require.ts

import { FeaturePermissionService } from '../feature-permission-service'
import { getCapabilities } from './get-capabilities'
import { PERMISSION_REGISTRY_MAP, type PermissionKey } from './registry'

/**
 * The full Layer-1-AND-Layer-2 server guard (§6): plan gate (if the key links a
 * `featureKey`) followed by the composed-capability assert.
 *
 * 1. Resolve the key's metadata from {@link PERMISSION_REGISTRY_MAP}.
 * 2. If `meta.featureKey` is set → `FeaturePermissionService.requireAccess`
 *    (the org's plan must include the feature).
 * 3. `getCapabilities(userId, orgId).assert(key)` — the member must hold it.
 *
 * Prefer `permissionProcedure(key)` in tRPC routers (it also attaches the
 * resolved set as `ctx.capabilities`); reach for this in lib/service code that
 * runs outside a router.
 */
export async function requirePermission(
  userId: string,
  orgId: string,
  key: PermissionKey,
  db?: unknown
): Promise<void> {
  const meta = PERMISSION_REGISTRY_MAP.get(key)
  if (meta?.featureKey) {
    await new FeaturePermissionService(db).requireAccess(orgId, meta.featureKey)
  }
  const caps = await getCapabilities(userId, orgId, db)
  caps.assert(key)
}
