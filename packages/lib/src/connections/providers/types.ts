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
 * Declared, generically-read capabilities of a connection provider (decision B13).
 *
 * Deliberately a closed set of booleans rather than a free-form bag: a capability is
 * only useful if generic code already knows what to do with it, and a key nothing
 * reads is a comment pretending to be configuration.
 */
export type ProviderCapabilities = {
  /**
   * The org may hold SEVERAL credentials for this provider at once.
   *
   * 🛑 The default is one credential per provider per organization, and the connect
   * return route enforces it by reusing the first credential it finds. That is right
   * for a payments account and wrong for a bank: Bank of America plus Wells Fargo is
   * two logins, and reusing one row for the second silently replaces the first. When
   * this is set the route dedupes on the completion's `providerAccountId` instead, so
   * re-running onboarding for a login already connected still updates in place.
   */
  multiAccount?: boolean
  /**
   * `start()` returns `{ kind: 'embed' }` - the browser mounts the provider's own
   * widget rather than navigating away, and POSTs the result back to the return
   * route itself. The connect surface still branches on what `start` ACTUALLY
   * returned; this flag is what lets a caller know a page navigation is not coming
   * before it calls (so it can `fetch` the start route instead of following it).
   */
  embed?: boolean
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
  /**
   * What this provider's connect flow can do, DECLARED here and read generically
   * (decision B13 - the acceptance test is that a second provider of the same shape
   * needs zero code changes, only a definition). The precedent is `authApply` and
   * `baseUrlTemplate`: `'https://{shop}.myshopify.com'` is data the transport
   * interpolates, not an `if (provider === 'shopify')`.
   *
   * 🛑 Nothing in the routes or the UI may branch on `providerKey`. A capability that
   * is not declared here is one a caller has to guess, and the one time Shopify's
   * non-bearer header was not declared, "every Shopify definition carried the wrong
   * bearer spec unnoticed".
   */
  capabilities?: ProviderCapabilities
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
