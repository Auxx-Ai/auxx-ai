// packages/seed/src/domains/mcp.domain.ts
// Idempotent seeder for curated (global) MCP servers available to every organization.

import type { ConnectionVariable, Database, McpServerIcon } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'

const logger = createScopedLogger('mcp-domain')

/** A curated MCP server + its connection posture, seeded as a global (org-less) row. */
interface CuratedMcpServer {
  slug: string
  name: string
  description: string
  icon?: McpServerIcon
  /** Streamable HTTP endpoint; may contain `{connectionVariable}` placeholders. */
  endpoint: string
  /** oauth2-code → OAuth 2.1 (client creds minted lazily via DCR on first connect). */
  connectionType: 'oauth2-code' | 'secret' | 'none'
  /** Variables the org must supply at connect time (interpolated into the endpoint). */
  connectionVariables?: ConnectionVariable[]
}

/**
 * Curated servers. Endpoints + auth posture verified against live provider docs (2026-06):
 *  - Linear/Notion: hosted, OAuth 2.1 + Dynamic Client Registration (no static client creds).
 *  - Shopify storefront: public per-store endpoint, no auth; needs the shop subdomain.
 */
const CURATED_SERVERS: CuratedMcpServer[] = [
  {
    slug: 'linear',
    name: 'Linear',
    description: 'Find, create, and update Linear issues, projects, and comments.',
    endpoint: 'https://mcp.linear.app/mcp',
    connectionType: 'oauth2-code',
  },
  {
    slug: 'notion',
    name: 'Notion',
    description: 'Search, read, and update pages and databases in your Notion workspace.',
    endpoint: 'https://mcp.notion.com/mcp',
    connectionType: 'oauth2-code',
  },
  {
    slug: 'shopify',
    name: 'Shopify Storefront',
    description: 'Search products, manage carts, and read store policies on a Shopify storefront.',
    endpoint: 'https://{shop}.myshopify.com/api/mcp',
    connectionType: 'none',
    connectionVariables: [
      {
        key: 'shop',
        label: 'Shop subdomain',
        description: 'Only the subdomain, e.g. my-store from my-store.myshopify.com',
        placeholder: 'my-store',
        required: true,
      },
    ],
  },
]

/**
 * McpDomain upserts the curated/global MCP servers (`organizationId: null`) that every
 * organization can browse and connect from Settings → Apps.
 *
 * Idempotency is manual: the `McpServer_org_slug_idx` unique index is on
 * `(organizationId, slug)` and Postgres treats NULL organizationIds as DISTINCT, so
 * `onConflictDoNothing` would not dedupe global rows. We therefore SELECT by slug
 * (organizationId IS NULL) and update in place, keeping the row id stable so existing
 * McpInstallations keep their FK.
 */
export class McpDomain {
  /**
   * Upserts all curated servers + their connection definitions. Safe to re-run.
   * @param db - Drizzle database instance.
   */
  async insertDirectly(db: Database): Promise<void> {
    const { schema } = await import('@auxx/database')
    const { and, eq, isNull } = await import('drizzle-orm')

    for (const curated of CURATED_SERVERS) {
      const existing = await db
        .select({ id: schema.McpServer.id })
        .from(schema.McpServer)
        .where(
          and(isNull(schema.McpServer.organizationId), eq(schema.McpServer.slug, curated.slug))
        )
        .limit(1)

      const serverValues = {
        organizationId: null,
        slug: curated.slug,
        name: curated.name,
        description: curated.description,
        icon: curated.icon ?? null,
        endpoint: curated.endpoint,
        // Curated rows are seeded, not user-authored — `createdById` FKs to User (set null).
        createdById: null,
      }

      let serverId: string
      if (existing.length > 0) {
        serverId = existing[0]!.id
        await db.update(schema.McpServer).set(serverValues).where(eq(schema.McpServer.id, serverId))
        logger.info('Updated curated MCP server', { slug: curated.slug })
      } else {
        const [created] = await db
          .insert(schema.McpServer)
          .values(serverValues)
          .returning({ id: schema.McpServer.id })
        serverId = created!.id
        logger.info('Inserted curated MCP server', { slug: curated.slug })
      }

      // Connection definition (one per server). OAuth servers carry only `pkce: true` +
      // connectionVariables; authorize/token URLs and DCR-minted client creds are filled
      // lazily by `connectCuratedMcpServer` on first org connect.
      const defValues = {
        mcpServerId: serverId,
        major: 1,
        connectionType: curated.connectionType,
        label: `${curated.name} Connection`,
        global: true,
        createdById: 'system',
        oauth2Features: {
          pkce: curated.connectionType === 'oauth2-code',
          connectionVariables: curated.connectionVariables ?? [],
        },
      }

      const existingDef = await db
        .select({ id: schema.ConnectionDefinition.id })
        .from(schema.ConnectionDefinition)
        .where(eq(schema.ConnectionDefinition.mcpServerId, serverId))
        .limit(1)

      if (existingDef.length > 0) {
        await db
          .update(schema.ConnectionDefinition)
          .set({
            connectionType: defValues.connectionType,
            label: defValues.label,
            oauth2Features: defValues.oauth2Features,
          })
          .where(eq(schema.ConnectionDefinition.id, existingDef[0]!.id))
      } else {
        await db.insert(schema.ConnectionDefinition).values(defValues)
      }
    }
  }
}
