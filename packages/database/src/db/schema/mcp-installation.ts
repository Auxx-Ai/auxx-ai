// packages/database/src/db/schema/mcp-installation.ts
// Per-org state for an MCP server: tool snapshot + trust + sync status.

import { createId } from '@paralleldrive/cuid2'
import { jsonb, pgTable, text, timestamp, uniqueIndex } from './_shared'
import { McpServer } from './mcp-server'
import { Organization } from './organization'

/** A single tool from `tools/list`, snapshotted at sync time. */
export type McpToolDescriptor = {
  name: string
  description?: string
  inputSchema: Record<string, unknown> // JSON Schema from tools/list
  annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean; title?: string }
}

/** Admin trust overrides per server: trust all tools, or a named subset. */
export type McpTrustConfig = { allTools?: boolean; tools?: string[] }

/** Drizzle table for McpInstallation */
export const McpInstallation = pgTable(
  'McpInstallation',
  {
    id: text()
      .$defaultFn(() => createId())
      .primaryKey()
      .notNull(),
    organizationId: text()
      .notNull()
      .references(() => Organization.id, { onUpdate: 'cascade', onDelete: 'cascade' }),
    mcpServerId: text()
      .notNull()
      .references(() => McpServer.id, { onUpdate: 'cascade', onDelete: 'cascade' }),
    tools: jsonb().$type<McpToolDescriptor[]>().default([]).notNull(),
    serverInfo: jsonb().$type<{ name?: string; version?: string } | null>(),
    protocolVersion: text(),
    trust: jsonb().$type<McpTrustConfig>().default({}).notNull(),
    lastSyncedAt: timestamp({ precision: 3 }),
    lastSyncError: text(),
    createdAt: timestamp({ precision: 3 }).defaultNow().notNull(),
    updatedAt: timestamp({ precision: 3 })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (t) => [uniqueIndex('McpInstallation_org_server_idx').on(t.organizationId, t.mcpServerId)]
)
