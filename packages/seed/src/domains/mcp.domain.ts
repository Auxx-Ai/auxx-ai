// packages/seed/src/domains/mcp.domain.ts
// Idempotent seeder for curated (global) MCP servers available to every organization.

import type { Database } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'

const logger = createScopedLogger('mcp-domain')

/**
 * McpDomain upserts the curated/global MCP servers (`organizationId: null`) that every
 * organization can browse and connect from Settings → Apps. The catalog lives in
 * `@auxx/lib/ai/mcp` (templates module) — it is also upserted lazily at connect time, so this
 * seeder only matters for fresh installs and keeping long-lived environments tidy.
 */
export class McpDomain {
  /**
   * Upserts all catalog templates + their connection definitions. Safe to re-run.
   * @param db - Drizzle database instance.
   */
  async insertDirectly(db: Database): Promise<void> {
    const { ensureCuratedMcpServer, mcpTemplates } = await import('@auxx/lib/ai/mcp')

    for (const template of mcpTemplates) {
      await ensureCuratedMcpServer(template, db)
      logger.info('Upserted curated MCP server', { slug: template.id })
    }
  }
}
