// packages/lib/src/apps/connections/resolve-app-connection-for-runtime.ts
// Thin wrapper over the unified resolveConnectionForRuntime (now the single
// resolver for every connection owner). Kept as a named export so existing app
// call sites and the `@auxx/lib/apps` barrel stay stable.

import {
  type RuntimeConnectionData,
  resolveConnectionForRuntime,
} from '../../connections/resolve-connection-for-runtime'

export type { RuntimeConnectionData }

/**
 * Resolve app connections for runtime execution. Delegates to
 * {@link resolveConnectionForRuntime} with the `appId` owner — the app may define both a
 * user-scoped and an org-scoped connection, and whichever credentials exist are returned.
 *
 * Pass `ensureFresh: false` to skip the lazy OAuth refresh (used by the reconnect/authorize
 * route, which only reads `metadata.connectionVariables`).
 */
export async function resolveAppConnectionForRuntime(input: {
  appId: string
  organizationId: string
  userId: string
  connectionId?: string
  ensureFresh?: boolean
}) {
  return resolveConnectionForRuntime(input)
}
