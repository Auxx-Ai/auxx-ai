// packages/lib/src/data-connectors/connection-meta.ts

/** A connection's plaintext companion data as `connectionAppFields` sees it. */
export interface ConnectionMetaSource {
  label: string | null
  metadata: Record<string, unknown>
}

/**
 * Flatten a connection's plaintext metadata into the lookup map a
 * `connectionAppFields` binding's `from` key reads. Exposes, in precedence
 * order (later wins on a key clash):
 *  1. the raw `metadata` keys (scopes, …);
 *  2. the captured `connectionVariables` hoisted to the top level, so
 *     `from: 'shop'` resolves to what the user entered at connect;
 *  3. the connection `label`, so `from: 'label'` resolves to the meaningful
 *     name the app's connection-added handler set (shop domain / account email).
 *
 * Without this, `from` could only see raw top-level metadata keys — never the
 * connection variables or the label — which is where the useful values live.
 */
export function flattenConnectionMeta(cred: ConnectionMetaSource): Record<string, unknown> {
  const metadata = cred.metadata ?? {}
  const vars = (metadata.connectionVariables ?? {}) as Record<string, unknown>
  return { ...metadata, ...vars, ...(cred.label != null ? { label: cred.label } : {}) }
}
