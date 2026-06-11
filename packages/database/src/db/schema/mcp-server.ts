// packages/database/src/db/schema/mcp-server.ts
// Drizzle table for an MCP server (curated/global or org-private custom).

import { createId } from '@paralleldrive/cuid2'
import { index, jsonb, pgTable, text, timestamp, uniqueIndex } from './_shared'
import { Organization } from './organization'

/**
 * RFC 9728 / RFC 8414 auth discovery result + Dynamic Client Registration metadata.
 * Written during connect-time OAuth discovery (phase 4).
 */
export type McpAuthDiscovery = {
  /** Authorization server issuer (RFC 8414 metadata document base) */
  authorizationServer: string
  /** RFC 7591 dynamic client registration endpoint, when the AS supports DCR */
  registrationEndpoint?: string
  /** Token returned from DCR allowing later read/update of the registration (not a secret token) */
  registrationAccessToken?: string
  /** ISO timestamp of when discovery ran */
  discoveredAt: string
}

/** Drizzle table for McpServer */
export const McpServer = pgTable(
  'McpServer',
  {
    id: text()
      .$defaultFn(() => createId())
      .primaryKey()
      .notNull(),
    // null = curated/global (seeded); set = org-private custom server
    organizationId: text().references(() => Organization.id, {
      onUpdate: 'cascade',
      onDelete: 'cascade',
    }),
    slug: text().notNull(), // tool namespace: mcp__<slug>__<tool>
    name: text().notNull(),
    description: text(),
    iconUrl: text(),
    endpoint: text().notNull(), // Streamable HTTP URL; may contain {connectionVariable} placeholders
    // RFC 9728/8414 discovery + DCR registration result (written in phase 4)
    authDiscovery: jsonb().$type<McpAuthDiscovery | null>(),
    createdById: text(),
    createdAt: timestamp({ precision: 3 }).defaultNow().notNull(),
    // Drizzle-level auto-update (not a Postgres trigger) — same idiom as
    // entity-definition.ts / task.ts / workflow-template.ts
    updatedAt: timestamp({ precision: 3 })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex('McpServer_org_slug_idx').on(t.organizationId, t.slug),
    index('McpServer_org_idx').on(t.organizationId),
  ]
)
