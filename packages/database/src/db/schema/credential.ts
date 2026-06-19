// packages/database/src/db/schema/credential.ts
// Drizzle table: Credential — unified credential store

import { createId } from '@paralleldrive/cuid2'
import {
  type AnyPgColumn,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  sql,
  text,
  timestamp,
  uniqueIndex,
} from './_shared'
import { App } from './app'
import { AppInstallation } from './app-installation'
import { ConnectionDefinition } from './connection-definition'
import { McpServer } from './mcp-server'
import { Organization } from './organization'
import { User } from './user'

/**
 * Unified credential store. One table behind four credential families,
 * discriminated by `kind` ('app' | 'mcp' | 'integration' | 'workflow').
 */
export const Credential = pgTable(
  'Credential',
  {
    id: text()
      .$defaultFn(() => createId())
      .primaryKey()
      .notNull(),
    organizationId: text()
      .notNull()
      .references((): AnyPgColumn => Organization.id, { onUpdate: 'cascade', onDelete: 'cascade' }),
    createdById: text().references((): AnyPgColumn => User.id, {
      onUpdate: 'cascade',
      onDelete: 'cascade',
    }),

    /** Discriminator: which credential family owns this row. */
    kind: text().notNull().default('workflow'), // 'app' | 'mcp' | 'integration' | 'workflow'
    /**
     * Kind-specific subtype: workflow credential type ('telegram-bot'), integration provider
     * ('gmail'). NULL for app/mcp kinds — the owner FK (appId/mcpServerId) identifies the target.
     */
    type: text(),

    // App connection fields
    userId: text().references((): AnyPgColumn => User.id, {
      onUpdate: 'cascade',
      onDelete: 'cascade',
    }),
    appId: text().references((): AnyPgColumn => App.id, {
      onUpdate: 'cascade',
      onDelete: 'cascade',
    }),
    appInstallationId: text().references((): AnyPgColumn => AppInstallation.id, {
      onUpdate: 'cascade',
      onDelete: 'cascade',
    }),
    // MCP connection owner (kind 'mcp'). Generic workflow credentials
    // legitimately have no owner, so no check constraint here.
    mcpServerId: text().references((): AnyPgColumn => McpServer.id, {
      onUpdate: 'cascade',
      onDelete: 'cascade',
    }),
    // Direct link to the provider blueprint (any owner). Lets the resolver and
    // token refresh load the definition in one lookup instead of inferring it
    // from (kind, type) / (appId) / (mcpServerId). Nullable during transition.
    connectionDefinitionId: text().references((): AnyPgColumn => ConnectionDefinition.id, {
      onUpdate: 'cascade',
      onDelete: 'set null',
    }),

    // The org-scoped app connection that record actions (and other unbound,
    // org-global resolvers) use when an app has more than one connection — by
    // method OR by account. Agents/workflows bind a specific credId and ignore
    // this. At most one primary per (org, app) among org-scoped app rows (index below).
    isDefault: boolean().default(false).notNull(),

    name: text().notNull(),
    label: text(), // User-facing label for connection picker (e.g. "Telegram Bot", "Telegram Bot (2)")

    /** AES-256-GCM blob — secrets ONLY (tokens, keys, passwords). See @auxx/credentials/crypto. */
    encryptedSecrets: text().notNull(),
    /** Plaintext non-secret companion data: scopes, account email, shop domain, connection vars… */
    metadata: jsonb().$type<Record<string, unknown>>().default({}).notNull(),

    createdAt: timestamp({ precision: 3 }).defaultNow().notNull(),
    updatedAt: timestamp({ precision: 3 }).notNull(),

    // OAuth2 token expiration and refresh tracking (expiresAt is the ONLY home of expiry)
    expiresAt: timestamp({ precision: 3 }),
    lastRefreshAt: timestamp({ precision: 3 }), // Last successful token refresh
    lastRefreshFailureAt: timestamp({ precision: 3 }), // Last failed refresh attempt
    consecutiveRefreshFailures: integer().default(0).notNull(), // Circuit breaker counter
  },
  (table) => [
    index('Credential_createdById_idx').using('btree', table.createdById.asc().nullsLast()),
    index('Credential_organizationId_idx').using('btree', table.organizationId.asc().nullsLast()),
    index('Credential_organizationId_kind_idx').using(
      'btree',
      table.organizationId.asc().nullsLast(),
      table.kind.asc().nullsLast()
    ),
    // App connection indexes
    index('Credential_appId_organizationId_idx').using(
      'btree',
      table.appId.asc().nullsLast(),
      table.organizationId.asc().nullsLast()
    ),
    index('Credential_userId_appId_idx').using(
      'btree',
      table.userId.asc().nullsLast(),
      table.appId.asc().nullsLast()
    ),
    index('Credential_appInstallationId_idx').using(
      'btree',
      table.appInstallationId.asc().nullsLast()
    ),
    index('Credential_mcpServerId_idx').using(
      'btree',
      table.mcpServerId.asc().nullsLast(),
      table.organizationId.asc().nullsLast()
    ),
    index('Credential_connectionDefinitionId_idx').using(
      'btree',
      table.connectionDefinitionId.asc().nullsLast()
    ),
    // At most one primary org-scoped app connection per (org, app). Partial +
    // userId-IS-NULL-scoped: the record-action path resolves org-scope only, and
    // Postgres treats NULL-userId rows as distinct, so a plain composite unique
    // would not enforce a single primary.
    uniqueIndex('Credential_app_org_default_idx')
      .on(table.organizationId, table.appId)
      .where(sql`"isDefault" = true AND "userId" IS NULL AND "kind" = 'app'`),
    // OAuth2 refresh indexes
    index('Credential_expiresAt_idx').using('btree', table.expiresAt.asc().nullsLast()),
    index('Credential_lastRefreshAt_idx').using('btree', table.lastRefreshAt.asc().nullsLast()),
  ]
)
