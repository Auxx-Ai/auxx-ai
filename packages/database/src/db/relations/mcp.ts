// packages/database/src/db/relations/mcp.ts
// Relations for the MCP server domain

import { relations } from 'drizzle-orm/relations'
import {
  ConnectionDefinition,
  Credential,
  McpInstallation,
  McpServer,
  Organization,
} from '../schema'

/** Relations for McpServer */
export const mcpServerRelations = relations(McpServer, ({ one, many }) => ({
  organization: one(Organization, {
    fields: [McpServer.organizationId],
    references: [Organization.id],
  }),
  installations: many(McpInstallation),
  connectionDefinitions: many(ConnectionDefinition),
  credentials: many(Credential),
}))

/** Relations for McpInstallation */
export const mcpInstallationRelations = relations(McpInstallation, ({ one }) => ({
  server: one(McpServer, {
    fields: [McpInstallation.mcpServerId],
    references: [McpServer.id],
  }),
  organization: one(Organization, {
    fields: [McpInstallation.organizationId],
    references: [Organization.id],
  }),
}))
