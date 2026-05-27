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

export type ServerExternalIdSource = 'chat'

export function buildServerExternalId(source: ServerExternalIdSource, raw: string): string {
  const v = raw.trim()
  if (!v) throw new Error(`buildServerExternalId: empty value for ${source}`)
  return `${source}:${v}`
}

/** Build the canonical `chat:<userId>` external id for a chat-widget visitor. */
export function chatExternalId(userId: string): string {
  return buildServerExternalId('chat', userId)
}
