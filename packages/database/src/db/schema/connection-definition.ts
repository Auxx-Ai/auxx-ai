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
  uniqueIndex,
} from './_shared'
import { App } from './app'
import { DeveloperAccount } from './developer-account'
import { McpServer } from './mcp-server'

/**
 * A dynamic variable that organizations must provide when connecting.
 * `oauth2-code`: interpolated into {key} placeholders in URLs/credentials.
 * `secret`: rendered as one input of the multi-field connect form.
 *
 * This is the full field model that subsumes the old workflow-node
 * `INodeProperty` shape — number/boolean/options/textarea inputs, defaults,
 * conditional visibility, and validation — so DB/email credentials
 * (postgres, smtp, imap, …) can be expressed as ConnectionDefinition rows.
 */
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
  /** Input kind. Default: 'string'. 'password' implies secret rendering. */
  type?: 'string' | 'password' | 'number' | 'boolean' | 'options' | 'textarea'
  /** Default value seeded into the form when the field is empty. */
  default?: string | number | boolean
  /** Choices for `type: 'options'` (rendered as a dropdown). */
  options?: { name: string; value: string }[]
  /** Field-level validation constraints. */
  validation?: {
    minLength?: number
    maxLength?: number
    min?: number
    max?: number
    /** Validate as a TCP port (1–65535). */
    port?: boolean
  }
  /**
   * Conditional visibility. The field is shown only when every key in `show`
   * has a current value present in its allowed-values array.
   */
  displayOptions?: { show?: Record<string, (string | number | boolean)[]> }
  /** Row count for `type: 'textarea'`. */
  rows?: number
}

/**
 * Declarative spec for how a resolved credential is applied to an outgoing HTTP
 * request. Lifted from the workflow HTTP node's hand-rolled `buildAuthHeaders`.
 * `null` for DB/email/none connection types — those are secret bags the
 * consuming driver reads via `connection.fields`, not HTTP-request auth.
 *
 * `{value}` interpolates the resolved token (oauth2 access token, or the
 * `secret`); templated header values may also interpolate other `fields`.
 */
export type AuthApply =
  | { in: 'header'; name: string; format?: string }
  | { in: 'basic' }
  | { in: 'query'; name: string }

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
    // Platform built-in owner (third owner, mutually exclusive with appId/mcpServerId).
    // Equals the old ICredentialType.name (e.g. 'googleOAuth2Api', 'postgres') and
    // doubles as the lookup key for platform-provider credentials (Credential.type).
    providerKey: text(),
    major: integer().notNull(), // Version major

    // Connection type: oauth2-code, secret, none
    connectionType: text().notNull(),
    label: text().notNull(),
    description: text(),
    global: boolean().default(false), // true = organization-wide, false = user-specific

    // OAuth2 config
    oauth2AuthorizeUrl: text(),
    oauth2AccessTokenUrl: text(),
    // Optional dedicated refresh endpoint. Refresh defaults to the access-token URL when null
    // (some providers — e.g. UPS — expose a separate /refresh endpoint that rejects the token URL).
    oauth2RefreshUrl: text(),
    oauth2Scopes: jsonb().$type<string[]>().default([]),
    oauth2ClientId: text(), // v2 secret-box ciphertext (see @auxx/credentials/crypto decryptValue policy)
    oauth2ClientSecret: text(), // v2 secret-box ciphertext (see @auxx/credentials/crypto decryptValue policy)
    oauth2TokenRequestAuthMethod: text().default('request-body'), // request-body, basic-auth
    oauth2RefreshTokenIntervalSeconds: integer(),
    oauth2Features: jsonb().$type<OAuth2Features>().default({}),

    // Dynamic variables the org provides at connect time. oauth2-code: interpolated
    // into {key} placeholders. secret: rendered as the multi-field connect form.
    connectionVariables: jsonb().$type<ConnectionVariable[]>().default([]),

    // How a resolved credential becomes request auth (§3). NULL for DB/email/none
    // types — those are read directly from connection.fields by the consuming driver.
    authApply: jsonb().$type<AuthApply>(),

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
    // One row per platform built-in provider, scoped by major for versioning.
    uniqueIndex('ConnectionDefinition_providerKey_major_idx').using(
      'btree',
      table.providerKey.asc().nullsLast(),
      table.major.asc().nullsLast()
    ),
    // Exactly one owner: an App, an MCP-server, or a platform built-in definition.
    check(
      'ConnectionDefinition_owner_check',
      sql`(("appId" IS NOT NULL)::int + ("mcpServerId" IS NOT NULL)::int + ("providerKey" IS NOT NULL)::int) = 1`
    ),
  ]
)
