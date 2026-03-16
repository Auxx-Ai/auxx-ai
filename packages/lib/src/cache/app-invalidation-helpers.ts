// packages/lib/src/cache/app-invalidation-helpers.ts

import type { Database } from '@auxx/database'
import { onCacheEvent } from './invalidate'

/** Invalidate installedApps for all orgs affected by a deployment change */
export async function invalidateOrgsByDeploymentId(
  deploymentId: string,
  db: Database
): Promise<void> {
  const affected = await db.query.AppInstallation.findMany({
    where: (t, { eq, and, isNull }) =>
      and(eq(t.currentDeploymentId, deploymentId), isNull(t.uninstalledAt)),
    columns: { organizationId: true },
  })
  const orgIds = [...new Set(affected.map((a) => a.organizationId))]
  await Promise.all(orgIds.map((orgId) => onCacheEvent('app.deployment.changed', { orgId })))
}

/** Invalidate installedApps for all orgs that have a specific app installed */
export async function invalidateOrgsByAppId(appId: string, db: Database): Promise<void> {
  const affected = await db.query.AppInstallation.findMany({
    where: (t, { eq, and, isNull }) => and(eq(t.appId, appId), isNull(t.uninstalledAt)),
    columns: { organizationId: true },
  })
  const orgIds = [...new Set(affected.map((a) => a.organizationId))]
  await Promise.all(orgIds.map((orgId) => onCacheEvent('app.connection-def.changed', { orgId })))
}
