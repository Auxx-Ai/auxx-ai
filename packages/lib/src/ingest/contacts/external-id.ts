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

export type ServerExternalIdSource = 'chat' | 'shopify' | 'facebook' | 'instagram'

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
 * Build the canonical `facebook:<psid>` / `instagram:<igsid>` external id for a
 * Meta DM counterpart.
 *
 * **Deliberately NOT account-scoped, unlike `shopifyExternalId`.** That helper
 * folds the shop domain in because Shopify customer ids are per-store sequences
 * that genuinely collide across two stores in one org. A PSID is not a sequence:
 * Meta issues one per (Page, person) pair out of a global id space and does not
 * reuse them, so two Pages under one org cannot mint the same value and the
 * `RecordIdentity_identity_key` unique index cannot collide. Scoping would also
 * mean threading the active integration's Page id down into the contact layer,
 * which ingest deliberately does not pass — `ctx.ownIdentities` holds the org's
 * page ids as an unordered SET, so it cannot say which Page a given PSID came
 * from, which is exactly the question scoping would need answered.
 *
 * What this shares with Shopify is the `RecordIdentity_record_kind_key` limit:
 * one identity per source per contact. If the same human DMs two of our Pages
 * they hold two PSIDs, and only one can be indexed against a single contact —
 * the same constraint a two-store Shopify org already lives with.
 */
export function metaExternalId(platform: 'facebook' | 'instagram', id: string): string {
  return buildServerExternalId(platform, id)
}
