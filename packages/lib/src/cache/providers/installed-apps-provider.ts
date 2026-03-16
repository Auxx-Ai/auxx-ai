// packages/lib/src/cache/providers/installed-apps-provider.ts

import type { CachedInstalledApp } from '../org-cache-keys'
import type { CacheProvider } from '../org-cache-provider'

/** Computes installed apps with connection definitions for an organization */
export const installedAppsProvider: CacheProvider<CachedInstalledApp[]> = {
  async compute(orgId, db) {
    // 1. Query installations with relations (same query as getInstalledApps)
    const installations = await db.query.AppInstallation.findMany({
      where: (t, { eq, and, isNull }) => and(eq(t.organizationId, orgId), isNull(t.uninstalledAt)),
      with: {
        app: true,
        currentDeployment: {
          with: { clientBundle: true },
        },
      },
      orderBy: (t, { desc }) => desc(t.installedAt),
    })

    // 2. Batch-fetch connection definitions for all installed app IDs
    //    Replaces the N+1 getAppConnectionDefinition pattern
    const appIds = installations.map((i) => i.app.id)
    const connectionDefs =
      appIds.length > 0
        ? await db.query.ConnectionDefinition.findMany({
            where: (t, { inArray }) => inArray(t.appId, appIds),
            columns: {
              appId: true,
              label: true,
              global: true,
              connectionType: true,
              oauth2Features: true,
            },
          })
        : []

    // Index by appId (prefer user-scoped over org-scoped, matching getInstalledApps logic)
    const connDefMap = new Map<string, (typeof connectionDefs)[0]>()
    for (const def of connectionDefs) {
      const existing = connDefMap.get(def.appId)
      // Prefer non-global (user-scoped) — same priority as getInstalledApps
      if (!existing || (existing.global && !def.global)) {
        connDefMap.set(def.appId, def)
      }
    }

    // 3. Build serializable output
    return installations.map((inst) => ({
      installationId: inst.id,
      installationType: inst.installationType as 'development' | 'production',
      installedAt: inst.installedAt.toISOString(),
      app: {
        id: inst.app.id,
        slug: inst.app.slug,
        title: inst.app.title,
        description: inst.app.description,
        avatarUrl: inst.app.avatarUrl,
        category: inst.app.category,
      },
      currentDeployment: inst.currentDeployment
        ? {
            id: inst.currentDeployment.id,
            version: inst.currentDeployment.version,
            deploymentType: inst.currentDeployment.deploymentType,
            status: inst.currentDeployment.status,
            clientBundleSha: inst.currentDeployment.clientBundle.sha256,
            createdAt: inst.currentDeployment.createdAt.toISOString(),
          }
        : null,
      connectionDefinition: (() => {
        const def = connDefMap.get(inst.app.id)
        if (!def) return undefined
        return {
          label: def.label,
          global: def.global,
          connectionType: def.connectionType,
          oauth2Features: def.oauth2Features as Record<string, unknown> | null,
        }
      })(),
    }))
  },
}
