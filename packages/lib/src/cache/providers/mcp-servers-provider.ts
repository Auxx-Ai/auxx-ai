// packages/lib/src/cache/providers/mcp-servers-provider.ts

import { schema } from '@auxx/database'
import { and, eq, inArray, isNull, or } from 'drizzle-orm'
import type { CachedMcpServer } from '../org-cache-keys'
import type { CacheProvider } from '../org-cache-provider'

const CIRCUIT_OPEN_THRESHOLD = 5

/**
 * Computes the MCP servers visible to an org: curated/global rows (organizationId IS NULL)
 * plus the org's own custom rows, each projected with its installation snapshot, connection
 * definition type, and org-wide credential presence.
 *
 * Curated servers with no McpInstallation for this org are still included (tools: []) so the
 * settings page can list them as connectable.
 */
export const mcpServersProvider: CacheProvider<CachedMcpServer[]> = {
  async compute(orgId, db) {
    // 1. Servers: curated (null org) OR owned by this org.
    const servers = await db.query.McpServer.findMany({
      where: or(
        isNull(schema.McpServer.organizationId),
        eq(schema.McpServer.organizationId, orgId)
      ),
    })
    if (servers.length === 0) return []

    const serverIds = servers.map((s) => s.id)

    // 2. Installations for this org (keyed by serverId).
    const installations = await db.query.McpInstallation.findMany({
      where: and(
        eq(schema.McpInstallation.organizationId, orgId),
        inArray(schema.McpInstallation.mcpServerId, serverIds)
      ),
    })
    const installByServer = new Map(installations.map((i) => [i.mcpServerId, i]))

    // 3. Connection definitions for those servers.
    const connDefs = await db.query.ConnectionDefinition.findMany({
      where: inArray(schema.ConnectionDefinition.mcpServerId, serverIds),
      columns: { mcpServerId: true, connectionType: true },
    })
    const connTypeByServer = new Map(
      connDefs
        .filter((d) => d.mcpServerId)
        .map((d) => [
          d.mcpServerId as string,
          d.connectionType as 'oauth2-code' | 'secret' | 'none',
        ])
    )

    // 4. Org-wide credential presence (never decrypt in a provider).
    const creds = await db
      .select({
        mcpServerId: schema.WorkflowCredentials.mcpServerId,
        expiresAt: schema.WorkflowCredentials.expiresAt,
        consecutiveRefreshFailures: schema.WorkflowCredentials.consecutiveRefreshFailures,
      })
      .from(schema.WorkflowCredentials)
      .where(
        and(
          inArray(schema.WorkflowCredentials.mcpServerId, serverIds),
          eq(schema.WorkflowCredentials.organizationId, orgId),
          isNull(schema.WorkflowCredentials.userId),
          eq(schema.WorkflowCredentials.type, 'mcp-connection')
        )
      )
    const credByServer = new Map(creds.filter((c) => c.mcpServerId).map((c) => [c.mcpServerId!, c]))

    // 5. Project.
    return servers.map((server) => {
      const install = installByServer.get(server.id)
      const cred = credByServer.get(server.id)
      const connType = connTypeByServer.get(server.id) ?? null
      // `none`-auth servers are usable as soon as they're installed (no credential to store
      // unless they carry connection variables); secret/OAuth servers need a stored credential.
      const connectionPresent = connType === 'none' ? !!install : !!cred
      const trust = install?.trust ?? {}
      const tools = (install?.tools ?? []).map((tool) => ({
        name: tool.name,
        title: tool.annotations?.title ?? null,
        description: tool.description ?? null,
        readOnlyHint: tool.annotations?.readOnlyHint ?? false,
        trusted: !!(trust.allTools || trust.tools?.includes(tool.name)),
        inputSchema: tool.inputSchema,
      }))

      return {
        serverId: server.id,
        slug: server.slug,
        name: server.name,
        description: server.description ?? null,
        iconUrl: server.iconUrl ?? null,
        isCustom: server.organizationId != null,
        toolsetSlug: `mcp:${server.id}`,
        connectionType: connType,
        connectionPresent,
        connectionExpiresAt: cred?.expiresAt ? cred.expiresAt.toISOString() : null,
        needsReconnect: (cred?.consecutiveRefreshFailures ?? 0) >= CIRCUIT_OPEN_THRESHOLD,
        tools,
        lastSyncedAt: install?.lastSyncedAt ? install.lastSyncedAt.toISOString() : null,
        lastSyncError: install?.lastSyncError ?? null,
      } satisfies CachedMcpServer
    })
  },
}
