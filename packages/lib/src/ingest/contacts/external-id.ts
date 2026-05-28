// packages/lib/src/ingest/contacts/external-id.ts

/**
 * Server-originated external-id helpers.
 *
 * Mirrors the source-prefix convention used by the browser extension
 * (`apps/extension/src/lib/external-id.ts`) but lives in `@auxx/lib` so
 * server-side ingestion paths (chat widget, API) can build the same
 * `"<source>:<value>"` strings without importing from an app package.
 *
 * Server and extension are intentionally kept as separate modules — the
 * extension is a browser app and lib cannot depend on app code, so the
 * sources are partitioned by where they originate. Add a new helper here
 * when the source is signed/produced by our backend; add to the extension
 * helper when the source is parsed from a page the user is viewing.
 */

export type ServerExternalIdSource = 'chat' | 'shopify'

export function buildServerExternalId(source: ServerExternalIdSource, raw: string): string {
  const v = raw.trim()
  if (!v) throw new Error(`buildServerExternalId: empty value for ${source}`)
  return `${source}:${v}`
}

/** Build the canonical `chat:<userId>` external id for a chat-widget visitor. */
export function chatExternalId(userId: string): string {
  return buildServerExternalId('chat', userId)
}

/**
 * Build the canonical `shopify:<shopDomain>:<customerId>` external id for a
 * Shopify storefront customer. Keeps shoppers from two stores under the same
 * Auxx org separated even if Shopify happens to reuse customer ids.
 */
export function shopifyExternalId(shopDomain: string, customerId: string): string {
  return buildServerExternalId('shopify', `${shopDomain.trim()}:${customerId.trim()}`)
}

/**
 * If `userId` already starts with a known server-source prefix (`shopify:`),
 * return it verbatim; otherwise wrap with `chat:`. Used by the JWT contact
 * resolver so a JWT minted by our Shopify App Proxy (which encodes
 * `shopify:<shop>:<id>` directly into the `user_id` claim) doesn't get
 * double-namespaced to `chat:shopify:<shop>:<id>`.
 */
export function resolveServerExternalId(userId: string): string {
  if (userId.startsWith('shopify:')) return userId
  return chatExternalId(userId)
}
