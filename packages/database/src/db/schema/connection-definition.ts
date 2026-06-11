// packages/database/src/db/schema/connection-definition.ts
// Drizzle table for connection definition

import { createId } from '@paralleldrive/cuid2'
import {
  type AnyPgColumn,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  sql,
  text,
  timestamp,
} from './_shared'
import { App } from './app'
import { DeveloperAccount } from './developer-account'
import { McpServer } from './mcp-server'

/** A dynamic variable that organizations must provide when connecting */
export type ConnectionVariable = {
  /** Variable key matching {placeholder} in fields (e.g., "shop", "client_id") */
  key: string
  /** Human-readable label shown in the form (e.g., "Shop Subdomain") */
  label: string
  /** Help text (e.g., "Only the subdomain, e.g. my-store from my-store.myshopify.com") */
  description?: string
  /** Placeholder text for the input field */
  placeholder?: string
  /** Whether this variable is required (default: true) */
  required?: boolean
  /** Whether the input should be masked (for secrets like client_secret) */
  secret?: boolean
}

/** OAuth2 feature flags and provider-specific configuration */
export type OAuth2Features = {
  /** Enable PKCE with S256 (RFC 7636) */
  pkce?: boolean
  /** Override the callback base URL (e.g. use localhost instead of NGROK). Falls back to WEBAPP_URL. */
  callbackBaseUrl?: string
  /** Static params appended to the authorize URL */
  additionalAuthorizeParams?: Record<string, string>
  /** Static params appended to the token exchange request body */
  additionalTokenParams?: Record<string, string>
  /** Scope separator character. Default: ' ' (space) */
  scopeSeparator?: string
  /** Callback query param names to capture and store as connection metadata */
  callbackMetadataParams?: string[]
  /** Dynamic variables the org must provide before OAuth redirect */
  connectionVariables?: ConnectionVariable[]
}

/** Drizzle table for ConnectionDefinition */
export const ConnectionDefinition = pgTable(
  'ConnectionDefinition',
  {
    id: text()
      .$defaultFn(() => createId())
      .primaryKey()
      .notNull(),
    // Nullable now that MCP-owned definitions exist (mcpServerId owner instead).
    developerAccountId: text().references((): AnyPgColumn => DeveloperAccount.id, {
      onUpdate: 'cascade',
      onDelete: 'cascade',
    }),
    appId: text().references((): AnyPgColumn => App.id, {
      onUpdate: 'cascade',
      onDelete: 'cascade',
    }),
    // MCP server owner (mutually exclusive with appId — see owner check below).
    mcpServerId: text().references((): AnyPgColumn => McpServer.id, {
      onUpdate: 'cascade',
      onDelete: 'cascade',
    }),
    major: integer().notNull(), // Version major

    // Connection type: oauth2-code, secret, none
    connectionType: text().notNull(),
    label: text().notNull(),
    description: text(),
    global: boolean().default(false), // true = organization-wide, false = user-specific

    // OAuth2 config
    oauth2AuthorizeUrl: text(),
    oauth2AccessTokenUrl: text(),
    oauth2Scopes: jsonb().$type<string[]>().default([]),
    oauth2ClientId: text(), // v2 secret-box ciphertext (see @auxx/credentials/crypto decryptValue policy)
    oauth2ClientSecret: text(), // v2 secret-box ciphertext (see @auxx/credentials/crypto decryptValue policy)
    oauth2TokenRequestAuthMethod: text().default('request-body'), // request-body, basic-auth
    oauth2RefreshTokenIntervalSeconds: integer(),
    oauth2Features: jsonb().$type<OAuth2Features>().default({}),

    // Creator
    createdById: text().notNull(), // { id, type: 'developer-account-member' }

    createdAt: timestamp({ precision: 3 }).defaultNow().notNull(),
    updatedAt: timestamp({ precision: 3 }).defaultNow().notNull(),
  },
  (table) => [
    index('ConnectionDefinition_app_version_idx').using(
      'btree',
      table.appId.asc().nullsLast(),
      table.major.asc().nullsLast()
    ),
    index('ConnectionDefinition_mcpServerId_idx').using(
      'btree',
      table.mcpServerId.asc().nullsLast()
    ),
    // Exactly one owner: an App definition or an MCP-server definition.
    check(
      'ConnectionDefinition_owner_check',
      sql`(("appId" IS NOT NULL)::int + ("mcpServerId" IS NOT NULL)::int) = 1`
    ),
  ]
)
