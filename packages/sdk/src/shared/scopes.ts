// packages/sdk/src/shared/scopes.ts
//
// Pure helpers for turning a connection's GRANTED OAuth scopes into an app's own
// capability names. Lives on the root surface (`@auxx/sdk`) rather than
// `@auxx/sdk/server`: the server surface is externalized to the injected
// `AUXX_SERVER_SDK` global, so a pure function exported there would have to be
// mirrored by hand in the lambda runtime. The root SDK is injected from the real
// module (`g.AUXX_ROOT_SDK = RootSDK`), so one implementation serves every app.
//
// See plans/connections/scope-derived-capabilities.md §2.2.

/**
 * Split a granted-scope string into individual scopes.
 *
 * RFC 6749 §3.3 specifies space-delimited, but several providers (Shopify among them) use
 * commas, so both are accepted rather than assumed.
 */
export function parseScopeString(raw: string | undefined | null): string[] {
  return (raw ?? '').split(/[\s,]+/).filter(Boolean)
}

/**
 * The capabilities a connection's granted scopes add up to.
 *
 * An app declares a `grants` table mapping **provider scope → the app's own capability
 * names**, then gates its operations on capabilities rather than on scope strings. Declaring
 * the relationship in this direction is what removes every special case:
 *
 * - **Implication is stated once, where it is true.** Shopify auto-includes `read_x` wherever
 *   `write_x` was requested, so `write_orders: ['orders:read', 'orders:write']` is a fact
 *   about that scope — not a prefix rule every caller has to remember to apply.
 * - **"Any of these will do" needs no mechanism.** Two scopes granting the same capability
 *   *is* the or-condition (e.g. Shopify's merchant-managed and assigned fulfillment scopes
 *   both granting `fulfillment:read`).
 * - **Scopes that are not a read/write level fit anyway** — `read_all_orders` simply grants
 *   `orders:history-full`, which no level-based model could express.
 *
 * The result is a union, so every downstream check is a plain subset test.
 *
 * @param grants provider scope → the capability names holding it confers.
 * @param granted the connection's granted scopes — `connection.metadata.scope`, or an
 *   already-split list.
 * @param onUnknownScope called for a granted scope absent from `grants`. Worth logging: an
 *   unrecognised scope contributes nothing, which presents as operations silently
 *   disappearing, and is how a provider renaming a scope should be discovered.
 *
 * @example
 * ```typescript
 * import { resolveCapabilities } from '@auxx/sdk'
 * import { getConnection, InsufficientPermissionsError } from '@auxx/sdk/server'
 *
 * const SCOPE_GRANTS = {
 *   read_orders: ['orders:read'],
 *   write_orders: ['orders:read', 'orders:write'],
 * } as const
 *
 * const caps = resolveCapabilities(SCOPE_GRANTS, getConnection().metadata?.scope)
 * if (!caps.has('orders:write')) {
 *   throw new InsufficientPermissionsError('organization', ['write_orders'])
 * }
 * ```
 */
export function resolveCapabilities(
  grants: Record<string, readonly string[]>,
  granted: string | Iterable<string> | undefined | null,
  onUnknownScope?: (scope: string) => void
): Set<string> {
  const scopes =
    typeof granted === 'string' || granted == null ? parseScopeString(granted) : [...granted]

  const capabilities = new Set<string>()
  for (const scope of scopes) {
    const grantedBy = grants[scope]
    if (!grantedBy) {
      onUnknownScope?.(scope)
      continue
    }
    for (const capability of grantedBy) capabilities.add(capability)
  }
  return capabilities
}
