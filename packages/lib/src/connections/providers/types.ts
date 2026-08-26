// packages/lib/src/connections/providers/types.ts
// Shape of a platform built-in connection provider, ported from the old
// workflow-node CREDENTIAL_REGISTRY. Each def is upserted into a single
// ConnectionDefinition row (owner = providerKey) by ensure-platform-providers.

import type { AuthApply, ConnectionVariable, OAuth2Features } from '@auxx/database'

/** UI metadata mirrored onto the connect surface (catalog step). */
export type ProviderUiMetadata = {
  /**
   * Visual-ref consumed by `AppIcon`/`VisualIcon` (see `parseVisualRef`). Prefer a
   * brand mark — `brand:<slug>` resolves to `apps/web/public/icons/brands/<slug>.svg`
   * (registered in `BRAND_ICONS`). Generic, brand-less providers (SMTP, HTTP auth)
   * use a bare kebab-case `ICON_DATA` lucide id (e.g. `mail`, `key`).
   */
  icon?: string
  category?:
    | 'ai'
    | 'database'
    | 'data'
    | 'email'
    | 'auth'
    | 'social'
    | 'ecommerce'
    | 'storage'
    | 'other'
  brandColor?: string
}

/**
 * A platform built-in connection provider. This is the column-shaped def with
 * one indirection: instead of the encrypted `oauth2ClientId/Secret` columns it
 * names the platform ENV vars that hold them — `ensure-platform-providers`
 * reads + encrypts those at seed/boot time (§9.3).
 */
export type PlatformProviderDef = {
  /** Stable lookup key; equals the old ICredentialType.name and Credential.type. */
  providerKey: string
  /** 'oauth2-code' | 'secret' | 'none' | 'hosted-provision'. */
  connectionType: 'oauth2-code' | 'secret' | 'none' | 'hosted-provision'
  /**
   * hosted-provision only: names the `HostedProvisionHandler` the connect routes resolve
   * via `resolveHostedProvisionHandler` (lazy import — no static consumer dependency).
   * Code-native (not a ConnectionDefinition column): routes look the def up in
   * `PLATFORM_PROVIDER_DEFS` by `providerKey` (`getProviderByKey`).
   */
  hostedProvisionKey?: string
  label: string
  description?: string
  /** true = org-wide credential, false = per-user. Default false. */
  global?: boolean

  // OAuth2 config (oauth2-code only)
  oauth2AuthorizeUrl?: string
  oauth2AccessTokenUrl?: string
  oauth2RefreshUrl?: string
  oauth2Scopes?: string[]
  /**
   * Additive scopes a connect attempt MAY request on top of `oauth2Scopes`. The
   * required list is a floor (always requested); these are never requested unless a
   * connect attempt names them, and the two lists are disjoint. See
   * `plans/connections/optional-oauth-scopes.md`.
   */
  oauth2OptionalScopes?: string[]
  oauth2TokenRequestAuthMethod?: 'request-body' | 'basic-auth'
  oauth2Features?: OAuth2Features
  /** Platform env var holding the OAuth client id (encrypted into the row at seed time). */
  systemClientIdEnv?: string
  /** Platform env var holding the OAuth client secret (encrypted into the row at seed time). */
  systemClientSecretEnv?: string
  /**
   * Platform env var ('true'/'false') gating whether the platform's own OAuth client
   * is usable for this provider, or every connection must bring its own (e.g. Google
   * restricted scopes pending app verification). Seeded into
   * ConnectionDefinition.platformClientApproved; defaults true when the env is unset.
   */
  systemClientApprovedEnv?: string

  /** Connect-form fields + {key} interpolation variables. */
  connectionVariables?: ConnectionVariable[]
  /** How a resolved credential becomes request auth. null for DB/email/none/SDK-consumed. */
  authApply?: AuthApply | null
  /**
   * Request origin the connection contributes, interpolated from `{value}` + connection
   * variables at runtime (e.g. `https://{shop}.myshopify.com/admin/api/2024-10`). Omit for
   * fixed-host APIs the consumer already targets, or driver/SDK-consumed providers.
   */
  baseUrlTemplate?: string

  uiMetadata?: ProviderUiMetadata
}
