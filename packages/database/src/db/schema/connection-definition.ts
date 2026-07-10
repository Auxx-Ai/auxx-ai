// packages/database/src/db/schema/connection-definition.ts
// Drizzle table for connection definition

import { createId } from '@paralleldrive/cuid2'
import type { FieldType } from '../../types'
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
 * A single choice for a `SINGLE_SELECT` connection variable. Structural mirror
 * of `@auxx/types`' `SelectOption` (duplicated because `@auxx/types` depends on
 * `@auxx/database`, not the reverse) so it flows straight into the field
 * renderer's `fieldOptions.options`.
 */
export type ConnectionVariableOption = {
  /** Stable id (optional — connection options are keyed by value). */
  id?: string
  /** Human-readable label shown in the dropdown. */
  label: string
  /** Stored/submitted value. */
  value: string
}

/**
 * A dynamic variable that organizations must provide when connecting.
 * `oauth2-code`: interpolated into {key} placeholders in URLs/credentials.
 * `secret`: rendered as one input of the multi-field connect form.
 *
 * Inputs are described with the platform `FieldType` so every renderer picks
 * the correct control (TEXT, NUMBER, CHECKBOX, SINGLE_SELECT). Masking
 * (`secret`) and multiline (`multiline`/`rows`) are orthogonal presentation
 * hints layered on top of the type, not separate types.
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
  /** Whether the input should be masked (for secrets like client_secret). Independent of `type`. */
  secret?: boolean
  /**
   * Platform field type. Default: `TEXT`. Only TEXT, NUMBER, CHECKBOX, and
   * SINGLE_SELECT are produced for connection variables. Masking is the `secret`
   * flag; multiline is the `multiline` flag — neither is a `type`.
   */
  type?: FieldType
  /** Default value seeded into the form when the field is empty. */
  default?: string | number | boolean
  /** Choices for `type: 'SINGLE_SELECT'` (rendered as a dropdown). */
  options?: ConnectionVariableOption[]
  /** Render a TEXT field as a multiline autosize textarea (e.g. an SSH private key). */
  multiline?: boolean
  /** Field-level validation constraints. */
  validation?: {
    minLength?: number
    maxLength?: number
    min?: number
    max?: number
    /** Validate as a TCP port (1–65535). */
    port?: boolean
    /** Regex the value must match (lifted from AI credential fields). */
    pattern?: string
    /** Message shown when `pattern` fails. */
    message?: string
  }
  /**
   * Conditional visibility. The field is shown only when every key in `show`
   * has a current value present in its allowed-values array.
   */
  displayOptions?: { show?: Record<string, (string | number | boolean)[]> }
  /** Preferred visible row count for a `multiline` TEXT field. */
  rows?: number
}

/**
 * One credential insertion onto an outgoing HTTP request.
 *
 * `{value}` interpolates the resolved token (oauth2 access token, or the
 * `secret`); templated `name`/`format` values may also interpolate other `fields`.
 *  - `header`: set `name` to `format` (default the raw token).
 *  - `basic`: HTTP Basic from two fields (default `user`/`password`).
 *  - `query`: append `name=<format>` (default the raw token) to the URL.
 */
export type AuthInsertion =
  | { in: 'header'; name: string; format?: string }
  | { in: 'basic'; userField?: string; passwordField?: string }
  | { in: 'query'; name: string; format?: string }

/**
 * Declarative spec for how a resolved credential is applied to an outgoing HTTP
 * request. Lifted from the workflow HTTP node's hand-rolled `buildAuthHeaders`.
 * `null` for DB/email/none connection types — those are secret bags the
 * consuming driver reads via `connection.fields`, not HTTP-request auth.
 *
 * Either a single insertion (the common case — e.g. a Bearer header), or a
 * multi-insertion spec carrying several insertions (e.g. Supabase's `apikey` +
 * `Authorization`) plus optional `headers` — constant non-auth headers applied
 * verbatim (e.g. `Notion-Version`, `X-GitHub-Api-Version`).
 */
export type AuthApply =
  | AuthInsertion
  | { insertions: AuthInsertion[]; headers?: Record<string, string> }

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
    // Method id within an app (e.g. 'oauth2', 'api_key') — the stable, addressable
    // identity of one connection method. NOT NULL for app rows (owner check below);
    // null for mcp/platform-owned rows, which use mcpServerId/providerKey as identity.
    key: text(),
    major: integer().notNull(), // Version major

    // Connection type: oauth2-code, client-credentials, secret, hosted-provision, none.
    // `client-credentials` is the server-minted M2M OAuth2 grant — same minting columns as
    // oauth2-code (sans the browser-redirect fields), downstream an ordinary bearer connection.
    // `hosted-provision` (platform-provider-only): the platform calls the provider's API to
    // create/find a resource, sends the user through the provider's HOSTED onboarding flow, and
    // persists the returned identifier — no OAuth code exchange, no secret-field dialog. See
    // packages/lib/src/connections/hosted-provision/types.ts.
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

    // Is the platform's own OAuth client usable for this provider, or must each
    // connection bring its own client id/secret? Default true; seeded false for
    // providers whose platform app is pending verification (Google restricted
    // scopes). Generalizes the old GOOGLE/OUTLOOK_PLATFORM_CREDENTIALS_APPROVED
    // env flags into one per-def column (see resolveOwnClientRequirement).
    platformClientApproved: boolean().notNull().default(true),

    // Dynamic variables the org provides at connect time. oauth2-code: interpolated
    // into {key} placeholders. secret: rendered as the multi-field connect form.
    connectionVariables: jsonb().$type<ConnectionVariable[]>().default([]),

    // How a resolved credential becomes request auth (§3). NULL for DB/email/none
    // types — those are read directly from connection.fields by the consuming driver.
    authApply: jsonb().$type<AuthApply>(),

    // Base-URL template the connection contributes to a request's origin (§3).
    // Interpolated from `value` + `fields` at resolve time (e.g.
    // 'https://{shop}.myshopify.com', 'https://api.telegram.org/bot{value}') and
    // prepended to a relative request path by the HTTP transport. NULL for
    // connections whose endpoint is fixed or supplied by the caller.
    baseUrlTemplate: text(),

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
    // Distinct methods per app/version. Partial (apps only) — platform/mcp rows use their
    // own identity. App rows MUST carry `key` (owner check), so the NULL-is-distinct trap
    // can't insert duplicate app methods.
    uniqueIndex('ConnectionDefinition_app_key_major_idx')
      .on(table.appId, table.key, table.major)
      .where(sql`"appId" IS NOT NULL`),
    // Exactly one owner: an App, an MCP-server, or a platform built-in definition.
    // App-owned rows additionally require a method `key` (else the partial unique index
    // above is toothless — Postgres treats NULLs as distinct).
    check(
      'ConnectionDefinition_owner_check',
      sql`(("appId" IS NOT NULL)::int + ("mcpServerId" IS NOT NULL)::int + ("providerKey" IS NOT NULL)::int) = 1
       AND ("appId" IS NULL OR "key" IS NOT NULL)`
    ),
  ]
)
