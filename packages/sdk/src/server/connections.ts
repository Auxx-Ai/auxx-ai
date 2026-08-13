// packages/sdk/src/server/connections.ts

/**
 * Connection object returned by getUserConnection/getOrganizationConnection
 */
export interface Connection {
  /** Unique connection ID */
  id: string

  /**
   * How the credential behind this connection was produced. Descriptive only —
   * read `value`/`fields` to authenticate, not this.
   * - `oauth2-code` — user-authorized OAuth2, auto-refreshed
   * - `client-credentials` — server-minted bearer (no user, no browser)
   * - `secret` — API key or multi-field secret
   * - `hosted-provision` — platform-provisioned; no token semantics
   */
  type: 'oauth2-code' | 'client-credentials' | 'secret' | 'hosted-provision'

  /**
   * The credential value (access token, API key, or secret)
   * Use this to authenticate with external services.
   * Empty for multi-field secret connections — read `fields` instead.
   */
  value: string

  /**
   * Connection variables, merged: plain variables + decrypted secret-flagged ones,
   * keyed by the variable key declared on the connection definition.
   * e.g. `connection.fields.client_id`, `connection.fields.client_secret`
   */
  fields?: Record<string, string>

  /** Additional metadata about the connection */
  metadata?: {
    /** OAuth scopes granted */
    scope?: string
    /** External service user ID */
    externalUserId?: string
    /** Token type (Bearer, etc.) */
    tokenType?: string
    /** Custom metadata defined by app */
    [key: string]: any
  }

  /** For OAuth2 connections, when the token expires */
  expiresAt?: Date
}

/**
 * Optional value an app's `connection-added` event handler may return to name
 * the connection. The platform dedupes this against existing connections in the
 * same scope (appending " (2)", " (3)", …) and falls back to the app name when
 * no label is returned.
 *
 * @example
 * // src/events/connection-added.event.ts
 * export default async function connectionAdded(
 *   { connection }: { connection: Connection },
 * ): Promise<ConnectionAddedResult> {
 *   const me = await fetch('https://api.example.com/me', {
 *     headers: { Authorization: `Bearer ${connection.value}` },
 *   }).then((r) => r.json())
 *   return { label: me.email }
 * }
 */
export interface ConnectionAddedResult {
  /** Human-readable label for this connection (email, shop domain, workspace name). */
  label?: string
}

/**
 * Connection view passed to `connection-identify` — pre-insert, so no `id`
 * (nothing is persisted yet; the freshly minted credential value + metadata are
 * handed to the handler before any DB write).
 */
export type IdentifyConnection = Omit<Connection, 'id'>

/**
 * Result an app's `connection-identify` event handler returns so the platform
 * can dedupe a fresh connect against existing connections in the same scope.
 *
 * The handler lives at `src/events/connection-identify.event.ts` and is a
 * **pure, side-effect-free, PRE-insert** hook. It runs *before* the credential
 * is written, receives the freshly minted credential value + metadata (no
 * `connection.id`, nothing persisted yet), and returns a stable provider
 * identity string for dedup — a realm id, workspace id, account email, etc.
 *
 * The handler MAY read the provider (e.g. `GET /me`) to derive the identity, but
 * MUST NOT mutate provider state (no webhook registration, no writes). All
 * setup + webhook side effects stay in `connection-added`, which runs *after*
 * insert only for genuinely new connections. When the returned `identifier`
 * matches an existing connection the platform updates that row in place (rotates
 * tokens) and does NOT re-fire `connection-added`.
 *
 * @example
 * // src/events/connection-identify.event.ts
 * import type {
 *   IdentifyConnection,
 *   ConnectionIdentifyResult,
 * } from '@auxx/sdk/server'
 *
 * export default async function connectionIdentify(
 *   { connection }: { connection: IdentifyConnection },
 * ): Promise<ConnectionIdentifyResult> {
 *   // Metadata-derived (QuickBooks): realmId rides the OAuth callback.
 *   const realmId = connection.metadata?.realmId as string | undefined
 *   return realmId ? { identifier: realmId } : {}
 *   // API-derived: call `GET /me` with connection.value, return { identifier: me.email }.
 * }
 */
export interface ConnectionIdentifyResult {
  /** Stable provider identity for dedup — realm id, workspace id, account email.
   *  Omit/empty to skip dedup for this connect. */
  identifier?: string
}

/**
 * Error thrown when connection is not found.
 * Platform catches this and prompts user to authenticate.
 */
export class ConnectionNotFoundError extends Error {
  code = 'CONNECTION_NOT_FOUND'

  constructor(public scope: 'user' | 'organization') {
    super(`${scope} connection not found. Please connect your account.`)
    this.name = 'ConnectionNotFoundError'
  }
}

/**
 * Get the connection bound to the current tool/block invocation, regardless
 * of scope. The platform resolves which credential to inject (workspace or
 * personal) — for tools, that's the agent creator's `appAccounts[appId]`
 * binding; for workflow blocks, the workflow's `accountId`.
 *
 * Tool authors should prefer this over `getUserConnection` /
 * `getOrganizationConnection` — see
 * plans/kopilot/apps/agent-credentials.md §6.2.
 *
 * Throws ConnectionNotFoundError if no connection is available.
 */
export function getConnection(): Connection {
  if (typeof (global as any).AUXX_SERVER_SDK !== 'undefined') {
    const sdk = (global as any).AUXX_SERVER_SDK
    if (typeof sdk.getConnection === 'function') {
      return sdk.getConnection()
    }
    // Fallback for older runtimes that only expose the split helpers.
    if (typeof sdk.getUserConnection === 'function') {
      try {
        return sdk.getUserConnection()
      } catch {
        // try org
      }
    }
    if (typeof sdk.getOrganizationConnection === 'function') {
      return sdk.getOrganizationConnection()
    }
  }

  throw new Error(
    '[auxx/server] Server SDK not available. ' +
      'This code must run in the Auxx server environment.'
  )
}

/**
 * Get the current user's connection to an external service.
 *
 * Throws ConnectionNotFoundError if user is not connected.
 * Platform catches this error and prompts user to authenticate.
 *
 * @deprecated Use `getConnection()` for tool authors. Workflow blocks may
 * still use this when they specifically need user-scope credentials.
 *
 * @returns User's connection credentials
 */
export function getUserConnection(): Connection {
  // Runtime injection (similar to other SDK functions)
  if (typeof (global as any).AUXX_SERVER_SDK !== 'undefined') {
    const sdk = (global as any).AUXX_SERVER_SDK
    if (typeof sdk.getUserConnection === 'function') {
      return sdk.getUserConnection()
    }
  }

  throw new Error(
    '[auxx/server] Server SDK not available. ' +
      'This code must run in the Auxx server environment.'
  )
}

/**
 * Get the organization-wide connection to an external service.
 *
 * Throws ConnectionNotFoundError if organization is not connected.
 * Platform catches this error and prompts admin to authenticate.
 *
 * @returns Organization connection credentials
 *
 * @example
 * ```typescript
 * import { getOrganizationConnection } from '@auxx/sdk/server'
 *
 * export default async function fetchCompanyData() {
 *   // Get company's Stripe connection
 *   const connection = getOrganizationConnection()
 *
 *   const response = await fetch('https://api.stripe.com/v1/customers', {
 *     headers: {
 *       'Authorization': `Bearer ${connection.value}`
 *     }
 *   })
 *
 *   return await response.json()
 * }
 * ```
 */
export function getOrganizationConnection(): Connection {
  if (typeof (global as any).AUXX_SERVER_SDK !== 'undefined') {
    const sdk = (global as any).AUXX_SERVER_SDK
    if (typeof sdk.getOrganizationConnection === 'function') {
      return sdk.getOrganizationConnection()
    }
  }

  throw new Error(
    '[auxx/server] Server SDK not available. ' +
      'This code must run in the Auxx server environment.'
  )
}
