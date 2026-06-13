// packages/lib/src/ai/mcp/templates/ensure.ts

import { type Database, database as defaultDb, schema } from '@auxx/database'
import { and, eq, isNull } from 'drizzle-orm'
import type { McpTemplate } from './catalog'

/**
 * Upsert the curated/global (`organizationId: null`) McpServer + ConnectionDefinition for a
 * template. Called at connect time (so new templates work without a re-seed) and from
 * `@auxx/seed`'s McpDomain for fresh installs.
 *
 * Idempotency is manual: the `McpServer_org_slug_idx` unique index is on
 * `(organizationId, slug)` and Postgres treats NULL organizationIds as DISTINCT, so
 * `onConflictDoNothing` would not dedupe global rows. We SELECT by slug and update in place,
 * keeping the row id stable so existing McpInstallations keep their FK.
 *
 * On update, only template-owned fields are written — authorize/token URLs and DCR-minted
 * client creds on the definition are filled lazily on first connect and must survive re-upserts.
 */
export async function ensureCuratedMcpServer(
  template: McpTemplate,
  db: Database = defaultDb
): Promise<{ serverId: string }> {
  const existing = await db
    .select({ id: schema.McpServer.id })
    .from(schema.McpServer)
    .where(and(isNull(schema.McpServer.organizationId), eq(schema.McpServer.slug, template.id)))
    .limit(1)

  const serverValues = {
    organizationId: null,
    slug: template.id,
    name: template.name,
    description: template.description,
    icon: template.icon ?? null,
    endpoint: template.endpoint,
    // Curated rows are catalog-authored, not user-authored — `createdById` FKs to User.
    createdById: null,
  }

  let serverId: string
  if (existing.length > 0) {
    serverId = existing[0]!.id
    await db.update(schema.McpServer).set(serverValues).where(eq(schema.McpServer.id, serverId))
  } else {
    const [created] = await db
      .insert(schema.McpServer)
      .values(serverValues)
      .returning({ id: schema.McpServer.id })
    if (!created) throw new Error(`Failed to insert curated MCP server '${template.id}'`)
    serverId = created.id
  }

  const oauth2Features = {
    pkce: template.connectionType === 'oauth2-code',
  }
  const connectionVariables = template.connectionVariables ?? []

  const existingDef = await db
    .select({ id: schema.ConnectionDefinition.id })
    .from(schema.ConnectionDefinition)
    .where(eq(schema.ConnectionDefinition.mcpServerId, serverId))
    .limit(1)

  if (existingDef.length > 0) {
    await db
      .update(schema.ConnectionDefinition)
      .set({
        connectionType: template.connectionType,
        label: `${template.name} Connection`,
        oauth2Features,
        connectionVariables,
      })
      .where(eq(schema.ConnectionDefinition.id, existingDef[0]!.id))
  } else {
    await db.insert(schema.ConnectionDefinition).values({
      mcpServerId: serverId,
      major: 1,
      connectionType: template.connectionType,
      label: `${template.name} Connection`,
      global: true,
      createdById: 'system',
      oauth2Features,
      connectionVariables,
    })
  }

  return { serverId }
}
