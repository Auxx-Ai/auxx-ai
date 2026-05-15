// packages/lib/src/cache/providers/installed-apps-provider.ts

import { schema } from '@auxx/database'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import type { CachedInstalledApp } from '../org-cache-keys'
import type { CacheProvider } from '../org-cache-provider'

/**
 * Computes installed apps with connection definitions for an organization.
 *
 * Extended for the AI tool bridge (decision B2 in
 * `plans/kopilot/agents/tool-loading-and-execution.md` §3):
 * each row now carries the deployment's AI tool catalog plus a denormalized
 * `orgConnectionPresent` / `orgConnectionExpiresAt` via a left join on
 * `WorkflowCredentials WHERE userId IS NULL`. User-scope presence stays a
 * per-request direct DB hit (decision G2).
 */
export const installedAppsProvider: CacheProvider<CachedInstalledApp[]> = {
  async compute(orgId, db) {
    // 1. Query installations with relations (same query as getInstalledApps)
    const installations = await db.query.AppInstallation.findMany({
      where: (t, { eq, and, isNull }) => and(eq(t.organizationId, orgId), isNull(t.uninstalledAt)),
      with: {
        app: true,
        currentDeployment: {
          with: { clientBundle: true, serverBundle: true },
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

    // 2b. Org-scope connection presence — single batched query per
    //     decision B2 + G2. User-scope stays a per-request direct hit.
    const orgConnectionRows =
      appIds.length > 0
        ? await db
            .select({
              appId: schema.WorkflowCredentials.appId,
              expiresAt: schema.WorkflowCredentials.expiresAt,
            })
            .from(schema.WorkflowCredentials)
            .where(
              and(
                inArray(schema.WorkflowCredentials.appId, appIds),
                eq(schema.WorkflowCredentials.organizationId, orgId),
                isNull(schema.WorkflowCredentials.userId),
                eq(schema.WorkflowCredentials.type, 'app-connection')
              )
            )
        : []
    const orgConnByAppId = new Map<string, { present: boolean; expiresAt: Date | null }>()
    for (const row of orgConnectionRows) {
      if (!row.appId) continue
      orgConnByAppId.set(row.appId, { present: true, expiresAt: row.expiresAt })
    }

    // Index by appId, keeping both scopes. global === false → user, global === true → organization.
    const connDefsByAppId = new Map<
      string,
      { user?: (typeof connectionDefs)[0]; organization?: (typeof connectionDefs)[0] }
    >()
    for (const def of connectionDefs) {
      const existing = connDefsByAppId.get(def.appId) ?? {}
      if (def.global) existing.organization = def
      else existing.user = def
      connDefsByAppId.set(def.appId, existing)
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
            serverBundleSha: inst.currentDeployment.serverBundle.sha256,
            createdAt: inst.currentDeployment.createdAt.toISOString(),
          }
        : null,
      connectionDefinitions: (() => {
        const defs = connDefsByAppId.get(inst.app.id) ?? {}
        const toCached = (def: (typeof connectionDefs)[0] | undefined) =>
          def
            ? {
                label: def.label,
                global: def.global,
                connectionType: def.connectionType,
                oauth2Features: def.oauth2Features as Record<string, unknown> | null,
              }
            : undefined
        return {
          user: toCached(defs.user),
          organization: toCached(defs.organization),
        }
      })(),
      aiTools: inst.currentDeployment?.aiTools?.tools ?? undefined,
      aiToolsets: inst.currentDeployment?.aiTools?.toolsets ?? undefined,
      orgConnectionPresent: orgConnByAppId.get(inst.app.id)?.present ?? false,
      orgConnectionExpiresAt: orgConnByAppId.get(inst.app.id)?.expiresAt?.toISOString() ?? null,
    }))
  },
}
